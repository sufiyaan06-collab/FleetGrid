# FleetGrid

**FleetGrid — AI-assisted freight operations and shared-capacity logistics platform**

A final-year engineering project demonstrating a connected shipper, driver, and operations workflow: discover spare freight capacity, reserve and track shipments, coordinate incidents, and preserve operational events in an auditable backend.

## Main application

The primary user-facing application lives in `fleetgrid/`:

- **React + Vite** responsive web interface.
- **Node.js + Express** authoritative REST API and WebSocket updates.
- **PostgreSQL JSONB collection store** for the Node domain model.
- **Real authentication** with password hashing, server-side sessions, email verification, rate limiting, and password reset.
- **Business / Shipper portal** for capacity search, shipment creation, and tracking.
- **Driver portal** for assigned work, acceptance, journey updates, and incident reporting.
- **Control Tower** for network visibility, incident review, and recovery workflows.
- **Payments Hub** with a clearly labelled server-controlled demo simulator.

The Python FastAPI service in `backend/` remains as a separate auxiliary/legacy service. It is not the authentication authority for the primary React/Node application.

## Payment demonstration

The Payments Hub is intentionally **DEMO ONLY** for this academic project:

1. A shipper selects one of their own driver-confirmed shipments.
2. FleetGrid creates a pending payment record using the shipment's server-stored agreed amount.
3. The shipper explicitly selects **Simulate successful demo payment**.
4. The server validates ownership and payment state, then records the simulated settlement and audit event.

No bank, card network, wallet, or payment provider is contacted. No money moves. The record is not a tax invoice or proof of a real-world settlement. Dodo shipment-payment endpoints are disabled.

## Architecture

```text
React + Vite web application
          |
          | REST + WebSocket
          v
Node.js / Express API
  - authentication and roles
  - shipper / driver / operations workflows
  - incident and recovery state machines
  - demo payment simulator
          |
          v
PostgreSQL JSONB collections
          |
          +---- optional Python FastAPI service
                (legacy / auxiliary workflows)
```

## Local development

Requires Node.js 20+.

From the repository root:

```bash
# Install/build the frontend and backend dependencies and compile both
npm run build

# Start the Node API (default http://localhost:4000)
npm run dev --prefix fleetgrid/server

# In a second terminal, start the web UI (default http://localhost:5173)
npm run dev --prefix fleetgrid/web
```

In local development, if `DATABASE_URL` is not set, the API uses JSON files under `fleetgrid/server/data` and can seed deterministic demo data. This fallback is for local development and automated tests only; production refuses to start with JSON-file storage.

For local demo role access, use the development-only demo login flow. It is disabled in production. Do not use seeded demo identities as real user accounts.

## Authentication email configuration

Self-service signup supports `BUSINESS` and `DRIVER` accounts. Production signup requires a verified Resend sender and these server-side environment variables:

- `RESEND_API_KEY`
- `EMAIL_FROM`
- `APP_BASE_URL`

Email verification is required before sign-in. If email delivery is not configured, signup fails clearly instead of pretending that an email was sent. Operations roles are provisioned separately by an administrator; they cannot self-register.

See [account and storage setup](fleetgrid/server/ACCOUNT_SETUP.md).

## Production storage and migration safety

Production must use a persistent PostgreSQL target:

- `DATABASE_URL` is required in production.
- `FLEETGRID_POSTGRES_SCHEMA_READY=true` is required before the Node app creates its JSONB table and indexes.
- Keep `AUTO_SEED=false`; deterministic demo records must not be inserted into production.
- Do not enable the schema gate until the target database, backup/restore plan, and migration are reviewed.
- The existing Render PostgreSQL database contains legacy relational tables. The legacy importer is currently read-only; it does not write to a target.
- The Render free PostgreSQL plan is time-limited. A persistent target must be selected before the current database expires.

The JSON-to-PostgreSQL script migrates Node JSON collections only; it is not the legacy relational importer. Production writes are blocked by the migration script. See:

- [Database compatibility decisions](fleetgrid/DATABASE_COMPATIBILITY_DECISIONS_2026-11-23.md)
- [Legacy database migration plan](fleetgrid/LEGACY_DATABASE_MIGRATION_PLAN.md)
- [Legacy importer guide](fleetgrid/LEGACY_IMPORTER_README.md)
- [Dodo deprecation notice](fleetgrid/DODO_PAYMENTS_SETUP.md)

## Tests

From the repository root:

```bash
# Build frontend and backend
npm run build

# Backend integration and safety tests
npm test --prefix fleetgrid/server

# Browser integration tests (Playwright)
npm run test:e2e --prefix fleetgrid/web
```

The GitHub Actions workflow runs the frontend/backend build, backend integration tests, and Playwright browser tests for the production and integration branches.

## Deployment status

The integration branch is verified separately from the live production deployment. The live Render Node service still tracks `main` and auto-deploys commits to that branch. Do not merge or push to `main` until database migration, email configuration, and production cutover checks are approved.
