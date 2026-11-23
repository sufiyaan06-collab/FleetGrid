# FleetGrid account, storage, and payment setup

## Shipper and driver accounts

- Self-service signup is available for `BUSINESS` (Shipper) and `DRIVER` accounts only.
- Signup requires an email address, a password of at least 10 characters, and contact details.
- The API sends a 24-hour email-verification link through Resend.
- A user cannot sign in until the email has been verified.
- Opening the email link only loads the verification page; the user must explicitly press **Verify email**. The token is consumed by a one-time POST so ordinary link-prefetch scanners do not verify accounts automatically.
- Public signup, login and verification endpoints have per-process rate limits. Before running multiple API instances, move these limits to a shared gateway or Redis-backed limiter so each instance enforces the same quota.
- Configure these server environment variables before enabling signup:
  - `RESEND_API_KEY`
  - `EMAIL_FROM` (a sender verified with Resend)
  - `APP_BASE_URL` (the same-origin public FleetGrid app URL; the current Render candidate uses `https://fleetgrid-app.onrender.com`)
The current Render candidate serves the React frontend and Node API from the same origin and uses `SameSite=Lax` session cookies. Use the Render app URL above for the production verification and password-reset links. Do not switch `APP_BASE_URL` to the separate Vercel origin unless cross-site cookie behavior is deliberately redesigned and browser-tested; adding an origin to CORS alone does not make the session cookie work cross-site.

If these settings are missing, signup returns a clear service-configuration error. It does not create a demo account or pretend an email was sent.

## Operations accounts

Operations users cannot self-register. An administrator with access to the server environment can provision an account using the CLI script.

From the repository root, ensure server dependencies are installed:

```bash
npm --prefix fleetgrid/server install
```

Set these variables in the trusted shell that has access to the intended database:

- `OPS_NAME` — operator's display name
- `OPS_EMAIL` — unique sign-in email
- `OPS_PASSWORD` — initial password (10–128 characters)
- `OPS_ROLE` — one of `CONTROL_TOWER`, `OPERATOR`, or `VERIFIER`

In development/test, run:

```bash
npm --prefix fleetgrid/server run provision:ops
```

Production provisioning is blocked unless both `FLEETGRID_ALLOW_OPS_PROVISIONING=true` and `--confirm-production` are explicitly supplied. Production also requires the approved persistent database and `FLEETGRID_POSTGRES_SCHEMA_READY=true`. Do not run the command against the legacy database before its target and backup have been reviewed.

The command stores only a password hash, marks the administrator-provisioned operations email as verified, and does not print the password. Never commit environment files or put passwords in source control.

## Production storage requirements

- Production must use a persistent PostgreSQL database. The application now refuses to start if `DATABASE_URL` is missing; it will not silently use JSON files on an ephemeral web-service filesystem.
- When `DATABASE_URL` is present in production, the app also requires `FLEETGRID_POSTGRES_SCHEMA_READY=true` before it creates the Node JSONB table and indexes.
- Set `FLEETGRID_POSTGRES_SCHEMA_READY=true` only after verifying the exact target database, backup/restore plan, schema compatibility, and approved migration procedure.
- Keep `AUTO_SEED=false`. The application must not populate production with deterministic demo identities or shipments.
- Set `CORS_ORIGIN` to the exact allowed frontend origins (comma-separated). Do not use `*` in production.
- The current Render free PostgreSQL instance is time-limited and has no free-plan backups. Select and verify a persistent database target before its expiration. No paid resource is required or authorized by this setup guide.

## Database migration — two different procedures

### JSON collections to Node PostgreSQL

`migrate-json-to-postgres.ts` imports an existing Node JSON data directory into the Node `fleetgrid_records` JSONB table. It is **not** the legacy Python/SQLAlchemy relational database importer.

- It requires `DATA_DIR` to point to the exact source JSON backup and `DATABASE_URL` to the intended target.
- Run the dry run first: `npm --prefix fleetgrid/server run migrate:postgres`.
- The dry run checks source collection files, record IDs, duplicate auth emails, active payment conflicts, and whether the target table is empty. It does not create the table or insert records.
- A non-production apply requires all three:
  - `FLEETGRID_ALLOW_JSON_IMPORT=true`
  - `--apply`
  - `--confirm-target`
- Production apply is blocked by this script. Do not bypass that guard.

### Legacy Python/SQLAlchemy PostgreSQL to Node collections

The legacy database contains normalized relational tables. It is not compatible with the Node collection store by direct copy.

- `scripts/inspect-legacy-postgres.ts` is a read-only schema/count inventory.
- `scripts/import-legacy-postgres.ts` is a read-only mapping preview. It requires a dedicated SELECT-only `LEGACY_DATABASE_URL`; it has no target connection, no apply mode, and no DDL/DML.
- Legacy user passwords/sessions are not migrated. Legacy payment rows remain quarantined until independently reconciled.
- Nullable fields, enum mappings, ownership relationships, and account recovery are governed by `DATABASE_COMPATIBILITY_DECISIONS_2026-11-23.md`.
- No production importer or production database write is authorized. A restorable backup, reviewed target, tested import, reconciliation report, and explicit production approval are required before any cutover.

## Payment demonstration

FleetGrid's Payments Hub uses the **FleetGrid Demo Simulator** for the final-year project demonstration.

- The server creates a pending record from the agreed price stored on the shipper's own driver-confirmed shipment.
- The signed-in shipper explicitly selects **Simulate successful demo payment**.
- The server validates ownership and state, then records an idempotent simulated settlement and audit event.
- No bank, card network, wallet, or payment provider is contacted. No money moves, and the record is not a tax invoice or proof of a real-world settlement.

Dodo shipment checkout, status, confirmation, and webhook endpoints are disabled. Do not add Dodo API keys, product IDs, or webhook secrets for FleetGrid shipment collections. See `DODO_PAYMENTS_SETUP.md` for the deprecation notice and rationale.


## Auxiliary Python API

The FastAPI service under `backend/` is a legacy/optional service, not the primary application API or authentication authority.

- The integration-branch Render blueprint sets `LEGACY_API_ENABLED=false`; after that candidate configuration is applied, only `/` and `/health` remain accessible and operational routes return HTTP 410 until a separate authentication and authorization review is completed. The live Render service still tracks `main` and has not received this change.
- The legacy Python payment routes and dormant payment service are disabled. They cannot create payment records or accept provider webhooks.
- Production startup does not run `alembic upgrade head` automatically. Run schema migrations manually only after a verified backup, reviewed migration plan, and explicit approval.
- Do not enable `LEGACY_API_ENABLED=true` in production merely to make an old endpoint work; the Node application is the supported user-facing API.
