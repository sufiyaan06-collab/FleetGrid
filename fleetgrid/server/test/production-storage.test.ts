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

process.stdout.write('Production persistent-storage guard checks passed.\\n');
