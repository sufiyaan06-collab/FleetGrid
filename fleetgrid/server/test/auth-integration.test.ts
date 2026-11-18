import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, hashOpaqueToken, issueSessionToken } from '../src/services/authSecurity.js';

const dataDir = await mkdtemp(join(tmpdir(), 'fleetgrid-auth-'));
const port = 4317 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const password = 'FleetGrid-Integration-Password-2026';
const now = new Date().toISOString();
const orgs = [
  { id: 'shipper_a', name: 'Shipper A', type: 'SHIPPER', status: 'ACTIVE', createdAt: now },
  { id: 'shipper_b', name: 'Shipper B', type: 'SHIPPER', status: 'ACTIVE', createdAt: now },
  { id: 'fleet_a', name: 'Fleet A', type: 'FLEET_OPERATOR', status: 'ACTIVE', createdAt: now },
];
const users = [
  { id: 'user_a', name: 'Shipper A User', role: 'BUSINESS', organizationId: 'shipper_a', contact: 'a@example.test', createdAt: now },
  { id: 'user_b', name: 'Shipper B User', role: 'BUSINESS', organizationId: 'shipper_b', contact: 'b@example.test', createdAt: now },
  { id: 'driver_user', name: 'Driver User', role: 'DRIVER', organizationId: 'fleet_a', contact: 'driver@example.test', createdAt: now },
];
const tokenA = issueSessionToken();
const tokenB = issueSessionToken();
const tokenDriver = issueSessionToken();
const passwordHash = await hashPassword(password);
const accounts = [
  { id: 'user_a', email: 'a@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenA.tokenHash, sessionExpiresAt: tokenA.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'user_b', email: 'b@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenB.tokenHash, sessionExpiresAt: tokenB.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'driver_user', email: 'driver@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenDriver.tokenHash, sessionExpiresAt: tokenDriver.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
];
const shipments = [
  { id: 'shipment_a', reference: 'A-001', cargoName: 'Private cargo A', shipperId: 'shipper_a', origin: 'A', destination: 'B', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 100, currency: 'INR', createdAt: now, updatedAt: now },
  { id: 'shipment_b', reference: 'B-001', cargoName: 'Private cargo B', shipperId: 'shipper_b', origin: 'C', destination: 'D', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 100, currency: 'INR', createdAt: now, updatedAt: now },
];
for (const [name, rows] of Object.entries({
  'organizations.json': orgs, 'users.json': users, 'auth-accounts.json': accounts,
  'drivers.json': [], 'trucks.json': [], 'shipments.json': shipments,
  'capacity-offers.json': [], 'incidents.json': [], 'recovery-plans.json': [],
  'payments.json': [], 'shipment-events.json': [], 'notifications.json': [],
})) {
  await writeFile(join(dataDir, name), JSON.stringify(rows), 'utf8');
}

let server: ChildProcess | undefined;
async function waitForServer(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Authentication integration server did not start.');
}
async function request(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, init);
}

try {
  server = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir,
      AUTO_SEED: 'false', NODE_ENV: 'test', FLEETGRID_TEST_BYPASS_AUTH: 'false',
      CORS_ORIGIN: base,
    },
    stdio: 'ignore',
  });
  await waitForServer();

  const anonymous = await request('/state');
  assert.equal(anonymous.status, 401, 'operational state requires a session');

  const opsSignup = await request('/auth/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'BUSINESS', name: 'Ops Attempt', email: 'ops@example.test', password, contact: '1234567890' }),
  });
  assert.equal(opsSignup.status, 503, 'signup is unavailable without configured email delivery');
  const storedAccounts = JSON.parse(await readFile(join(dataDir, 'auth-accounts.json'), 'utf8'));
  assert.equal(storedAccounts.length, 3, 'failed signup must not create an auth account');

  const invalidLogin = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.test', password: 'incorrect-password' }),
  });
  assert.equal(invalidLogin.status, 401, 'incorrect password is rejected');

  const meAnonymous = await request('/auth/me');
  assert.equal(meAnonymous.status, 401, 'session endpoint rejects anonymous callers');

  const shipperA = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(shipperA.status, 200);
  const stateA = await shipperA.json() as { shipments: Array<{ id: string }>; users: Array<{ id: string }> };
  assert.deepEqual(stateA.shipments.map((s) => s.id), ['shipment_a'], 'shipper sees only their own shipments');
  assert.deepEqual(stateA.users.map((u) => u.id), ['user_a'], 'shipper sees only their own organization users');

  const shipperB = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenB.token}` } });
  const stateB = await shipperB.json() as { shipments: Array<{ id: string }> };
  assert.deepEqual(stateB.shipments.map((s) => s.id), ['shipment_b'], 'second shipper cannot see first shipper records');

  const driverPayments = await request('/payments', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  assert.equal(driverPayments.status, 200);
  const paymentData = await driverPayments.json() as { payments: unknown[] };
  assert.equal(paymentData.payments.length, 0, 'driver cannot read shipper payment records');

  const logout = await request('/auth/logout', { method: 'POST', headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(logout.status, 200);
  const afterLogout = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(afterLogout.status, 401, 'logout revokes the server-side session');

  const persistedAccounts = JSON.parse(await readFile(join(dataDir, 'auth-accounts.json'), 'utf8'));
  assert.equal(persistedAccounts.find((a: { id: string }) => a.id === 'user_a').sessionTokenHash, null);

  process.stdout.write('Authentication integration checks passed (anonymous access, failed signup, login rejection, shipper isolation, driver payment privacy, logout).\\n');
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
