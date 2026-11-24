import { Pool, type PoolClient } from 'pg';
import { EXPECTED_COLUMNS, mapLegacySnapshot, type LegacyRow, type LegacyTables } from './legacy-importer.js';

const TABLES = Object.keys(EXPECTED_COLUMNS) as Array<keyof typeof EXPECTED_COLUMNS>;
const TARGET = 'fleetgrid_records';
const LEDGER = 'fleetgrid_legacy_import_runs';

function assertSameDatabase(source: string, target: string): void {
  const a = new URL(source);
  const b = new URL(target);
  const normalized = (url: URL) => ({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || '5432',
    database: url.pathname,
    username: decodeURIComponent(url.username),
  });
  if (JSON.stringify(normalized(a)) !== JSON.stringify(normalized(b))) {
    throw new Error('LEGACY_DATABASE_URL and DATABASE_URL must point to the same existing Render database for this additive import.');
  }
}

async function tableExists(client: PoolClient, name: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>('SELECT to_regclass($1) IS NOT NULL AS exists', [`public.${name}`]);
  return result.rows[0]?.exists === true;
}

/**
 * One-time additive legacy import.
 *
 * - Requires explicit FLEETGRID_LEGACY_IMPORT_APPROVED=true.
 * - Reads the existing normalized tables and writes only to fleetgrid_records
 *   plus a metadata-only import ledger in the SAME Render PostgreSQL database.
 * - Preserves every legacy table and row; no UPDATE/DELETE/TRUNCATE is issued.
 * - Runs in one transaction and refuses a non-empty target or a prior ledger run.
 * - Quarantined rows remain untouched in their source tables and are counted only.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production' && process.env.RENDER !== 'true' && !process.env.RENDER_SERVICE_ID) {
    throw new Error('This apply command is restricted to the configured Render production runtime.');
  }

  const sourceUrl = process.env.LEGACY_DATABASE_URL;
  const targetUrl = process.env.DATABASE_URL;
  if (!sourceUrl || !targetUrl) throw new Error('Both LEGACY_DATABASE_URL and DATABASE_URL are required.');
  assertSameDatabase(sourceUrl, targetUrl);

  const pool = new Pool({ connectionString: targetUrl, max: 1, application_name: 'fleetgrid-legacy-import-apply' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('fleetgrid:legacy-import:v1'))");

    // Safe on every service restart: after a successful import, verify the ledger
    // and target count, then exit without touching source or target records.
    if (await tableExists(client, LEDGER)) {
      const prior = await client.query<{
        source_rows: number;
        imported_rows: number;
        quarantined_rows: number;
      }>(
        `SELECT source_rows, imported_rows, quarantined_rows
         FROM public.${LEDGER} WHERE id = $1`,
        ['legacy-python-postgres-v1'],
      );
      if (prior.rows.length === 1) {
        // The live application legitimately adds records after migration (new
        // accounts, organizations, shipments, etc.). Do not compare the entire
        // target-table count with the one-time import count. Instead, remap the
        // preserved legacy source and verify that every originally imported
        // (collection, id) pair still exists. This detects missing migrated
        // records without rejecting new application data.
        const snapshot: LegacyTables = {};
        for (const table of TABLES) {
          const rows = await client.query<LegacyRow>(`SELECT * FROM public."${table}" ORDER BY id`);
          snapshot[table] = rows.rows;
        }
        const report = mapLegacySnapshot(snapshot);
        const mapped = report.records.filter(
          (record) => record.outcome === 'mapped' && record.collection && record.data,
        );
        const sourceRows = Object.values(report.summary).reduce((sum, row) => sum + row.source, 0);
        const quarantinedRows = Object.values(report.summary).reduce((sum, row) => sum + row.quarantined, 0);
        const ledger = prior.rows[0]!;
        if (
          sourceRows !== Number(ledger.source_rows) ||
          mapped.length !== Number(ledger.imported_rows) ||
          quarantinedRows !== Number(ledger.quarantined_rows)
        ) {
          throw new Error('Legacy source counts no longer match the approved import ledger. Refusing to start.');
        }

        const expectedCollections = mapped.map((record) => record.collection!);
        const expectedIds = mapped.map((record) => record.sourceId);
        const verified = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM unnest($1::text[], $2::text[]) AS expected(collection, id)
           JOIN public.${TARGET} target USING (collection, id)`,
          [expectedCollections, expectedIds],
        );
        if (Number(verified.rows[0]?.count ?? 0) !== mapped.length) {
          throw new Error('One or more originally imported records are missing from fleetgrid_records. Refusing to start.');
        }

        await client.query('COMMIT');
        process.stdout.write(JSON.stringify({
          mode: 'ALREADY_IMPORTED_VERIFIED',
          importedRows: mapped.length,
          additionalApplicationRowsAllowed: true,
          noChangesMade: true,
        }, null, 2) + '\\n');
        return;
      }
      const ledgerCount = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${LEDGER}`);
      if (Number(ledgerCount.rows[0]?.count ?? 0) > 0) {
        throw new Error('An unrecognized import ledger entry exists. Refusing to run.');
      }
    }

    if (process.env.FLEETGRID_LEGACY_IMPORT_APPROVED !== 'true') {
      throw new Error('Blocked. Set FLEETGRID_LEGACY_IMPORT_APPROVED=true only after reviewing the dry-run report and approving this production import.');
    }

    const sourceTables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    const present = new Set(sourceTables.rows.map(row => row.table_name));
    const missing = TABLES.filter(table => !present.has(table));
    if (missing.length) throw new Error(`Source schema incomplete; missing: ${missing.join(', ')}`);

    const columnResult = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name=ANY($1::text[])`,
      [TABLES],
    );
    const columns = new Map<string, Set<string>>();
    for (const item of columnResult.rows) {
      if (!columns.has(item.table_name)) columns.set(item.table_name, new Set());
      columns.get(item.table_name)!.add(item.column_name);
    }
    const gaps = TABLES.flatMap(table =>
      EXPECTED_COLUMNS[table].filter(column => !columns.get(table)?.has(column)).map(column => `${table}.${column}`),
    );
    if (gaps.length) throw new Error(`Source schema differs from the reviewed contract: ${gaps.join(', ')}`);

    const snapshot: LegacyTables = {};
    for (const table of TABLES) {
      const rows = await client.query<LegacyRow>(`SELECT * FROM public."${table}" ORDER BY id`);
      snapshot[table] = rows.rows;
    }
    const report = mapLegacySnapshot(snapshot);

    const targetAlreadyExists = await tableExists(client, TARGET);
    if (targetAlreadyExists) {
      const count = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${TARGET}`);
      if (Number(count.rows[0]?.count ?? 0) !== 0) {
        throw new Error('Target fleetgrid_records is not empty. Refusing to overwrite or merge into existing application records.');
      }
    }
    const ledgerAlreadyExists = await tableExists(client, LEDGER);
    if (ledgerAlreadyExists) {
      const prior = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${LEDGER}`);
      if (Number(prior.rows[0]?.count ?? 0) !== 0) throw new Error('A legacy import ledger entry already exists. This one-time importer will not run twice.');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${TARGET} (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (collection, id)
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS fleetgrid_records_collection_idx ON public.${TARGET} (collection)`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fleetgrid_auth_email_unique_idx
      ON public.${TARGET} ((LOWER(data->>'email')))
      WHERE collection = 'auth-accounts'
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS fleetgrid_active_payment_shipment_unique_idx
      ON public.${TARGET} ((data->>'shipmentId'))
      WHERE collection = 'payments' AND data->>'status' IN ('CREATED', 'PENDING', 'PAID')
    `);

    let imported = 0;
    for (const record of report.records) {
      if (record.outcome !== 'mapped' || !record.collection || !record.data) continue;
      await client.query(
        `INSERT INTO public.${TARGET} (collection,id,data) VALUES ($1,$2,$3::jsonb)`,
        [record.collection, record.sourceId, JSON.stringify(record.data)],
      );
      imported++;
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.${LEDGER} (
        id TEXT PRIMARY KEY,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_database TEXT NOT NULL,
        source_rows INTEGER NOT NULL,
        imported_rows INTEGER NOT NULL,
        quarantined_rows INTEGER NOT NULL,
        table_summary JSONB NOT NULL
      )
    `);
    const sourceRows = Object.values(report.summary).reduce((sum, row) => sum + row.source, 0);
    const quarantinedRows = Object.values(report.summary).reduce((sum, row) => sum + row.quarantined, 0);
    const dbName = new URL(targetUrl).pathname.replace(/^\//, '');
    await client.query(
      `INSERT INTO public.${LEDGER} (id,source_database,source_rows,imported_rows,quarantined_rows,table_summary)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      ['legacy-python-postgres-v1', dbName, sourceRows, imported, quarantinedRows, JSON.stringify(report.summary)],
    );

    const verify = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM public.${TARGET}`);
    if (Number(verify.rows[0]?.count ?? 0) !== imported) {
      throw new Error('Post-import target row count does not match inserted row count.');
    }
    await client.query('COMMIT');

    process.stdout.write(JSON.stringify({
      mode: 'APPLIED_ADDITIVE_IMPORT',
      importedRows: imported,
      sourceRows,
      quarantinedRows,
      tables: report.summary,
      legacyTablesPreserved: true,
      rawSourceRowsExported: false,
    }, null, 2) + '\n');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error('[fleetgrid] legacy import blocked or failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
