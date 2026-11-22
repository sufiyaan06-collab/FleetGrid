# FleetGrid Backend + Frontend Integration Tests

Run from the repository root.

## Build and backend integration suite

```bash
npm run build
npm test
```

The backend test command runs:
- Authentication primitives and password/session security checks.
- Logistics workflow/state-transition tests.
- HTTP authentication API tests against an isolated temporary JSON store.
- Multi-account integration tests for ownership boundaries, role restrictions, email verification, session revocation, rate limits, payment checkout validation, and signed provider webhook handling.
- Legacy PostgreSQL importer mapping/quarantine tests.

## Browser integration suite

Install the Chromium browser once:

```bash
cd fleetgrid/web
npm install
npx playwright install chromium
npm run test:e2e
```

The Playwright config starts an isolated local backend and Vite frontend when run locally. The backend uses a temporary directory under `/tmp`, has email delivery disabled, and does not connect to PostgreSQL, Dodo, Resend, Render, or production services.

The browser suite exercises:
- Landing page and desktop sign-in navigation.
- Real browser-to-API login request and invalid-credential feedback.
- Business/Driver registration form switching and optional truck controls.
- Fail-closed registration feedback when email delivery is not configured.
- Verification-link handling and explicit Verify email action.
- Responsive mobile navigation.

## CI

The GitHub Actions workflow builds both apps, runs all backend suites, installs Playwright Chromium, then runs the browser suite against the local API server started for the backend integration job.

## Test boundaries

Passing these tests establishes local build, API, and browser-flow integration. It does **not** establish live email delivery, live Dodo checkout/settlement, production PostgreSQL migration compatibility, production deployment health, or end-to-end acceptance with real user accounts. Those require isolated provider credentials and staging resources and must be verified separately.
