import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { initializePostgres } from '../src/store/postgresStore.js';

interface MigrationRow {
  id: string;
  [key: string]: unknown;
}

const collections = [
  ['organizations', 'organizations.json'],
  ['users', 'users.json'],
  ['auth-accounts', 'auth-accounts.json'],
  ['drivers', 'drivers.json'],
  ['trucks', 'trucks.json'],
  ['shipments', 'shipments.json'],
  ['capacity-offers', 'capacity-offers.json'],
  ['incidents', 'incidents.json'],
  ['recovery-plans', 'recovery-plans.json'],
  ['payments', 'payments.json'],
  ['shipment-events', 'shipment-events.json'],
  ['notifications', 'notifications.json'],
] as const;

async function loadCollection(filePath: string): Promise<MigrationRow[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, 'utf8');
  const parsed: unknown = raw.trim() ? JSON.parse(raw) : [];
  if (!Array.isArray(parsed)) throw new Error(`Expected ${filePath} to contain a JSON array.`);
  const rows = parsed as MigrationRow[];
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim()) {
      throw new Error(`A record in ${filePath} has no valid id.`);
    }
    if (ids.has(row.id)) throw new Error(`Duplicate id ${row.id} in ${filePath}.`);
    ids.add(row.id);
  }
  return rows;
}

const sourceDir = resolve(process.env.DATA_DIR ?? resolve(process.cwd(), 'data'));
const apply = process.argv.includes('--apply');
const production = process.env.NODE_ENV === 'production'
  || process.env.RENDER === 'true'
  || Boolean(process.env.RENDER_SERVICE_ID);
const connectionString = process.env.DATABASE_URL;

if (apply && production) {
  throw new Error('JSON-to-Postgres apply is blocked in production. Use the separately reviewed production migration procedure.');
}
if (apply && process.env.FLEETGRID_ALLOW_JSON_IMPORT !== 'true') {
  throw new Error('Set FLEETGRID_ALLOW_JSON_IMPORT=true only after reviewing the exact target and verified backup.');
}
if (apply && !process.argv.includes('--confirm-target')) {
  throw new Error('Pass --confirm-target together with --apply to confirm the explicitly reviewed empty target.');
}

if (!connectionString) {
  throw new Error('DATABASE_URL is required. This script never guesses a database target.');
}

const recognizedSourceFiles = collections.filter(([, filename]) => existsSync(resolve(sourceDir, filename)));
if (recognizedSourceFiles.length === 0) {
  throw new Error(`No recognised FleetGrid JSON collection files were found in ${sourceDir}. Check DATA_DIR; migration stopped.`);
}

const loaded = await Promise.all(
  collections.map(async ([collection, filename]) => ({
    collection,
    filename,
    rows: await loadCollection(resolve(sourceDir, filename)),
  })),
);

const accountRows = loaded.find((item) => item.collection === 'auth-accounts')?.rows ?? [];
const paymentRows = loaded.find((item) => item.collection === 'payments')?.rows ?? [];
const activeShipmentPayments = new Set<string>();
for (const payment of paymentRows) {
  const shipmentId = typeof payment.shipmentId === 'string' ? payment.shipmentId : '';
  const status = typeof payment.status === 'string' ? payment.status : '';
  if (shipmentId && ['CREATED', 'PENDING', 'PAID'].includes(status)) {
    if (activeShipmentPayments.has(shipmentId)) {
      throw new Error(`Multiple active payments exist for shipment ${shipmentId}. Resolve duplicates before migration.`);
    }
    activeShipmentPayments.add(shipmentId);
  }
}
const emails = new Set<string>();
for (const account of accountRows) {
  const email = typeof account.email === 'string' ? account.email.trim().toLowerCase() : '';
  if (!email) throw new Error('An auth account has no valid email address.');
  if (emails.has(email)) throw new Error(`Duplicate auth email detected: ${email}. Resolve duplicates before migration.`);
  emails.add(email);
}

const total = loaded.reduce((sum, item) => sum + item.rows.length, 0);
if (total === 0) throw new Error('No records were found in the source JSON files. Refusing to import an empty dataset.');
process.stdout.write(`Source: ${sourceDir}\n`);
for (const item of loaded) process.stdout.write(`  ${item.collection}: ${item.rows.length} records\n`);
process.stdout.write(`Total: ${total} records\n`);

const pool = new Pool({
  connectionString,
  max: 2,
  ...(process.env.PGSSLMODE === 'require' ? { ssl: { rejectUnauthorized: true } } : {}),
});

try {
  const tableCheck = await pool.query<{ table_exists: boolean }>(
    "SELECT to_regclass('public.fleetgrid_records') IS NOT NULL AS table_exists",
  );
  if (tableCheck.rows[0]?.table_exists) {
    const existing = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fleetgrid_records',
    );
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      throw new Error('Target fleetgrid_records table is not empty. Migration stopped without changing existing records.');
    }
  }

  if (!apply) {
    process.stdout.write('DRY RUN ONLY: target table is absent or empty and source data passed validation. No database schema or records were changed. Re-run with --apply --confirm-target and FLEETGRID_ALLOW_JSON_IMPORT=true to import to the explicitly reviewed non-production target.\n');
  } else {
    await initializePostgres(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of loaded) {
        for (const row of item.rows) {
          await client.query(
            'INSERT INTO fleetgrid_records (collection, id, data) VALUES ($1, $2, $3::jsonb)',
            [item.collection, row.id, JSON.stringify(row)],
          );
        }
      }
      await client.query('COMMIT');
      process.stdout.write(`Migration completed: imported ${total} records. Source JSON files were not modified.\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
