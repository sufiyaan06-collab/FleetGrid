import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword, hashOpaqueToken, issueSessionToken, issueVerificationToken } from '../src/services/authSecurity.js';
import { Webhook } from 'standardwebhooks';

const dataDir = await mkdtemp(join(tmpdir(), 'fleetgrid-auth-'));
const port = 4317 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const password = 'FleetGrid-Integration-Password-2026';
const now = new Date().toISOString();
const orgs = [
  { id: 'shipper_a', name: 'Shipper A', type: 'SHIPPER', status: 'ACTIVE', createdAt: now },
  { id: 'shipper_b', name: 'Shipper B', type: 'SHIPPER', status: 'ACTIVE', createdAt: now },
  { id: 'fleet_a', name: 'Fleet A', type: 'FLEET_OPERATOR', status: 'ACTIVE', createdAt: now },
  { id: 'suspended_org', name: 'Suspended Shipper', type: 'SHIPPER', status: 'SUSPENDED', createdAt: now },
  { id: 'verify_org', name: 'Verification Shipper', type: 'SHIPPER', status: 'ACTIVE', createdAt: now },
];
const users = [
  { id: 'user_a', name: 'Shipper A User', role: 'BUSINESS', organizationId: 'shipper_a', contact: 'a@example.test', createdAt: now },
  { id: 'user_b', name: 'Shipper B User', role: 'BUSINESS', organizationId: 'shipper_b', contact: 'b@example.test', createdAt: now },
  { id: 'driver_user', name: 'Driver User', role: 'DRIVER', organizationId: 'fleet_a', contact: 'driver@example.test', createdAt: now },
  { id: 'driver_other', name: 'Other Driver', role: 'DRIVER', organizationId: 'fleet_a', contact: 'other-driver@example.test', createdAt: now },
  { id: 'suspended_user', name: 'Suspended User', role: 'BUSINESS', organizationId: 'suspended_org', contact: 'suspended@example.test', createdAt: now },
  { id: 'verify_user', name: 'Verify User', role: 'BUSINESS', organizationId: 'verify_org', contact: 'verify@example.test', createdAt: now },
];
const tokenA = issueSessionToken();
const tokenB = issueSessionToken();
const tokenDriver = issueSessionToken();
const tokenSuspended = issueSessionToken();
const verificationToken = issueVerificationToken();
const webhookSecret = `whsec_${Buffer.from('FleetGrid webhook integration secret').toString('base64')}`;
const passwordHash = await hashPassword(password);
const accounts = [
  { id: 'user_a', email: 'a@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenA.tokenHash, sessionExpiresAt: tokenA.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'user_b', email: 'b@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenB.tokenHash, sessionExpiresAt: tokenB.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'driver_user', email: 'driver@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenDriver.tokenHash, sessionExpiresAt: tokenDriver.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'suspended_user', email: 'suspended@example.test', passwordHash, emailVerifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, sessionTokenHash: tokenSuspended.tokenHash, sessionExpiresAt: tokenSuspended.expiresAt, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
  { id: 'verify_user', email: 'verify@example.test', passwordHash, emailVerifiedAt: null, verificationTokenHash: verificationToken.tokenHash, verificationExpiresAt: verificationToken.expiresAt, sessionTokenHash: null, sessionExpiresAt: null, failedLoginCount: 0, lockedUntil: null, createdAt: now, updatedAt: now },
];
const shipments = [
  { id: 'shipment_a', reference: 'A-001', cargoName: 'Private cargo A', shipperId: 'shipper_a', origin: 'A', destination: 'B', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 100, currency: 'INR', createdAt: now, updatedAt: now },
  { id: 'shipment_b', reference: 'B-001', cargoName: 'Private cargo B', shipperId: 'shipper_b', origin: 'C', destination: 'D', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 100, currency: 'INR', createdAt: now, updatedAt: now },
  { id: 'shipment_zero_price', reference: 'A-002', cargoName: 'Unpriced cargo', shipperId: 'shipper_a', origin: 'A', destination: 'B', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 0, currency: 'INR', createdAt: now, updatedAt: now },
  { id: 'shipment_bad_currency', reference: 'A-003', cargoName: 'Invalid currency cargo', shipperId: 'shipper_a', origin: 'A', destination: 'B', weightT: 1, deadlineAt: null, status: 'DRAFT', truckId: null, capacityOfferId: null, price: 100, currency: 'IN', createdAt: now, updatedAt: now },
];
for (const [name, rows] of Object.entries({
  'organizations.json': orgs, 'users.json': users, 'auth-accounts.json': accounts,
  'drivers.json': [
    { id: 'driver_a', organizationId: 'fleet_a', userId: 'driver_user', name: 'Driver User', phone: '1111111111', assignedTruckId: 'truck_a', status: 'AVAILABLE', createdAt: now },
    { id: 'driver_other_profile', organizationId: 'fleet_a', userId: 'driver_other', name: 'Other Driver', phone: '2222222222', assignedTruckId: 'truck_other', status: 'AVAILABLE', createdAt: now },
  ],
  'trucks.json': [
    { id: 'truck_a', organizationId: 'fleet_a', registrationNo: 'KA01AA0001', capacityT: 5, availableT: 5, status: 'AVAILABLE', lat: 12.9, lng: 77.6, origin: 'A', destination: 'B', departureAt: null, driverId: 'driver_a', createdAt: now },
    { id: 'truck_other', organizationId: 'fleet_a', registrationNo: 'KA01AA0002', capacityT: 5, availableT: 5, status: 'AVAILABLE', lat: 12.9, lng: 77.6, origin: 'C', destination: 'D', departureAt: null, driverId: 'driver_other_profile', createdAt: now },
  ], 'shipments.json': shipments,
  'capacity-offers.json': [
    { id: 'offer_a', truckId: 'truck_a', availableT: 5, route: 'A → B', origin: 'A', destination: 'B', pricePerT: 100, departureAt: null, status: 'OPEN', createdAt: now, updatedAt: now },
    { id: 'offer_other', truckId: 'truck_other', availableT: 5, route: 'C → D', origin: 'C', destination: 'D', pricePerT: 100, departureAt: null, status: 'OPEN', createdAt: now, updatedAt: now },
  ], 'incidents.json': [], 'recovery-plans.json': [],
  'payments.json': [
    { id: 'payment_a', shipmentId: 'shipment_a', recoveryPlanId: null, provider: 'Dodo Payments', amount: 100, currency: 'INR', status: 'PENDING', providerReference: 'session_a', providerPaymentId: null, checkoutUrl: 'https://checkout.example.test/session_a', customerName: 'Shipper A User', customerEmail: 'a@example.test', paymentMethod: 'DODO_CHECKOUT', createdAt: now, updatedAt: now },
    { id: 'payment_b', shipmentId: 'shipment_b', recoveryPlanId: null, provider: 'Dodo Payments', amount: 100, currency: 'INR', status: 'PENDING', providerReference: 'session_b', providerPaymentId: null, checkoutUrl: 'https://checkout.example.test/session_b', customerName: 'Shipper B User', customerEmail: 'b@example.test', paymentMethod: 'DODO_CHECKOUT', createdAt: now, updatedAt: now },
  ], 'shipment-events.json': [], 'notifications.json': [],
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
      CORS_ORIGIN: base, DODO_PAYMENTS_WEBHOOK_KEY: webhookSecret,
    },
    stdio: 'ignore',
  });
  await waitForServer();

  const anonymous = await request('/state');
  assert.equal(anonymous.status, 401, 'operational state requires a session');
  const verificationPrefetch = await request(`/auth/verify-email?token=${encodeURIComponent(verificationToken.token)}`);
  assert.equal(verificationPrefetch.status, 401, 'a GET link prefetch cannot consume an email verification token');
  const explicitVerification = await request('/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: verificationToken.token }),
  });
  assert.equal(explicitVerification.status, 200, 'email verification succeeds only after explicit POST');
  const verificationReplay = await request('/auth/verify-email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: verificationToken.token }),
  });
  assert.equal(verificationReplay.status, 400, 'email verification token is single use');

  const suspendedState = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenSuspended.token}` } });
  assert.equal(suspendedState.status, 403, 'suspended organisations cannot access operational APIs');
  const suspendedSession = await request('/auth/me', { headers: { cookie: `fleetgrid_session=${tokenSuspended.token}` } });
  assert.equal(suspendedSession.status, 403, 'suspended organisations cannot restore an authenticated session');


  const opsSignup = await request('/auth/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'CONTROL_TOWER', name: 'Ops Attempt', email: 'ops@example.test', password, contact: '1234567890' }),
  });
  assert.equal(opsSignup.status, 400, 'operations roles cannot self-register');

  const unavailableEmailSignup = await request('/auth/signup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'BUSINESS', name: 'Shipper Attempt', email: 'new@example.test', password, contact: '1234567890' }),
  });
  assert.equal(unavailableEmailSignup.status, 503, 'signup is unavailable without configured email delivery');
  const storedAccounts = JSON.parse(await readFile(join(dataDir, 'auth-accounts.json'), 'utf8'));
  assert.equal(storedAccounts.length, 5, 'rejected signup attempts must not create auth accounts');
  const resendPayload = { email: 'verify-limit@example.test' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const resend = await request('/auth/resend-verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(resendPayload),
    });
    assert.equal(resend.status, 503, 'email resend reports missing provider before rate limit is reached');
  }
  const limitedResend = await request('/auth/resend-verification', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(resendPayload),
  });
  assert.equal(limitedResend.status, 429, 'repeated verification email requests are rate limited per account');
  assert.ok(Number(limitedResend.headers.get('retry-after')) > 0, 'rate-limited response includes Retry-After');


  const invalidLogin = await request('/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.test', password: 'incorrect-password' }),
  });
  assert.equal(invalidLogin.status, 401, 'incorrect password is rejected');

  const meAnonymous = await request('/auth/me');
  assert.equal(meAnonymous.status, 401, 'session endpoint rejects anonymous callers');

  const shipperA = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(shipperA.status, 200);
  const stateA = await shipperA.json() as { shipments: Array<{ id: string }>; users: Array<{ id: string }>; trucks: Array<{ driverId: string | null }> };
  assert.deepEqual(stateA.shipments.map((s) => s.id), ['shipment_a'], 'shipper sees only their own shipments');
  assert.deepEqual(stateA.users.map((u) => u.id), ['user_a'], 'shipper sees only their own organization users');
  assert.ok(stateA.trucks.every((truck) => truck.driverId === null), 'shipper snapshot does not expose private driver account links');

  const shipperB = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenB.token}` } });
  const stateB = await shipperB.json() as { shipments: Array<{ id: string }> };
  assert.deepEqual(stateB.shipments.map((s) => s.id), ['shipment_b'], 'second shipper cannot see first shipper records');

  const crossShipperDetail = await request('/shipments/shipment_b', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(crossShipperDetail.status, 404, 'shipper cannot open another shipper shipment by ID');

  const driverCrossShipperDetail = await request('/shipments/shipment_a', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  assert.equal(driverCrossShipperDetail.status, 404, 'driver cannot open an unassigned shipment by ID');
  const driverStateResponse = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  assert.equal(driverStateResponse.status, 200);
  const driverState = await driverStateResponse.json() as { users: Array<{ id: string }>; drivers: Array<{ id: string }>; trucks: Array<{ id: string }> };
  assert.deepEqual(driverState.users.map((u) => u.id), ['driver_user'], 'driver cannot see another driver account in the same fleet organization');
  assert.deepEqual(driverState.drivers.map((d) => d.id), ['driver_a'], 'driver sees only their own driver profile');
  assert.deepEqual(driverState.trucks.map((t) => t.id), ['truck_a'], 'driver sees only their assigned truck in private state');
  const driverTruckListResponse = await request('/trucks', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  const driverTruckList = await driverTruckListResponse.json() as { trucks: Array<{ id: string }> };
  assert.deepEqual(driverTruckList.trucks.map((truck) => truck.id), ['truck_a'], 'driver cannot enumerate other drivers trucks through the truck list');
  const driverLocationsResponse = await request('/trucks/locations', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  const driverLocations = await driverLocationsResponse.json() as Array<{ id: string }>;
  assert.deepEqual(driverLocations.map((truck) => truck.id), ['truck_a'], 'driver live map is limited to their assigned truck');
  const otherDriverTruckDetail = await request('/trucks/truck_other', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  assert.equal(otherDriverTruckDetail.status, 404, 'driver cannot open another drivers truck detail');
  const driverCapacityBrowse = await request('/capacity', { headers: { cookie: `fleetgrid_session=${tokenDriver.token}` } });
  assert.equal(driverCapacityBrowse.status, 403, 'drivers cannot browse other fleets capacity and driver listings');

  const shipperCapacity = await request('/capacity', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  assert.equal(shipperCapacity.status, 200);
  const shipperCapacityData = await shipperCapacity.json() as { matches: Array<{ truck: { driverId: string | null }; driverName: string | null }> };
  assert.ok(shipperCapacityData.matches.length > 0, 'shipper can browse public fleet capacity');
  assert.ok(shipperCapacityData.matches.every((match) => match.truck.driverId === null && match.driverName === null), 'capacity search hides driver identifiers and names from shippers');

  const shipperCapacityOptions = await request('/capacity/options?weightT=1', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const capacityOptionsData = await shipperCapacityOptions.json() as { single: Array<{ truck: { driverId: string | null }; driverName: string | null }> };
  assert.ok(capacityOptionsData.single.every((match) => match.truck.driverId === null && match.driverName === null), 'capacity options hide driver identity');

  const shipperNearby = await request('/capacity/nearby?truckId=truck_a&weightT=1', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const nearbyData = await shipperNearby.json() as { selected: { truck: { driverId: string | null }; driverName: string | null } | null; suggestions: Array<{ truck: { driverId: string | null }; driverName: string | null }>; selectedTruck: { driverId: string | null } | null };
  assert.equal(nearbyData.selected?.truck.driverId, null, 'nearby selected truck hides driver identifier');
  assert.equal(nearbyData.selected?.driverName, null, 'nearby selected truck hides driver name');
  assert.ok(nearbyData.suggestions.every((match) => match.truck.driverId === null && match.driverName === null), 'nearby suggestions hide driver identity');
  assert.equal(nearbyData.selectedTruck?.driverId, null, 'nearby selected truck summary hides driver identifier');

  const shipperCapacityDetail = await request('/capacity/offer_other', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const capacityDetailData = await shipperCapacityDetail.json() as { truck: { driverId: string | null } };
  assert.equal(capacityDetailData.truck.driverId, null, 'capacity detail hides driver identifier');

  const shipperReservation = await request('/capacity/offer_other/reserve', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenB.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_b' }),
  });
  assert.equal(shipperReservation.status, 200, 'shipper can reserve an available public capacity offer for its own shipment');
  const reservationData = await shipperReservation.json() as { truck: { driverId: string | null } };
  assert.equal(reservationData.truck.driverId, null, 'capacity reservation response hides driver identifier from shipper');

  const shipperOtherTruckDetail = await request('/trucks/truck_other', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const shipperOtherTruck = await shipperOtherTruckDetail.json() as { truck: { driverId: string | null }; driver: unknown };
  assert.equal(shipperOtherTruck.truck.driverId, null, 'shipper cannot read another fleets private driver link');
  assert.equal(shipperOtherTruck.driver, null, 'shipper cannot read another fleets driver profile');


  const driverRecoveryWrite = await request('/recovery-plans', {
    method: 'POST', headers: { cookie: `fleetgrid_session=${tokenDriver.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ incidentId: 'incident_private' }),
  });
  assert.equal(driverRecoveryWrite.status, 403, 'driver cannot create operations recovery plans');
  const driverRecoveryPreview = await request('/incidents/incident_private/recovery-options', {
    headers: { cookie: `fleetgrid_session=${tokenDriver.token}` },
  });
  assert.equal(driverRecoveryPreview.status, 403, 'drivers cannot inspect operations-only recovery previews');

  const driverEventWrite = await request('/events', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenDriver.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: 'shipment.fake_paid', shipmentId: 'shipment_a', payload: { status: 'PAID' } }),
  });
  assert.equal(driverEventWrite.status, 403, 'drivers cannot append arbitrary events to the immutable audit log');
  const shipperEventWrite = await request('/events', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: 'shipment.fake_paid', shipmentId: 'shipment_a', payload: { status: 'PAID' } }),
  });
  assert.equal(shipperEventWrite.status, 403, 'shippers cannot append arbitrary events to the immutable audit log');


  const driverPaymentIntent = await request('/payments/dodo/checkout', {
    method: 'POST', headers: { cookie: `fleetgrid_session=${tokenDriver.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_a', amount: 100, currency: 'INR' }),
  });
  assert.equal(driverPaymentIntent.status, 403, 'drivers cannot create payment intents');

  const unpricedShipmentCheckout = await request('/payments/dodo/checkout', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_zero_price', amount: 100, currency: 'INR' }),
  });
  assert.equal(unpricedShipmentCheckout.status, 400, 'checkout rejects shipments without a recorded positive price');

  const invalidCurrencyCheckout = await request('/payments/dodo/checkout', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_bad_currency', amount: 100, currency: 'INR' }),
  });
  assert.equal(invalidCurrencyCheckout.status, 400, 'checkout rejects invalid shipment currency codes');

  const crossShipperPaymentIntent = await request('/payments/create', {
    method: 'POST', headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_b', amount: 100, currency: 'INR' }),
  });
  assert.ok([403, 404].includes(crossShipperPaymentIntent.status), 'cross-shipper payment intent request is denied without creating checkout');

  const driverProofAnchor = await request('/proof/anchor', {
    method: 'POST', headers: { cookie: `fleetgrid_session=${tokenDriver.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_a' }),
  });
  assert.equal(driverProofAnchor.status, 403, 'drivers cannot invoke operations blockchain proof anchoring');


  const duplicatePendingCheckout = await request('/payments/dodo/checkout', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_a', amount: 100, currency: 'INR', customerName: 'Shipper A User', customerEmail: 'a@example.test' }),
  });
  assert.equal(duplicatePendingCheckout.status, 409, 'a shipment cannot create a second active checkout session');

  const webhookPayload = JSON.stringify({
    business_id: 'dodo_test_business',
    data: {
      payment_id: 'dodo_payment_001',
      checkout_session_id: 'session_a',
      currency: 'INR',
      payment_method: 'upi',
      status: 'succeeded',
    },
    timestamp: now,
    type: 'payment.succeeded',
  });
  const webhookId = 'msg_fleetgrid_test_001';
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const signer = new Webhook(webhookSecret);
  const webhookSignature = signer.sign(webhookId, new Date(Number(webhookTimestamp) * 1000), webhookPayload);
  const invalidWebhook = await request('/payments/dodo/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': 'v1,invalid-signature',
    },
    body: webhookPayload,
  });
  assert.equal(invalidWebhook.status, 401, 'unsigned or forged Dodo webhook cannot settle a payment');
  const validWebhookRequest = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': webhookSignature,
    },
    body: webhookPayload,
  } satisfies RequestInit;
  const validWebhook = await request('/payments/dodo/webhook', validWebhookRequest);
  assert.equal(validWebhook.status, 200, 'valid signed Dodo payment webhook is accepted without a user session');
  const paymentListAfterWebhook = await request('/payments', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const paymentListData = await paymentListAfterWebhook.json() as { payments: Array<{ id: string; status: string; providerPaymentId?: string | null }> };
  const settledPayment = paymentListData.payments.find((payment) => payment.id === 'payment_a');
  assert.equal(settledPayment?.status, 'PAID', 'verified provider webhook settles the matching local payment');
  assert.equal(settledPayment?.providerPaymentId, 'dodo_payment_001', 'provider payment id is stored separately from the checkout session id');
  const duplicatePaidCheckout = await request('/payments/dodo/checkout', {
    method: 'POST',
    headers: { cookie: `fleetgrid_session=${tokenA.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ shipmentId: 'shipment_a', amount: 100, currency: 'INR', customerName: 'Shipper A User', customerEmail: 'a@example.test' }),
  });
  assert.equal(duplicatePaidCheckout.status, 409, 'a shipment that is already paid cannot be charged again');

  const duplicateWebhook = await request('/payments/dodo/webhook', validWebhookRequest);
  assert.equal(duplicateWebhook.status, 200, 'duplicate signed webhook is acknowledged idempotently');
  const stateAfterPayment = await request('/state', { headers: { cookie: `fleetgrid_session=${tokenA.token}` } });
  const stateAfterPaymentData = await stateAfterPayment.json() as { shipments: Array<{ id: string; status: string }> };
  assert.equal(stateAfterPaymentData.shipments.find((shipment) => shipment.id === 'shipment_a')?.status, 'DRAFT', 'payment settlement does not bypass driver shipment acceptance');
  const failedPayload = JSON.stringify({
    business_id: 'dodo_test_business',
    data: { payment_id: 'dodo_payment_002', checkout_session_id: 'session_b', currency: 'INR', payment_method: 'card', status: 'failed' },
    timestamp: now,
    type: 'payment.failed',
  });
  const failedWebhookId = 'msg_fleetgrid_test_002';
  const failedWebhookTimestamp = String(Math.floor(Date.now() / 1000));
  const failedWebhookSignature = signer.sign(failedWebhookId, new Date(Number(failedWebhookTimestamp) * 1000), failedPayload);
  const failedWebhook = await request('/payments/dodo/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': failedWebhookId,
      'webhook-timestamp': failedWebhookTimestamp,
      'webhook-signature': failedWebhookSignature,
    },
    body: failedPayload,
  });
  assert.equal(failedWebhook.status, 200, 'valid signed Dodo failure event is accepted');
  const shipperBPayments = await request('/payments', { headers: { cookie: `fleetgrid_session=${tokenB.token}` } });
  const shipperBPaymentData = await shipperBPayments.json() as { payments: Array<{ id: string; status: string }> };
  assert.equal(shipperBPaymentData.payments.find((payment) => payment.id === 'payment_b')?.status, 'FAILED', 'verified provider failure updates only its matching payment');


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

  process.stdout.write('Authentication integration checks passed (anonymous access, no operations self-registration, failed signup, auth rate limiting, explicit one-time email verification, login rejection, cross-account shipment isolation, driver account, truck-list, live-location and capacity-list isolation, suspended organisation lockout, recovery preview and immutable event-log restrictions, role restrictions, signed Dodo webhook verification, idempotent settlement and duplicate checkout prevention, payment ownership, proof-anchor role restriction, driver payment privacy, logout).\\n');
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  await rm(dataDir, { recursive: true, force: true });
}
