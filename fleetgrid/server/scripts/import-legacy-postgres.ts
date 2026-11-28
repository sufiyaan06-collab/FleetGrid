import { Pool } from 'pg';
import { EXPECTED_COLUMNS, mapLegacySnapshot, type LegacyRow, type LegacyTables } from './legacy-importer.js';

/**
 * Strictly read-only Python/PostgreSQL -> Node collection migration preview.
 *
 * This command has no target connection string, no --apply mode, and no DDL/DML.
 * It reads the source under a PostgreSQL READ ONLY transaction and prints only
 * aggregate counts and redacted issue codes. It never prints row values, names,
 * emails, payment references, or serialized payload contents.
 */
const forbidden = process.argv.slice(2).filter((arg) => ['--apply','--write','--target','--target-url'].includes(arg));
if (forbidden.length) {
  throw new Error('This importer is read-only. Target writes are intentionally not implemented in this command.');
}
const sourceUrl = process.env.LEGACY_DATABASE_URL;
if (!sourceUrl) {
  throw new Error('LEGACY_DATABASE_URL is required. DATABASE_URL is never used as a source or target fallback.');
}
const tableNames = [
  'organizations','users','drivers','trucks','capacity_offers','shipments',
  'shipment_events','incidents','recovery_plans','payments','notifications',
] as const;
const quote = (name: string) => `"${name.replace(/"/g,'""')}"`;
const pool = new Pool({
  connectionString: sourceUrl,
  max: 1,
  application_name: 'fleetgrid-legacy-import-dry-run',
  ...(process.env.PGSSLMODE === 'require' ? { ssl: { rejectUnauthorized: true } } : {}),
});

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 30000');
    const tableResult = await client.query<{table_name:string}>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_type='BASE TABLE'`,
    );
    const present = new Set(tableResult.rows.map((r)=>r.table_name));
    const missing = tableNames.filter((name)=>!present.has(name));
    if (missing.length) {
      throw new Error(`Legacy schema is incomplete; refusing partial import preview. Missing tables: ${missing.join(', ')}`);
    }
    const columnResult = await client.query<{
      table_name: string; column_name: string; data_type: string;
      is_nullable: 'YES' | 'NO'; column_default: string | null;
    }>(
      `SELECT table_name,column_name,data_type,is_nullable,column_default
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=ANY($1::text[])
       ORDER BY table_name,ordinal_position`,
      [tableNames],
    );
    const actualColumns = new Map<string, Set<string>>();
    for (const column of columnResult.rows) {
      if (!actualColumns.has(column.table_name)) actualColumns.set(column.table_name,new Set());
      actualColumns.get(column.table_name)!.add(column.column_name);
    }
    const schemaGaps = tableNames.flatMap(table =>
      EXPECTED_COLUMNS[table].filter(column=>!actualColumns.get(table)?.has(column))
        .map(column=>`${table}.${column}`),
    );
    if(schemaGaps.length) {
      throw new Error(`Legacy schema differs from the reviewed model. Refusing import preview until reviewed: ${schemaGaps.join(', ')}`);
    }
    const snapshot: LegacyTables = {};
    for (const table of tableNames) {
      const result = await client.query<LegacyRow>(
        `SELECT * FROM public.${quote(table)} ORDER BY id`,
      );
      snapshot[table] = result.rows;
    }
    await client.query('COMMIT');
    const report = mapLegacySnapshot(snapshot);
    const issueCounts: Record<string, number> = {};
    for (const item of report.issues) {
      const key = `${item.table}:${item.code}:${item.severity}`;
      issueCounts[key] = (issueCounts[key] ?? 0) + 1;
    }
    const summary = {
      mode: 'READ_ONLY_DRY_RUN',
      targetConnected: false,
      sourceRows: Object.values(report.summary).reduce((n,v)=>n+v.source,0),
      mappedRows: Object.values(report.summary).reduce((n,v)=>n+v.mapped,0),
      quarantinedRows: Object.values(report.summary).reduce((n,v)=>n+v.quarantined,0),
      tables: report.summary,
      sourceSchema: columnResult.rows.map(column=>({
        table:column.table_name,
        column:column.column_name,
        type:column.data_type,
        nullable:column.is_nullable==='YES',
        hasDatabaseDefault:column.column_default!==null,
      })),
      issueCounts,
      notes: [
        'No target database was connected.',
        'No INSERT, UPDATE, DELETE, DDL, or schema changes were executed.',
        'Emails, names, payment references, and raw source values are omitted from this report.',
        'Quarantined rows remain only in process memory and are not exported or written.',
        'Legacy user credentials and sessions are not migrated; no AuthAccount records are created.',
      ],
    };
    process.stdout.write(`${JSON.stringify(summary,null,2)}\n`);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
