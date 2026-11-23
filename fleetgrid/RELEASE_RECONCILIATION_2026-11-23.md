# FleetGrid release reconciliation — 2026-11-23

## Scope
This is a working release branch only. It is not connected to Render and is not a staging deployment. Production `main`, Render services, and the production database are not modified by this record.

## Branch comparison
- Production base: `main` at `64dbf635d6739a2b9286223d4d8a5ff362b544ac`.
- Candidate implementation: `upgrade/real-app-auth-2026-11-18` at `3cde39e2f0a327c65f51d8b60614b449ec717eb9`.
- Dashboard branch: `release/professional-dashboard-2026-11-23` at `12849079921a8cde761e8586db8b063c57adbc00`.
- The upgrade branch is 302 commits ahead of main. The dashboard branch is 181 commits ahead of main.
- The dashboard branch is divergent from the upgrade branch (one unique dashboard-branch commit and 122 commits not present on that branch at comparison time).

## Dashboard reconciliation decision
The dashboard branch's unique commit is titled "Replace demo reroute modal with live incident focus and safe refresh". Its intent is sound: remove fabricated AI reroute claims and demo-reset controls, focus the map on a real active incident, and refresh authoritative server state. The newer upgrade branch already contains the safe incident-focus and refresh behavior, and additionally derives the operator identity from the authenticated session. Therefore, do not merge the older dashboard branch wholesale or overwrite the newer Control Tower implementation.

## Payment scope decision
FleetGrid is a final-year engineering project. Do not activate Dodo Payments for shipper-to-carrier shipment collections. Implement a clearly labelled, test-only payment demonstration with server-side state transitions and no real money movement. Browser redirects or client-side claims must never mark a payment as paid. Preserve provider integration code for review, but keep it unreachable/disabled for shipment settlement.

## Database safety
The Node application supports PostgreSQL JSONB collections through `fleetgrid_records`, while the existing production PostgreSQL contains legacy relational tables used by the Python backend. Do not point the Node application at production storage or run migration writes until backup/restore is verified, the read-only source preview is reviewed, nullable-field handling is complete, and rollback is rehearsed. Preserve the legacy tables and all existing records.

## Verification snapshot
GitHub Actions run `45071345190` for candidate commit `3cde39e2f0a327c65f51d8b60614b449ec717eb9` completed successfully: frontend/backend build, backend end-to-end tests, and frontend browser integration tests all passed. These checks do not establish production email delivery, live provider settlement, production database compatibility, or production deployment health.

## Release gates still open
1. Implement and test the test-only payment workflow.
2. Confirm all production authentication and role/ownership rules through tests.
3. Complete nullable legacy field compatibility in domain logic and UI.
4. Run the read-only legacy database preview against a controlled read-only source.
5. Verify backup and restore capability before any target writes.
6. Verify persistent storage behavior and deployment health without switching production.
7. Review final changes and explicit production cutover approval before merging to `main`.


## Progress addendum — 2026-11-24

This addendum supersedes the earlier open-item wording where the implementation has since been completed.

### Completed on the integration branch

- Payment Hub now uses the FleetGrid Demo Simulator. It creates a pending record from the shipment's server-stored price, checks shipper ownership, and allows only an explicit server-side simulated settlement. Tests cover duplicate prevention, cross-shipper denial, idempotent settlement, and client-supplied amount spoofing.
- Legacy Dodo shipment checkout, status, confirmation, and webhook routes return HTTP 410. Dodo setup instructions have been retired; no provider keys or real-money movement are required for the project demo.
- Production storage fails closed: missing `DATABASE_URL` prevents startup, and PostgreSQL schema initialization requires `FLEETGRID_POSTGRES_SCHEMA_READY=true`.
- JSON-to-PostgreSQL apply is blocked in production and requires explicit non-production approval flags. Production operations-account provisioning also requires explicit approval flags.
- Account/setup docs and the root README now describe the current Node/React application, demo payments, authentication email requirements, and migration gates.

### Latest verification

GitHub Actions run [45287681820](https://github.com/sufiyaan06-collab/FleetGrid/actions/runs/45287681820) completed successfully for commit `af2322391c0b4a00dcfbcc1ef98e20a5d08065c6`: frontend/backend build, backend integration and safety tests, and Playwright browser integration tests all passed.

The integration branch is currently 332 commits ahead of `main` and changes 72 files. It remains separate from production.

### Production facts and remaining release gates

- The live Render Node service still tracks `main` with auto-deploy enabled. No merge, push to `main`, or deployment has occurred.
- The existing Render PostgreSQL instance is on the Free plan and expires **2026-12-15**. Its legacy relational tables remain untouched. The Node `fleetgrid_records` table is absent; the live application has not been cut over to the new store.
- The live app's current JSON-file storage is not durable across Render restarts. The production storage guard prevents the candidate code from silently repeating that unsafe configuration.
- The legacy relational-to-Node importer remains read-only. Nullable legacy values still require complete domain/UI compatibility work; no importer apply path is authorized.
- Production signup and password reset require a configured Resend API key, verified sender, and public app URL. Production email delivery has not been verified.
- A persistent PostgreSQL target must be selected, the existing legacy database backed up and restored, and the migration/import reconciled before setting the production schema gate.
- A clean release review and explicit approval are still required before creating a production cutover or allowing Render's `main` auto-deploy to run.


## Deployment safety addendum — 2026-11-24

- The Render Node service is still configured on the live account to track `main` with automatic deploys enabled. Its current runtime is the older main-branch app; do not merge the candidate until the separate Node PostgreSQL target and email sender are ready.
- The live auxiliary Python service is also still configured to track `main` with automatic deploys enabled, and its current start command is `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`. It connects to the legacy relational database. The candidate Blueprint now disables automatic deploys for both services and removes Alembic migrations from Python startup, but this repository change does not change the already-created Render service settings. Before any main-branch merge, manually disable auto-deploy on both live services and replace the Python start command with `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (or keep that service suspended/unused after verifying Node does not depend on it). No live Render settings were changed.
- The Node service's candidate Blueprint no longer binds `DATABASE_URL` to the legacy `fleetgrid-db`; the Python service remains the only service connected to that database. The Node application intentionally refuses production startup without a separately selected PostgreSQL target and the explicit schema-readiness gate.
- Free database review: Neon currently lists a $0 Free plan with 1 GB per project, 100 compute-hours/month, 5 GB public transfer, and a 6-hour instant-restore history; compute scales to zero after inactivity. It is suitable for a student demonstration within limits, but is not a substitute for independently verified backups. Supabase Free provides 500 MB and may pause projects after seven days of low activity. No provider account or database was created. References: https://neon.com/docs/introduction/plans and https://supabase.com/docs/guides/platform/free-project-pausing.
- A read-only audit of the current Render service configuration and logs confirmed that no production service was deployed from the candidate branch and no production database writes occurred.
