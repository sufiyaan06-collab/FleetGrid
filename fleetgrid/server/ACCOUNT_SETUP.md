# FleetGrid account and operations setup

## Shipper and driver accounts

- Self-service signup is available for `BUSINESS` (Shipper) and `DRIVER` accounts only.
- Signup requires an email address, a password of at least 10 characters, and contact details.
- The API sends a 24-hour email-verification link through Resend.
- A user cannot sign in until the email has been verified.
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
