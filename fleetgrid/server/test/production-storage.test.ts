import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const script = "import { db } from './src/store/db.ts'; await db.initialize();";
const baseEnv = {
  ...process.env,
  NODE_ENV: 'production',
  RENDER: '',
  RENDER_SERVICE_ID: '',
  AUTO_SEED: 'false',
  DATA_DIR: '/tmp/fleetgrid-production-storage-guard-test',
};

const missingDatabase = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', script],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: { ...baseEnv, DATABASE_URL: '', FLEETGRID_POSTGRES_SCHEMA_READY: '' },
  },
);
assert.notEqual(missingDatabase.status, 0, 'production must refuse to start without DATABASE_URL');
assert.match(
  missingDatabase.stderr,
  /DATABASE_URL is required in production/,
  'the failure explains that ephemeral JSON storage is not allowed',
);

const unapprovedSchema = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--input-type=module', '-e', script],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      DATABASE_URL: 'postgres://fleetgrid:invalid@127.0.0.1:1/fleetgrid',
      FLEETGRID_POSTGRES_SCHEMA_READY: '',
    },
  },
);
assert.notEqual(unapprovedSchema.status, 0, 'production must refuse schema initialization without an explicit gate');
assert.match(
  unapprovedSchema.stderr,
  /FLEETGRID_POSTGRES_SCHEMA_READY=true is required/,
  'the failure explains the schema readiness gate before any database connection',
);


const productionImport = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/migrate-json-to-postgres.ts', '--apply'],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      DATABASE_URL: 'postgres://fleetgrid:invalid@127.0.0.1:1/fleetgrid',
      FLEETGRID_ALLOW_JSON_IMPORT: 'true',
    },
  },
);
assert.notEqual(productionImport.status, 0, 'JSON import writes must be blocked in production');
assert.match(productionImport.stderr, /JSON-to-Postgres apply is blocked in production/);

const unapprovedImport = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/migrate-json-to-postgres.ts', '--apply'],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://fleetgrid:invalid@127.0.0.1:1/fleetgrid',
      FLEETGRID_ALLOW_JSON_IMPORT: '',
    },
  },
);
assert.notEqual(unapprovedImport.status, 0, 'non-production import still requires explicit approval');
assert.match(unapprovedImport.stderr, /FLEETGRID_ALLOW_JSON_IMPORT=true/);

const unapprovedOpsProvision = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/provision-ops.ts'],
  {
    cwd: serverRoot,
    encoding: 'utf8',
    env: {
      ...baseEnv,
      OPS_NAME: 'Integration Operator',
      OPS_EMAIL: 'operator@example.test',
      OPS_PASSWORD: 'Integration-Password-2026',
      OPS_ROLE: 'OPERATOR',
      FLEETGRID_ALLOW_OPS_PROVISIONING: 'true',
    },
  },
);
assert.notEqual(unapprovedOpsProvision.status, 0, 'production operations provisioning requires an explicit confirmation flag');
assert.match(unapprovedOpsProvision.stderr, /--confirm-production/);

process.stdout.write('Production persistent-storage guard checks passed.\\n');
