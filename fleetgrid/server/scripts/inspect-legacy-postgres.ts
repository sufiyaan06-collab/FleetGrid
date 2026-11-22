import { Pool } from 'pg';

/**
 * Read-only inventory of the legacy SQLAlchemy schema.
 *
 * This utility intentionally does not read business row contents, change schema,
 * or connect to a target database. It reports table/column/FK metadata, row counts,
 * and distinct status/role values so a later importer can be designed against the
 * actual deployed schema rather than assumptions from ORM source files.
 */
const connectionString = process.env.LEGACY_DATABASE_URL;
if (!connectionString) {
  throw new Error('LEGACY_DATABASE_URL is required. No database target is inferred.');
}

const expectedTables = [
  'organizations',
  'users',
  'drivers',
  'trucks',
  'shipments',
  'capacity_offers',
  'shipment_events',
  'incidents',
  'recovery_plans',
  'payments',
  'notifications',
];

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

const pool = new Pool({
  connectionString,
  max: 1,
  application_name: 'fleetgrid-legacy-schema-inspector',
  ...(process.env.PGSSLMODE === 'require'
    ? { ssl: { rejectUnauthorized: true } }
    : {}),
});

try {
  await pool.query('SET default_transaction_read_only = on');
  await pool.query('BEGIN READ ONLY');

  const tables = await pool.query<{
    table_name: string;
    table_type: string;
  }>(
    `SELECT table_name, table_type
     FROM information_schema.tables
     WHERE table_schema = 'public'
     ORDER BY table_name`,
    [expectedTables],
  );

  const columns = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name, ordinal_position`,
    [expectedTables],
  );

  const foreignKeys = await pool.query<{
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    constraint_name: string;
  }>(
    `SELECT tc.table_name, kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name,
            tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
      AND tc.constraint_schema = kcu.constraint_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name
      AND ccu.constraint_schema = tc.constraint_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = 'public'
       AND tc.table_name = ANY($1::text[])
     ORDER BY tc.table_name, tc.constraint_name`,
    [expectedTables],
  );

  const publicTableNames = tables.rows.map((row) => row.table_name);
  const expectedPresentTables = expectedTables.filter((name) => publicTableNames.includes(name));
  const counts: Record<string, string> = {};
  for (const table of expectedPresentTables) {
    // Table identifiers are selected only from the fixed allowlist above.
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.${quoteIdentifier(table)}`,
    );
    counts[table] = result.rows[0]?.count ?? '0';
  }

  const statusColumns = columns.rows.filter(({ column_name }) =>
    ['status', 'role', 'type', 'proof_status', 'location_status'].includes(column_name),
  );
  const distinctValues: Record<string, string[]> = {};
  for (const item of statusColumns) {
    const result = await pool.query<{ value: string | null }>(
      `SELECT DISTINCT "${item.column_name}"::text AS value
       FROM public."${item.table_name}"
       ORDER BY value NULLS FIRST`,
    );
    distinctValues[`${item.table_name}.${item.column_name}`] =
      result.rows.map((row) => row.value ?? '<NULL>');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    database: 'legacy source (connection details omitted)',
    readOnly: true,
    expectedTables,
    missingTables: expectedTables.filter((name) => !publicTableNames.includes(name)),
    unexpectedPublicTables: publicTableNames.filter((name) => !expectedTables.includes(name)),
    tables: tables.rows.filter((row) => expectedTables.includes(row.table_name)),
    rowCounts: counts,
    columns: columns.rows,
    foreignKeys: foreignKeys.rows,
    distinctStateValues: distinctValues,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await pool.query('COMMIT');
} catch (error) {
  try {
    await pool.query('ROLLBACK');
  } catch {
    // Preserve the original inspection error.
  }
  throw error;
} finally {
  await pool.end();
}
