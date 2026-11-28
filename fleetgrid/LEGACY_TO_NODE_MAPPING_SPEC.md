# Legacy Python SQLAlchemy → Node FleetGrid Mapping Specification

**Status:** Design specification only; no importer or production write is authorized by this document.  
**Inputs:** Legacy PostgreSQL schema inventory captured 2026-11-23, legacy SQLAlchemy model definitions, and Node server domain types at commit `dca316d`.

## Migration architecture

- Source is the normalized legacy Python/PostgreSQL schema.
- Target is the Node application's `fleetgrid_records` JSONB store, namespaced by collection.
- Use a dedicated SELECT-only source connection and a separate target connection.
- Read all source rows in a consistent read-only transaction/snapshot. Do not use application-owner credentials.
- Preserve every source primary key as the target record `id`.
- Keep a durable per-source-table/key migration ledger and source-to-target mapping report.
- Import only into an explicitly designated empty staging target. Never reuse the live legacy database as the target.
- Perform a dry-run first; no write mode until every unresolved decision below is signed off.
- Keep original raw source fields in a migration audit payload so normalized transformations remain traceable.
- Never fabricate missing business values, dates, GPS coordinates, IDs, payment confirmation, or cryptographic proofs.

## Collection mapping

| Legacy table | Node collection | Mapping / validation |
|---|---|---|
| organizations | organizations | `id`, `name`, `type` direct; status defaults to ACTIVE only if absent and must validate against ACTIVE/SUSPENDED; `createdAt` is absent in legacy model and must be handled as nullable/archive metadata or target schema revised—not generated as historical truth. |
| users | users | Preserve `id`, `name`, `contact`, `created_at → createdAt`; organization FK must resolve. `role` needs approved mapping. Email is present in legacy schema but Node public User excludes email; never copy it into public User payload. |
| drivers | drivers | Preserve `id`, organization/user/truck links and status after explicit mapping; Node requires `name`, `phone`, `createdAt` but legacy Driver table does not contain them. Join the referenced User for name/contact only if semantics are approved; phone may be absent. Do not synthesize createdAt. |
| trucks | trucks | Direct IDs, organization, registration, capacity, available capacity, status, nullable telemetry, driver link; Node currently requires numeric `lat/lng` and string origin/destination while legacy permits NULL. Target schema must support null or row must be quarantined; never use 0,0 or fake routes. Preserve location freshness/status in raw audit extension. |
| capacity_offers | capacity-offers | Preserve id, truck, route, available tonnage, departure, raw status and price_rule. Node requires origin/destination, pricePerT and updatedAt; route parsing must be documented and validated, and price_rule must not be interpreted as a numeric price unless a strict supported grammar is approved. Otherwise quarantine. |
| shipments | shipments | Preserve id, shipper, origin, destination, weight, deadline, status, truck, price, currency, createdAt. Node additionally requires reference, cargoName, capacityOfferId, updatedAt. Extend target schema to represent absent values or quarantine; never invent them. Zero/unknown price remains non-payable. |
| shipment_events | shipment-events | Preserve id, shipment, event type, actor, timestamp, hash, blockchain tx, raw proof status. Strictly parse payload_json into payload object; malformed JSON is quarantined with raw text. Do not invent incident/truck relationships or proof confirmation. |
| incidents | incidents | Preserve id, truck, type, location, severity, transcript, summary, status, createdAt. Node requires source, affectedShipmentIds, recoveryPlanId, updatedAt; retain raw source fields and only map defaults when domain semantics are explicitly established. |
| recovery_plans | recovery-plans | Preserve id, incident, selected truck, cost, ETA delta, status, approver and timestamps. Strictly parse affected_shipment_ids and options_json; verify each referenced ID. Node requires arrays/options object and updatedAt; no fabricated timestamps. |
| payments | payments | Preserve IDs, shipment/recovery links, provider, amount, currency, status, provider reference, createdAt. Node requires updatedAt and has optional provider-specific details. Never infer provider payment ID, checkout URL, or settlement confirmation. Reconcile any non-empty future payment set with provider records. |
| notifications | notifications | Preserve id, recipient, type, message, createdAt; explicitly map legacy status semantics. Node only supports PENDING/SENT, while legacy may include UNREAD/READ/SENT; READ/UNREAD must not be represented as SENT or PENDING without product decision. |

## Role mapping — release blocker

Legacy roles: `SHIPPER`, `OPERATOR`, `DRIVER`, `AUDITOR`.  
Node roles: `BUSINESS`, `CONTROL_TOWER`, `DRIVER`, `OPERATOR`, `VERIFIER`.

Proposed candidate mappings for review only:
- `SHIPPER → BUSINESS` (likely organization-facing role; verify permissions).
- `DRIVER → DRIVER` (direct).
- `OPERATOR` is ambiguous because Node has both `CONTROL_TOWER` and `OPERATOR`; do not decide by name alone.
- `AUDITOR` has no direct Node role. Keep in a quarantined identity/review state until a least-privilege role is designed. Never map to VERIFIER or CONTROL_TOWER automatically.

No credentials are present in the inspected legacy User model. Do not migrate passwords or create sessions. Existing users must use a secure invite/account recovery process after cutover.

## Status and enum mapping — explicit decisions required

| Domain | Legacy observed / model values | Node allowed values | Required handling |
|---|---|---|---|
| Organization | ACTIVE (observed); SUSPENDED possible target | ACTIVE, SUSPENDED | Direct validated mapping. |
| Driver | AVAILABLE observed; ON_TRIP, INCIDENT_REPORTED, OFF_DUTY in model | AVAILABLE, ON_JOURNEY, OFF_DUTY | ON_TRIP may map to ON_JOURNEY only after approval; INCIDENT_REPORTED must not be collapsed into OFF_DUTY—derive only from linked incident or quarantine. |
| Truck | AVAILABLE observed; broader state machine in model | AVAILABLE, ASSIGNED, LOADING, IN_TRANSIT, DELIVERED, DELAYED, INCIDENT, RECOVERY | Validate against Node enum; reject/quarantine unknown values. |
| Capacity offer | OPEN observed; RESERVED, CLOSED in model | OPEN, HELD, CLOSED | RESERVED→HELD is a candidate only after confirming reservation semantics. |
| Shipment | No rows in current snapshot | DRAFT, CAPACITY_RESERVED, CONFIRMED, IN_TRANSIT, AT_RISK, RECOVERY, DELIVERED | Define full mapping before non-empty import. |
| Incident type | Model comment includes BREAKDOWN, ACCIDENT, DELAY, etc. | TRUCK_BREAKDOWN, ACCIDENT, DELAY, CARGO_DAMAGE, ROUTE_BLOCKED, OTHER | Explicit exact-value mapping; unknown values quarantined. |
| Incident status | OPEN, ANALYZING, PLAN_READY, RESOLVED, ESCALATED | Same | Validate; no status transition replay is implied. |
| Recovery status | DRAFT, PROPOSED, PENDING_APPROVAL, APPROVED, EXECUTING, COMPLETED, REJECTED | Same | Validate. |
| Payment | CREATED, PENDING, PAID, FAILED | Same | Preserve status as source claim only; reconcile provider state before enabling payment actions. |
| Event proof | PENDING, CONFIRMED, FAILED, FALLBACK_RECORDED | NOT_ANCHORED, PENDING, CONFIRMED, FAILED | FALLBACK_RECORDED requires a reviewed semantic mapping; never map to CONFIRMED. |
| Notification | UNREAD, READ, SENT | PENDING, SENT | Product decision required for UNREAD/READ. |

## Required schema changes before implementation

1. Make Node fields nullable or introduce an explicit legacy/archive representation for missing organization/user/driver/truck/shipment/offer/incident/recovery/payment timestamps and fields. Do not put fabricated values into required fields.
2. Define a private migration metadata envelope that does not leak source email or raw sensitive fields through public snapshot APIs.
3. Define an explicit role policy and provision/recovery workflow for legacy users.
4. Define deterministic parsers for route and price_rule, event payload_json, affected_shipment_ids, and options_json, each with malformed-input quarantine.
5. Define notification read/unread behavior and proof-status semantics.
6. Verify all target FK-like references in application validation because JSONB collection storage does not enforce relational foreign keys.

## Dry-run report contract

For each source table and each row:
- source table + primary key;
- target collection + target ID (same source ID);
- outcome: mapped / quarantined / rejected;
- field-level transformations and validation errors;
- missing required fields;
- unresolved enum values;
- FK checks and missing parent IDs;
- source/target count reconciliation.

Dry-run must not create target tables, indexes, records, or ledger entries. Apply mode must require an explicit flag, an explicit staging target allowlist, a verified empty-target preflight, and one transaction or recoverable idempotent batches with a durable ledger.

## Current snapshot facts

The 2026-11-23 inventory found 3 organizations, 4 users, 1 driver, 3 trucks and 1 capacity offer; shipment, event, incident, recovery-plan, payment and notification tables were empty at that time. These are snapshot counts, not a guarantee of current counts. Recount and compare at migration time.

## Go / no-go

**NO-GO for importer apply or production cutover** until role mappings, nullability strategy, parsers, notification/proof semantics, password/account recovery, backup restore test, staging import, reconciliation, and rollback rehearsal are approved and pass.


## Superseding decision record (2026-11-23)

The unresolved-policy sections above are historical audit notes and are superseded by [DATABASE_COMPATIBILITY_DECISIONS_2026-11-23.md](./DATABASE_COMPATIBILITY_DECISIONS_2026-11-23.md). That decision record is the authoritative compatibility policy for nullable legacy-origin fields, role mapping, enum preservation, timestamp handling, quarantine rules, privacy, and staging gates. The policy is now decided; importer implementation and all database writes remain gated by the acceptance steps in that record. No production migration, merge, or deployment is authorized.
