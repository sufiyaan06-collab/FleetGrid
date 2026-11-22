# FleetGrid Database Compatibility Decisions

**Decision record:** 2026-11-23  
**Status:** Compatibility policy decided; implementation and import remain gated.  
**Safety boundary:** This authorizes design/code work on the upgrade branch only. It does not authorize production writes, DDL, merge, or deployment.

## 1. Chosen compatibility strategy

**Decision: retain the Node domain model as canonical, but make legacy-origin fields explicitly nullable wherever the legacy schema cannot truthfully supply them.** Do not coerce incomplete rows into fabricated complete records or silently hide all partially populated business records in an inaccessible archive.

- Null means the legacy source did not contain a value or the source value was null.
- Migration nullability does not relax validation for newly created Node records; new records remain subject to existing API/service requirements.
- API/UI must render unknown values as “Not recorded” or “Unavailable”; never display 0,0, blank routes, invented dates, or invented values.
- Preserve source fields and source table/key in a private migration audit envelope. Never expose it through public snapshots.
- Quarantine only invalid identity, unmappable enum, malformed serialized data, unresolved required relationship, or data that remains unsafe after nullable schema changes.
- Preserve source primary keys as target IDs; import must be idempotent and reconcile counts.

This keeps valid organizations, users, drivers, trucks and offers usable by the Node application while preserving unknown historical facts honestly.

## 2. Field-level decisions

| Entity / field | Final decision |
|---|---|
| Organization createdAt | Nullable. Legacy Organization has no creation column. Never substitute import time. |
| User organizationId and contact | Nullable. A user without an organization remains unassigned and gets no organization-scoped access until explicitly linked by an administrator. |
| User email / credentials | Email stays private auth data only. Do not copy email into public User. Legacy passwords/sessions are incompatible; migrated users require invitation/account recovery and new verified credentials. |
| Driver name | Join drivers.user_id to users.id and copy linked user's name only after identity/FK validation. |
| Driver phone and createdAt | Nullable; no trustworthy source field exists. |
| Driver status | Preserve INCIDENT_REPORTED as a distinct compatible state. Map ON_TRIP to ON_JOURNEY. Preserve AVAILABLE and OFF_DUTY. Unknown values quarantine. |
| Truck lat/lng/origin/destination/departureAt | Nullable. Never synthesize GPS, route, or departure time. |
| Truck driverId / Driver assignedTruckId | Nullable and manually validate; these legacy links are not declared SQL foreign keys. Broken optional links become null with a warning; required-parent failures quarantine the child. |
| Capacity Offer origin/destination | Parse route only when it matches strict “non-empty origin -> non-empty destination” grammar with exactly one delimiter. Otherwise both are null and raw route stays in private migration metadata. |
| Capacity Offer pricePerT | Parse only an explicit numeric amount + supported currency + “per Ton” pattern. Example: INR 2500 per Ton maps to 2500 INR/ton. Ambiguous/free-form rules remain null. |
| Capacity Offer updatedAt | Nullable; no legacy source column. |
| Shipment reference, cargoName, capacityOfferId, updatedAt | Nullable. No synthetic reference/cargo/offer/time. Current inventory had zero shipments, but future runs must support them. |
| Shipment price | Preserve numeric source value. Zero remains zero and is not payable. Never derive price from an offer during migration. |
| Shipment Event payload | Strictly parse JSON text and require a JSON object. Malformed/non-object payload is quarantined with raw text preserved privately. |
| Shipment Event proofStatus | Preserve FALLBACK_RECORDED as a distinct state; never map it to CONFIRMED. |
| Incident transcript and structuredSummary | Nullable. |
| Incident source | Add LEGACY_IMPORT to source enum for migrated incidents; do not infer DRIVER_APP/VOICE/OPERATOR. |
| Incident affectedShipmentIds | Nullable when the legacy source has no authoritative list; do not turn unknown into an asserted empty list. |
| Incident recoveryPlanId and updatedAt | Nullable; resolve recovery-plan links from actual rows only. |
| Recovery Plan affectedShipmentIds and options | Strictly parse serialized JSON and validate shape/referenced IDs. Invalid JSON or shape quarantines the row; never replace with empty arrays. |
| Recovery Plan updatedAt | Nullable. |
| Payment updatedAt | Nullable. Preserve provider reference as private data; quarantine legacy payment rows until provider status is reconciled. A legacy `PAID` value alone is not current settlement proof. |
| Notification status | Preserve UNREAD, READ, SENT, and PENDING distinctly. Do not collapse read state into delivery state. |

## 3. Role decisions

| Legacy role | Node role / disposition | Rationale |
|---|---|---|
| SHIPPER | BUSINESS | Direct product-role equivalent; enforce organization ownership. |
| DRIVER | DRIVER | Exact match. |
| OPERATOR | OPERATOR | Exact role-name match. Do not silently elevate to CONTROL_TOWER. |
| AUDITOR | Quarantine pending explicit least-privilege policy | No safe one-to-one equivalent. Do not grant VERIFIER or CONTROL_TOWER based on name similarity. |

A quarantined AUDITOR identity cannot authenticate. It can be recovered only through administrator-reviewed role assignment. No user may self-select a privileged role at signup.

## 4. Enum decisions

- Organization: exact ACTIVE / SUSPENDED; null or unknown values quarantine.
- Driver: ON_TRIP maps to ON_JOURNEY; INCIDENT_REPORTED remains distinct.
- Truck: exact validated Node truck states only; unknown states quarantine.
- Capacity Offer: RESERVED maps to HELD because both represent committed capacity unavailable for a new reservation; preserve original status in private audit metadata.
- Shipment: exact validated state names only; unknown states quarantine.
- Incident type: BREAKDOWN maps to TRUCK_BREAKDOWN; exact ACCIDENT and DELAY values map directly. Only an explicit generic OTHER maps to OTHER; unknown types quarantine.
- Incident, Recovery Plan, Payment statuses: exact validated values only.
- Event actor: SHIPPER maps to BUSINESS; other values exact-match only.
- Proof status: FALLBACK_RECORDED remains distinct.
- Notification: preserve UNREAD, READ, SENT; accept PENDING for Node-originated records.

## 5. Relationship and integrity policy

- Enforce all real legacy SQL foreign keys during dry-run.
- Manually validate trucks.driver_id and drivers.assigned_truck_id.
- Validate every JSON-embedded ID in recovery options and affected-shipment lists.
- Keep source IDs unchanged; never manufacture replacement IDs to bypass collisions.
- For a missing optional relationship, set target relationship to null and record a warning. For a missing required parent, quarantine the child row.
- Verify target IDs are unique per collection and source-to-target mappings are one-to-one.

## 6. Timestamp policy

- Preserve valid source timestamps with timezone normalization to ISO 8601 UTC.
- If source timestamp is null/absent, target remains null.
- Never use migration time, database NOW(), filesystem time, or guessed dates as historical createdAt/updatedAt.
- New Node-created records continue to receive application-generated timestamps.

## 7. Authentication and privacy

- Do not migrate legacy password hashes, sessions, email verification, lockout counters, or reset tokens.
- Do not expose legacy emails, phone numbers, payment references, or raw payloads in public snapshots or dry-run console output.
- Migrated users remain non-authenticating until a secure invitation/account-recovery flow creates a new AuthAccount and verifies email.
- Organization-less users remain unassigned and have no tenant-scoped permissions.
- AUDITOR rows remain quarantined and cannot log in.

## 8. Importer acceptance gates

Before any staging write:
1. Implement nullable domain types and null-safe API/UI handling for the fields above.
2. Implement deterministic parsers and enum mapping with unit tests, including malformed and boundary inputs.
3. Dry-run against a read-only source snapshot and report mapped/quarantined/rejected counts per table, redacted row-level reasons, and FK checks.
4. Confirm target is explicitly allowlisted staging and empty; dry-run must be incapable of DDL/DML.
5. Verify backup restore before staging import.
6. Apply to staging only, then reconcile counts, IDs, relationships, and representative UI/API behavior.
7. Rehearse rollback and prove re-run idempotency.

**Production gate remains NO-GO** until all staging gates pass, provider configuration is verified, a restorable production backup is confirmed, and the user explicitly approves production cutover.


## 9. Completeness addendum — nullable legacy defaults and timestamps

A SQLAlchemy/Python default is not a database NOT NULL constraint. Unless the deployed schema metadata proves otherwise, a legacy column declared with a default but without nullable=false may still contain NULL. Therefore the following additional fields must preserve NULL rather than silently applying their ORM defaults:

- **createdAt:** nullable for organizations, users, drivers, trucks, shipments, incidents, recovery plans, payments, and notifications. The legacy organization/driver/truck models do not define creation timestamps at all; several other models define only a client-side default. Shipment-event timestamp is also nullable. No import-time replacement is allowed.
- **updatedAt:** nullable for every entity where the legacy schema has no updated_at column (including organizations, drivers, trucks, capacity offers, shipments, incidents, recovery plans, and payments).
- **Shipment currency:** nullable when the stored legacy value is null. The ORM default INR is not proof that every historical row contains INR. A shipment with unknown currency is not payable.
- **Payment currency, provider, and status:** preserve null if present. Do not infer provider identity or payment state from a Python default. Such a payment must remain non-actionable until reconciled.
- **Organization status, Driver status, Truck status, Capacity Offer status, Shipment status, Event actor/proof status, Incident severity/status, Recovery Plan status, and Notification status:** a null value is not silently replaced by the ORM default. Quarantine records whose required state-machine status is null; preserve nullable descriptive/metadata fields as null where the application can safely represent them.
- **Event actorType/proofStatus and event timestamp:** preserve null as unknown if present; do not substitute SYSTEM, PENDING, or the current time.
- **Incident severity:** preserve null as unknown; do not substitute HIGH.
- **Recovery Plan cost/ETA/options:** preserve null as unknown; parse JSON only when the source text is non-null. Do not turn null serialized JSON into an asserted empty array.
- **Capacity Offer priceRule:** preserve null if present. Only parse pricePerT from a non-null, explicitly supported rule.
- **Shipment price:** preserve the actual stored numeric value; null is unknown and zero is not payable. Do not replace null with the ORM default 0.

These rules are subject to confirmation against live information_schema nullability before any staging apply. If deployed metadata contradicts the checked-in ORM assumptions, the deployed schema wins and the decision record must be amended before import.


## 10. Importer-specific safety rules

- The read-only importer quarantines every legacy Payment row until provider reconciliation is performed. It never copies provider references into the application-facing Payment record.
- Invalid non-null timestamps are quarantined rather than silently converted to null.
- The importer validates the complete reviewed source-column contract and emits the live source nullability/default metadata in its sanitized preview. Any missing reviewed column aborts the preview.
- A strict route parse failure is a warning: preserve the raw route in the private in-memory audit envelope and map parsed origin/destination as null.
- A capacity price rule is converted only for the explicit INR-per-ton grammar. Other price rules remain null with a warning.
