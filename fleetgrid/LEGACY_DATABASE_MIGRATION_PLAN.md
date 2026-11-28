# FleetGrid legacy PostgreSQL migration plan

## Status

Planning only. This document does not connect to, read from, or modify production data. Do not run a migration against production until the source schema, record counts, backup, and mapping have been reviewed and a separate importer has passed staging tests.

## Important distinction

The existing `migrate-json-to-postgres.ts` script imports the upgraded Node application's JSON collection files into the Node `fleetgrid_records` JSONB table. It is **not** a Python/SQLAlchemy-to-Node migration tool. The legacy Python database stores normalized relational tables such as `organizations`, `users`, `drivers`, `trucks`, `shipments`, `shipment_events`, `capacity_offers`, `payments`, `incidents`, `recovery_plans`, and `notifications`. A direct copy into JSONB would not produce valid Node domain records.

## Non-negotiable safety rules

1. Take and verify a restorable database backup before any production migration.
2. Run the importer against a staging clone first; compare source and target counts and relationship integrity.
3. Read from the legacy schema only. Never delete, rename, truncate, or update legacy tables as part of the import.
4. Use stable source primary keys as target IDs. Make imports repeatable through a migration ledger or an explicit empty-target guard; do not silently overwrite existing target collections.
5. Produce a report for every source table: read count, imported count, skipped count, rejected count, and reasons. Fail closed on unknown enum values or broken required relationships.
6. Do not invent missing GPS coordinates, shipment references, cargo descriptions, or financial values. Preserve missing values in an archival record or leave the affected row unmapped until the target model can represent it honestly.
7. Never migrate legacy user credentials unless a compatible, verified password hash is actually present. Existing users should use a verified account recovery / password-reset flow; no passwords or sessions are to be fabricated.
8. Do not run this plan or any future importer against production without explicit approval after the staging report and backup have been reviewed.

## Known model differences

| Legacy Python field / behavior | Node target | Migration handling |
|---|---|---|
| Organization `type`: `SHIPPER`, `FLEET_OPERATOR` | Same values | Direct map after validating enum |
| User role: `SHIPPER`, `OPERATOR`, `DRIVER`, `AUDITOR` | `BUSINESS`, `CONTROL_TOWER`, `DRIVER`, `OPERATOR`, `VERIFIER` | Explicit reviewed mapping required; `AUDITOR` must not be silently promoted to `VERIFIER` |
| User `organization_id` nullable | Node `organizationId` required | Quarantine rows without a valid organization; do not attach to a made-up organization |
| Legacy driver status includes `ON_TRIP`, `INCIDENT_REPORTED` | Node: `ON_JOURNEY`, `AVAILABLE`, `OFF_DUTY` | Explicit status mapping; incident state remains in incident records |
| Truck `lat` / `lng` nullable | Node requires numeric `lat` / `lng` | Do not use 0,0 or sample coordinates; extend target to nullable coordinates or quarantine/archive affected trucks |
| Truck origin/destination nullable | Node requires strings | Preserve nullability or quarantine; never invent route endpoints |
| Truck location telemetry has separate status and last-update fields | Node has optional speed/heading only | Preserve as extension/archive until target schema supports telemetry freshness |
| Shipment has no legacy `reference`, `cargoName`, `capacityOfferId`, or `updated_at` in the inspected model | Node requires these fields | Extend target to allow honest unknowns or maintain source payload; do not invent references or cargo labels |
| Shipment `price` defaults to 0 | Node checkout requires a positive price | Preserve zero as zero; mark not payable until an authorized user enters a real price |
| Capacity offer stores `route` and `price_rule`, but not normalized origin/destination or numeric price-per-ton | Node expects origin, destination, `pricePerT` | Parse only a documented, validated format; otherwise preserve raw fields and quarantine from pricing workflows |
| Capacity offer status includes `RESERVED` | Node uses `HELD` | Map only after confirming semantics; keep raw source status in migration audit |
| Incident type includes legacy values such as `BREAKDOWN` | Node uses `TRUCK_BREAKDOWN` | Explicit enum mapping with unknown-value rejection |
| Incident lacks source, affected shipment IDs, recovery plan ID, and updated timestamp in inspected model | Node expects these fields | Preserve available fields; derive relationships only from verified relational links; no synthetic source or timestamps |
| Shipment event has non-null shipment FK and text `payload_json` | Node allows shipment/incident/truck nullable and expects parsed payload | Parse JSON strictly; preserve original payload text if malformed; do not invent hashes or proof |
| Legacy proof status includes `FALLBACK_RECORDED` | Node uses `NOT_ANCHORED`, `PENDING`, `CONFIRMED`, `FAILED` | Requires a documented semantic mapping; never relabel as confirmed |
| Recovery plan stores JSON text for affected IDs/options and lacks `updated_at` | Node expects arrays/objects and updated timestamp | Strict JSON parsing and FK validation; retain raw values in audit; no invented timestamps |
| Payment has amount/currency/status/provider reference but no inspected provider payment ID, checkout URL, or updated timestamp | Node has optional provider fields and requires updated timestamp | Preserve available transaction facts; never infer provider confirmation from a local status alone |
| Notification status includes `UNREAD`, `READ`, `SENT` | Node uses `PENDING`, `SENT` | Requires product decision; do not mark unread/read records as sent or pending without an explicit semantics decision |

## Required source-to-target mapping work

Before coding the importer, inspect the live schema definitions and constraints for every table, including foreign keys and actual enum values. The inspected model files are useful but are not a substitute for a production schema dump. Also inspect whether any additional authentication, audit, or payment-provider tables exist.

The importer should use a read-only legacy connection and a separate target connection. It should build an in-memory mapping report first, then write only to an empty target using a single transaction (or collection-scoped transactions with a durable migration ledger). Preserve source IDs and foreign-key relationships. Store source table/key metadata alongside every imported record or in a dedicated migration ledger so each target row is traceable.

## Go-live gates

- [ ] Restorable production backup verified.
- [ ] Source schema and record counts captured.
- [ ] All enum mappings approved.
- [ ] Nullable / missing target fields handled without fabricated values.
- [ ] Relationship validation passes.
- [ ] Legacy account recovery plan approved; no credential assumptions.
- [ ] Staging import and rollback rehearsal pass.
- [ ] Payment records reconciled against provider records before enabling payment actions.
- [ ] Production migration window and explicit owner approval recorded.

## Safe legacy schema inventory

A read-only inspection utility is available at `fleetgrid/server/scripts/inspect-legacy-postgres.ts`. It reports the allowlisted legacy tables' presence, row counts, columns, foreign keys, and distinct values for selected status/role/type columns. It does not read business row contents, write to the source, or connect to a target database.

Before running it, create or obtain a dedicated PostgreSQL role with SELECT-only access to the required legacy schema. Do not use an application owner or superuser credential. Set `LEGACY_DATABASE_URL` in a trusted local shell or secret environment; never commit it or paste it into chat. For an external TLS connection, set `PGSSLMODE=require`; the inspector verifies the server certificate. Then run:

```bash
npm --prefix fleetgrid/server run inspect:legacy
```

Review the JSON report for missing tables, row counts, columns, foreign keys, and unexpected enum values. Treat it as schema inventory only—not approval to import. The script checks a fixed list of expected tables in the `public` schema; additional legacy tables may still exist and must be identified before importer design. Do not run it with production write credentials, and do not proceed to a production import based solely on this report.
