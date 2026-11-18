import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

// Set isolated storage before importing modules that construct the database.
const dataDir = await mkdtemp(join(tmpdir(), 'fleetgrid-auth-api-'));
process.env.DATA_DIR = dataDir;
process.env.AUTO_SEED = 'false';
process.env.NODE_ENV = 'test';
delete process.env.FLEETGRID_TEST_BYPASS_AUTH;
delete process.env.DATABASE_URL;
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
delete process.env.APP_BASE_URL;

const [{ createApp }, { db }, security, registration] = await Promise.all([
  import('../src/index.js'),
  import('../src/store/db.js'),
  import('../src/services/authSecurity.js'),
  import('../src/services/registration.js'),
]);

const server = createServer(createApp());
await db.initialize();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function makeBusiness(name: string, email: string) {
  const result = await registration.register({
    role: 'BUSINESS',
    name,
    contact: email,
    organizationName: `${name} Logistics`,
  });
  const session = security.issueSessionToken();
  const timestamp = new Date().toISOString();
  await db.authAccounts.create({
    id: result.user.id,
    email,
    passwordHash: await security.hashPassword('Test-Password-2026!'),
    emailVerifiedAt: timestamp,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    sessionTokenHash: session.tokenHash,
    sessionExpiresAt: session.expiresAt,
    failedLoginCount: 0,
    lockedUntil: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return { ...result, cookie: `fleetgrid_session=${session.token}` };
}

try {
  const health = await request('/health');
  assert.equal(health.status, 200, 'health endpoint remains public');

  const anonymousState = await request('/state');
  assert.equal(anonymousState.status, 401, 'operational state is not public');

  const signupBefore = await db.users.get();
  const signup = await request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'BUSINESS',
      name: 'No Email Provider',
      email: 'no-provider@example.test',
      password: 'Test-Password-2026!',
      contact: '+910000000000',
    }),
  });
  assert.equal(signup.status, 503, 'signup fails closed when verification email is not configured');
  assert.equal((await db.users.get()).length, signupBefore.length, 'failed signup creates no domain account');

  const operationsSignup = await request('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      role: 'CONTROL_TOWER',
      name: 'Unauthorized Operations',
      email: 'ops@example.test',
      password: 'Test-Password-2026!',
      contact: '+910000000001',
    }),
  });
  assert.equal(operationsSignup.status, 400, 'operations self-registration is rejected by schema');

  const invalidLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'missing@example.test', password: 'wrong-password' }),
  });
  assert.equal(invalidLogin.status, 401, 'unknown account login is rejected');

  const first = await makeBusiness('First Shipper', 'first@example.test');
  const second = await makeBusiness('Second Shipper', 'second@example.test');

  const me = await request('/auth/me', { headers: { cookie: first.cookie } });
  assert.equal(me.status, 200, 'valid session can be restored');
  const meBody = await me.json() as { user: { id: string }; email: string };
  assert.equal(meBody.user.id, first.user.id);
  assert.equal(meBody.email, 'first@example.test');

  const state = await request('/state', { headers: { cookie: first.cookie } });
  assert.equal(state.status, 200, 'verified session can access operational state');
  const snapshot = await state.json() as { users: Array<{ id: string }>; organizations: Array<{ id: string }>; authAccounts?: unknown[] };
  assert.deepEqual(snapshot.users.map((user) => user.id), [first.user.id], 'shipper sees only own organization users');
  assert.deepEqual(snapshot.organizations.map((org) => org.id), [first.organization.id], 'shipper sees only own organization');
  assert.equal('authAccounts' in snapshot, false, 'credential collection is never exposed');

  const otherState = await request('/state', { headers: { cookie: second.cookie } });
  const otherSnapshot = await otherState.json() as { users: Array<{ id: string }> };
  assert.deepEqual(otherSnapshot.users.map((user) => user.id), [second.user.id], 'second shipper has an isolated view');

  const forbiddenRecovery = await request('/recovery-plans', { headers: { cookie: first.cookie } });
  assert.equal(forbiddenRecovery.status, 403, 'shipper cannot access operations-only recovery endpoints');

  const logout = await request('/auth/logout', { method: 'POST', headers: { cookie: first.cookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await request('/auth/me', { headers: { cookie: first.cookie } });
  assert.equal(afterLogout.status, 401, 'logout invalidates the session server-side');

  process.stdout.write('Authentication API integration checks passed.\n');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
}
