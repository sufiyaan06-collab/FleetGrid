# Legacy PostgreSQL Inventory (Read-Only)

**Captured:** 2026-11-23  
**Source:** Existing Render PostgreSQL instance, queried through a read-only transaction.  
**Scope:** Public-schema column metadata, foreign-key metadata, aggregate row counts, and grouped role/status values only. No individual business records, emails, credentials, payment references, or message contents were selected.

## Safety and interpretation

- This is an inventory snapshot, not a backup and not proof that a migration is safe.
- No INSERT, UPDATE, DELETE, DDL, or schema migration was executed.
- Row counts are point-in-time values and may change.
- Preserve legacy IDs and foreign-key relationships in any future migration.
- Do not infer missing business records. In this snapshot, shipments and related operational tables are empty.
- Do not promote or remap AUDITOR without an explicit product/security decision.
- Before importing anything, take and verify a restorable backup, clone the database to staging, and test an idempotent importer there.

## Table row counts

| Table | Rows |
|---|---:|
| organizations | 3 |
| users | 4 |
| drivers | 1 |
| trucks | 3 |
| capacity_offers | 1 |
| shipments | 0 |
| shipment_events | 0 |
| incidents | 0 |
| recovery_plans | 0 |
| payments | 0 |
| notifications | 0 |

## Observed role and status values

| Field | Value | Rows |
|---|---|---:|
| users.role | AUDITOR | 1 |
| users.role | DRIVER | 1 |
| users.role | OPERATOR | 1 |
| users.role | SHIPPER | 1 |
| organizations.type | FLEET_OPERATOR | 2 |
| organizations.type | SHIPPER | 1 |
| organizations.status | ACTIVE | 3 |
| drivers.status | AVAILABLE | 1 |
| trucks.status | AVAILABLE | 3 |
| capacity_offers.status | OPEN | 1 |

## Foreign-key relationships

| Child table.column | Parent table.column | On delete |
|---|---|---|
| capacity_offers.truck_id | trucks.id | NO ACTION |
| drivers.organization_id | organizations.id | NO ACTION |
| drivers.user_id | users.id | NO ACTION |
| incidents.truck_id | trucks.id | NO ACTION |
| payments.recovery_plan_id | recovery_plans.id | NO ACTION |
| payments.shipment_id | shipments.id | NO ACTION |
| recovery_plans.incident_id | incidents.id | NO ACTION |
| recovery_plans.selected_truck_id | trucks.id | NO ACTION |
| shipment_events.shipment_id | shipments.id | NO ACTION |
| shipments.shipper_id | organizations.id | NO ACTION |
| shipments.truck_id | trucks.id | NO ACTION |
| trucks.organization_id | organizations.id | NO ACTION |
| users.organization_id | organizations.id | NO ACTION |

## Migration implications

1. The current legacy dataset is small (13 rows across the listed operational tables), but the target Node schema still needs explicit mapping and validation.
2. There are no shipment, incident, payment, event, recovery-plan, or notification records to import in this snapshot. The importer must still support those tables for future non-empty snapshots.
3. All observed organization, driver, truck, and capacity-offer statuses are simple values in this snapshot; broader enum compatibility must be tested against application code and future data.
4. Users include one AUDITOR account. Keep that identity and role intact in a quarantine/review path until the target authorization model explicitly supports it.
5. The legacy database has foreign keys for organization, user, truck, shipment, incident, recovery-plan, and payment relationships. Validate parent existence before child import; do not disable constraints to force imports.
6. JSON/text fields such as recovery plan options and shipment event payloads require strict parsing and a raw-value quarantine path if malformed.
7. A schema/row-count inventory cannot validate password hash compatibility, email verification state, payment-provider reconciliation, or ownership semantics. Those require separate, narrowly scoped validation before migration.

## Next gated work

- Compare this inventory with the current Node ORM schema and document every field-level mapping.
- Build a dry-run-only importer with deterministic ID preservation, source-to-target mapping, validation, quarantine output, and an import ledger.
- Test against a restored staging clone and compare source/target counts and foreign-key integrity.
- Require explicit approval before any production write or cutover.


## Live deployed schema metadata check — 2026-11-24

A second read-only query against the current Render PostgreSQL database inspected `information_schema.columns` only. It returned no row values or personal data. The deployed schema confirms the following nullable/absent fields:

- **organizations:** no `created_at` column; `status` is nullable.
- **users:** `email`, `organization_id`, `contact`, and `created_at` are nullable.
- **drivers:** no `name`, `phone`, or `created_at` columns; `assigned_truck_id` and `status` are nullable.
- **trucks:** `status`, `lat`, `lng`, `origin`, `destination`, `departure_at`, and `driver_id` are nullable.
- **capacity_offers:** `departure_at`, `status`, and `price_rule` are nullable.
- **shipments:** `deadline_at`, `status`, `truck_id`, `price`, `currency`, and `created_at` are nullable.
- **shipment_events:** `payload_json`, `actor_type`, `actor_id`, `timestamp`, `blockchain_tx`, and `proof_status` are nullable.
- **incidents:** `severity`, `transcript`, `structured_summary`, `status`, and `created_at` are nullable.
- **recovery_plans:** serialized JSON fields, selected truck, cost, ETA, status, approval metadata, and `created_at` are nullable.
- **payments:** `provider`, `currency`, `status`, `provider_reference`, and `created_at` are nullable; `amount` is NOT NULL.
- **notifications:** `status` and `created_at` are nullable.

This confirms that ORM defaults cannot be treated as stored historical values. The compatibility decision record remains authoritative. The Node `fleetgrid_records` table is still absent, and this inspection performed no DDL or DML.
