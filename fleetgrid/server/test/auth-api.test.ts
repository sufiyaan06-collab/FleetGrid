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

const nativeFetch = globalThis.fetch;
let resetLinkToken: string | null = null;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input) === 'https://api.resend.com/emails') {
    const payload = JSON.parse(String(init?.body ?? '{}')) as { text?: string };
    resetLinkToken = payload.text?.match(/resetToken=([^\s]+)/)?.[1] ?? null;
    return new Response('{}', { status: 200 });
  }
  return nativeFetch(input, init);
};

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
  const healthBody = await health.json() as {
    readiness: { persistentStorage: boolean; emailDelivery: boolean };
    payments: { mode: string; realMoneyEnabled: boolean };
  };
  assert.equal(healthBody.readiness.persistentStorage, false, 'health reports the isolated test JSON adapter');
  assert.equal(healthBody.readiness.emailDelivery, false, 'health reports missing email delivery configuration without exposing secrets');
  assert.equal(healthBody.payments.mode, 'DEMO_ONLY');
  assert.equal(healthBody.payments.realMoneyEnabled, false);

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

  // The demo payment flow is server-controlled, scoped to the shipper, and idempotent.
  const demoShipment = await db.shipments.create({
    id: 'shipment-demo-payment-test',
    reference: 'FG-DEMO-PAY-001',
    cargoName: 'Test cargo',
    shipperId: first.organization.id,
    origin: 'Bengaluru',
    destination: 'Mysuru',
    weightT: 2,
    deadlineAt: null,
    status: 'CONFIRMED',
    truckId: null,
    capacityOfferId: null,
    price: 1250,
    currency: 'INR',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const demoStatus = await request('/payments/demo/status', { headers: { cookie: first.cookie } });
  assert.equal(demoStatus.status, 200, 'authenticated shipper can read demo payment mode');
  const demoMode = await demoStatus.json() as { mode: string; realMoney: boolean };
  assert.equal(demoMode.mode, 'DEMO_ONLY');
  assert.equal(demoMode.realMoney, false, 'demo mode clearly states no real money is moved');

  const disabledDodoStatus = await request('/payments/dodo/status', { headers: { cookie: first.cookie } });
  assert.equal(disabledDodoStatus.status, 410, 'Dodo shipment payment integration is explicitly disabled');
  const disabledDodoCheckout = await request('/payments/dodo/checkout', {
    method: 'POST',
    headers: { cookie: first.cookie },
    body: JSON.stringify({ shipmentId: demoShipment.id }),
  });
  assert.equal(disabledDodoCheckout.status, 410, 'Dodo cannot initiate a shipment payment');
  const disabledDodoWebhook = await request('/payments/dodo/webhook', {
    method: 'POST',
    body: JSON.stringify({ type: 'payment.succeeded' }),
  });
  assert.equal(disabledDodoWebhook.status, 410, 'Dodo webhook cannot settle FleetGrid shipment payments');

  const demoCreate = await request('/payments/demo/checkout', {
    method: 'POST',
    headers: { cookie: first.cookie },
    body: JSON.stringify({ shipmentId: demoShipment.id, amount: 1, currency: 'USD' }),
  });
  assert.equal(demoCreate.status, 201, 'shipper can create a demo payment for an owned confirmed shipment');
  const demoCreateBody = await demoCreate.json() as { payment: { id: string; status: string; provider: string; amount: number } };
  assert.equal(demoCreateBody.payment.status, 'PENDING');
  assert.equal(demoCreateBody.payment.provider, 'FleetGrid Demo Simulator');
  assert.equal(demoCreateBody.payment.amount, 1250, 'server ignores client-supplied amount and uses the stored shipment amount');

  const crossAccountDemoCreate = await request('/payments/demo/checkout', {
    method: 'POST',
    headers: { cookie: second.cookie },
    body: JSON.stringify({ shipmentId: demoShipment.id }),
  });
  assert.equal(crossAccountDemoCreate.status, 404, 'another shipper cannot create a payment for this shipment');

  const duplicateDemoCreate = await request('/payments/demo/checkout', {
    method: 'POST',
    headers: { cookie: first.cookie },
    body: JSON.stringify({ shipmentId: demoShipment.id }),
  });
  assert.equal(duplicateDemoCreate.status, 409, 'duplicate active demo payments are blocked');

  const crossAccountSettle = await request(`/payments/demo/${demoCreateBody.payment.id}/settle`, {
    method: 'POST',
    headers: { cookie: second.cookie },
    body: JSON.stringify({}),
  });
  assert.equal(crossAccountSettle.status, 404, 'another shipper cannot settle this payment');

  const demoSettle = await request(`/payments/demo/${demoCreateBody.payment.id}/settle`, {
    method: 'POST',
    headers: { cookie: first.cookie },
    body: JSON.stringify({}),
  });
  assert.equal(demoSettle.status, 200, 'owner can explicitly simulate settlement');
  const demoSettleBody = await demoSettle.json() as { payment: { status: string; paymentMethod?: string } };
  assert.equal(demoSettleBody.payment.status, 'PAID');
  assert.equal(demoSettleBody.payment.paymentMethod, 'DEMO_SIMULATED');

  const repeatDemoSettle = await request(`/payments/demo/${demoCreateBody.payment.id}/settle`, {
    method: 'POST',
    headers: { cookie: first.cookie },
    body: JSON.stringify({}),
  });
  assert.equal(repeatDemoSettle.status, 200, 'repeated settlement is idempotent');

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

  // Exercise the real password-reset token flow against a mocked email provider.
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.EMAIL_FROM = 'FleetGrid Test <test@example.test>';
  process.env.APP_BASE_URL = base;
  const forgot = await request('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: 'first@example.test' }),
  });
  assert.equal(forgot.status, 202, 'password reset request is accepted');
  assert.ok(resetLinkToken, 'password reset email contains a one-time reset token');
  const reset = await request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetLinkToken, password: 'New-Test-Password-2026!' }),
  });
  assert.equal(reset.status, 200, 'valid reset token changes the password');
  const replayReset = await request('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: resetLinkToken, password: 'Another-Test-Password-2026!' }),
  });
  assert.equal(replayReset.status, 400, 'password reset token is single use');
  const oldPasswordLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'first@example.test', password: 'Test-Password-2026!' }),
  });
  assert.equal(oldPasswordLogin.status, 401, 'old password is rejected after reset');
  const newPasswordLogin = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'first@example.test', password: 'New-Test-Password-2026!' }),
  });
  assert.equal(newPasswordLogin.status, 200, 'new password signs in successfully');

  // Simulate Render production even in the isolated test process.
  process.env.RENDER_SERVICE_ID = 'srv-auth-test';
  process.env.FLEETGRID_TEST_BYPASS_AUTH = 'true';
  const productionBypass = await request('/state');
  assert.equal(productionBypass.status, 401, 'test authentication bypass is disabled on Render');
  const csrfRejected = await request('/auth/logout', { method: 'POST' });
  assert.equal(csrfRejected.status, 403, 'production cookie mutations require a trusted Origin');
  const csrfAccepted = await request('/auth/logout', {
    method: 'POST',
    headers: { origin: base },
  });
  assert.equal(csrfAccepted.status, 200, 'same-origin browser mutations are accepted');
  delete process.env.RENDER_SERVICE_ID;
  delete process.env.FLEETGRID_TEST_BYPASS_AUTH;

  const logout = await request('/auth/logout', { method: 'POST', headers: { cookie: first.cookie } });
  assert.equal(logout.status, 200);
  const afterLogout = await request('/auth/me', { headers: { cookie: first.cookie } });
  assert.equal(afterLogout.status, 401, 'logout invalidates the session server-side');

  process.stdout.write('Authentication API integration checks passed.\n');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await db.close();
  globalThis.fetch = nativeFetch;
  await rm(dataDir, { recursive: true, force: true });
}
