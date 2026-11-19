# FleetGrid account and operations setup

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
  - `APP_BASE_URL` (the public frontend origin, for example `https://ember-beryl-phi.vercel.app`)

If these settings are missing, signup returns a clear service-configuration error. It does not create a demo account or pretend an email was sent.

## Operations accounts

Operations users cannot self-register. An administrator with access to the server environment can provision an account using the CLI script.

From the repository root, first ensure the server dependencies are installed:

```bash
npm --prefix fleetgrid/server install
```

Set the environment variables in the trusted shell that has access to the production `DATABASE_URL`:

- `OPS_NAME` — operator's display name
- `OPS_EMAIL` — unique sign-in email
- `OPS_PASSWORD` — initial password (10–128 characters)
- `OPS_ROLE` — one of `CONTROL_TOWER`, `OPERATOR`, or `VERIFIER`

Then run:

```bash
npm --prefix fleetgrid/server run provision:ops
```

The command stores only a password hash, marks the administrator-provisioned operations email as verified, and does not print the password. Do not commit environment files or put passwords in source control. Use your hosting provider's secret environment settings or a secure shell session.

## Production requirements

- Set `CORS_ORIGIN` to the exact allowed frontend origins (comma-separated). Do not use `*` in production.
- Keep `AUTO_SEED=false` so a fresh production database does not receive demonstration shipments or drivers.
- Do not enable deployment until the production database has been backed up and the new Node PostgreSQL store has a reviewed migration plan.
- Email verification and real Dodo payment settlement are separate integrations; configure and test them independently.

## JSON-to-PostgreSQL migration

The Node API can use PostgreSQL, but the application must not be switched to a new empty database while existing JSON records are still needed.

1. Take a full backup of the current JSON data directory and keep the original files unchanged.
2. Make the backup available to the migration environment and set `DATA_DIR` to that directory.
3. Set `DATABASE_URL` to the intended Render PostgreSQL connection string. Do not paste it into source control or a chat.
4. Install server dependencies with `npm --prefix fleetgrid/server install`.
5. Run a dry run first: `npm --prefix fleetgrid/server run migrate:postgres`.
6. Confirm the printed collection counts match the backup and the target `fleetgrid_records` table is empty.
7. Only after reviewing the backup and dry-run output, run `npm --prefix fleetgrid/server run migrate:postgres -- --apply`.
8. Verify the imported record counts and application workflows before changing the production service to use PostgreSQL.

The migration utility refuses to write if the target table already contains records, checks record IDs and duplicate account emails, and wraps all inserts in one database transaction. It never edits or deletes the source JSON files. If the dry run or import reports an error, stop and investigate rather than clearing the target database.

The migration must be coordinated with a maintenance window or a write freeze so records are not created or changed between taking the backup and switching the application. Do not run the import against a database that already contains live application records.

## Dodo Payments configuration

The Dodo checkout endpoint is enabled only when both the API and signed-webhook settings are present. Configure these values in the Render service's secret environment settings:

- `DODO_PAYMENTS_API_KEY` — server-side Dodo API key.
- `DODO_PRODUCT_ID` — a real product ID from the same Dodo account and mode.
- `DODO_ENVIRONMENT` — use `test_mode` while testing; switch to `live_mode` only after successful end-to-end verification.
- `DODO_PAYMENTS_WEBHOOK_KEY` — the signing secret for the webhook endpoint created in Dodo.
- `DODO_PAYMENTS_WEBHOOK_ENABLED` — leave unset/false until signed test-mode webhook delivery has been verified; set to `true` only after that test passes.
- `APP_BASE_URL` — the public FleetGrid frontend URL used for the checkout return.

Configure the Dodo webhook URL as:

`https://fleetgrid-app.onrender.com/payments/dodo/webhook`

Subscribe to `payment.succeeded`, `payment.failed`, and `payment.cancelled`. The endpoint verifies the Standard Webhooks signature against the original raw request body, checks the checkout-session reference and currency, and treats duplicate events idempotently. Browser redirects and the browser confirmation endpoint cannot mark a payment as paid.

Do not enable checkout until the webhook endpoint is configured and tested in Dodo test mode. The API additionally requires `DODO_PAYMENTS_WEBHOOK_ENABLED=true`, so merely adding an API key or secret does not open checkout. A successful payment event updates the payment record only; it does not bypass the driver's shipment-acceptance workflow.
