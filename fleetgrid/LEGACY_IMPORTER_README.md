# Legacy PostgreSQL Import Preview

## Safety properties

The current importer is intentionally a **read-only preview**, not an apply tool.

- Reads only `LEGACY_DATABASE_URL`.
- Starts a PostgreSQL `BEGIN READ ONLY` transaction.
- Uses a fixed allowlist of legacy tables and verifies the reviewed column contract before reading rows.
- Has no target connection string, no target DB fallback, no `--apply` mode, and no DDL/DML.
- Does not create a migration table, import ledger, or target schema.
- Prints aggregate table counts, schema metadata, and redacted issue codes only. It never prints row values, names, emails, payment references, or JSON payload contents.
- Keeps raw source rows in process memory only for mapping/quarantine analysis. It does not persist or export them.
- Does not create Node AuthAccount records and does not migrate legacy credentials.

The source database credential should itself be a read-only PostgreSQL role. The transaction is independently marked read-only by the importer.

## Run from the repository root

Install dependencies if needed:

```bash
npm --prefix fleetgrid/server install
```

Set `LEGACY_DATABASE_URL` in your local shell to a read-only connection string for a restored snapshot or approved source. Do not paste credentials into chat, commit them, or set `DATABASE_URL` for this command.

PowerShell:

```powershell
$env:LEGACY_DATABASE_URL = "postgresql://READ_ONLY_USER:REDACTED@HOST:5432/DB"
$env:PGSSLMODE = "require"
npm run import:legacy:dry-run --prefix fleetgrid/server
```

macOS/Linux:

```bash
export LEGACY_DATABASE_URL='postgresql://READ_ONLY_USER:REDACTED@HOST:5432/DB'
export PGSSLMODE=require
npm run import:legacy:dry-run --prefix fleetgrid/server
```

The output is a sanitized JSON report. A schema mismatch aborts the preview rather than guessing how to map an unreviewed column layout. Rows with unsafe values or unresolved required relationships are counted as quarantined; optional missing links remain null with a warning.

## Tests

From the repository root:

```bash
npm test
npm run build
```

The server test command includes `test/legacy-importer.test.ts`. The root build includes the TypeScript script typecheck.

## What this does not authorize

No staging or production writes are possible through this preview command. A separate staging-only apply tool must be designed after:
1. Node domain and API/UI types can safely represent all documented null and legacy enum states.
2. The real source schema metadata has been reviewed against the preview's `sourceSchema` output.
3. A restorable backup and isolated staging target are available.
4. An apply tool has a hard staging allowlist, empty-target preflight, transactional writes, private audit/quarantine storage, count/FK reconciliation, and rollback rehearsal.

Production migration remains a separate, explicitly approved release activity.
