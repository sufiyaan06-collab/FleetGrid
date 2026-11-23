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

- The live Render Node service still tracks `main` with auto-deploy enabled. `main` advanced to commit `236c1e4c` at 2026-11-23 23:24:03 UTC, and Render automatically deployed that commit from 23:24:05 to 23:24:45 UTC (deployment status `live`). That commit only added a capacity-offer guard for incomplete legacy route/price data; it did **not** deploy this integration branch or its authentication, demo payment, dashboard, or PostgreSQL changes. The new instance logs still show JSON-file storage and seeding of 9 trucks/4 shipments. No legacy PostgreSQL DDL/DML was observed.
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


## Progress addendum — 2026-11-24 (security and nullable-data pass)

### Latest candidate verification

GitHub Actions run [45290742448](https://github.com/sufiyaan06-collab/FleetGrid/actions/runs/45290742448) completed successfully for commit `6e1e55ea6de5db7c8fe4379b0bf82f1022f1450e`. It passed:
- React/Vite and Node/Express build.
- Node backend integration and safety tests.
- Python FastAPI backend tests.
- Playwright browser integration tests.

The workflow now watches `backend/**` and runs the Python tests as part of the same CI job.

### Additional implementation completed

- The auxiliary Python API is disabled in production by default. Only root and health endpoints remain available unless an explicit enable flag is set after a separate security review.
- Python payment creation, payment lookup, and Dodo webhook endpoints return HTTP 410. The dormant Python payment service fails closed.
- Python demo data seeding is blocked in production.
- The Render Blueprint no longer runs Alembic migrations automatically at Python service startup; schema changes require a separately reviewed manual operation.
- The Python health endpoint reports API/payment disablement. The Blueprint restricts CORS to the FleetGrid web origins.
- Legacy users without a valid organization assignment are quarantined, not inserted as active tenant users.
- Legacy organization/driver/truck/offer timestamps and contact/route/pricing metadata now allow nulls where required by the current source rows. Incomplete legacy offers are retained but cannot be searched, booked, or used for recovery estimates.
- Maps and recovery planning now avoid inventing locations, routes, or distances when GPS/route values are absent.

### Branch reconciliation

The integration branch currently compares as **407 commits ahead, 1 commit behind, and 91 changed files** relative to `main`. The one main-only commit is `236c1e4` (`fix(capacity): exclude legacy offers without route or price from booking`); the integration branch contains a stricter superset of that guard. Before a release PR is opened, this small ancestry difference should be reconciled and the final diff reviewed. No merge to `main` has occurred.

### Live deployment remains unchanged

The above are candidate-branch changes, not live production changes.

- The live Node Render service still tracks `main` with auto-deploy enabled.
- The live Python Render service also still tracks `main` with auto-deploy enabled. Its current Render service start command still runs `alembic upgrade head` before Uvicorn; the candidate Blueprint removes that automatic migration.
- Therefore the live Python service has **not** yet received the production API gate, Dodo route shutdown, or production seed guard. The old service remains publicly reachable until a reviewed deployment/configuration change is approved.
- The live Node service likewise has not received the new authentication or demo-payment implementation.
- The current Render PostgreSQL free instance still expires **2026-12-15**. It has no verified backup/restore path, and the Node `fleetgrid_records` table remains absent.

### Remaining release blockers

1. Connect/provision a free persistent PostgreSQL target (Neon is the proposed option), then verify a backup and restore of the legacy relational database before any import.
2. Complete the remaining nullable-field compatibility review for legacy tables that currently contain zero rows (shipments, events, incidents, recovery plans, payments, notifications).
3. Configure and verify production email delivery (Resend API key, verified sender, and public app URL), or explicitly approve a controlled administrator-provisioned demo-account path.
4. Reconcile the one-commit main ancestry difference, create a reviewed release PR, and obtain explicit production cutover approval.
5. Update the actual Render service settings safely before deployment; the current dashboard settings do not automatically change just because `render.yaml` changed on the integration branch.

No production database writes, migrations, account provisioning, merges, or deployments were performed during this pass.
