import { Router } from 'express';
import { authRouter } from './auth.js';
import { requireAuthenticated } from '../middleware/auth.js';
import { capacityRouter } from './capacity.js';
import { demoRouter } from './demo.js';
import { driverRouter } from './driver.js';
import { eventsRouter } from './events.js';
import { healthRouter } from './health.js';
import { incidentsRouter } from './incidents.js';
import { integrationsRouter } from './integrations.js';
import { miscRouter } from './misc.js';
import { paymentsRouter } from './payments.js';
import { recoveryRouter } from './recovery.js';
import { shipmentsRouter } from './shipments.js';
import { trucksRouter } from './trucks.js';

export function buildRouter(): Router {
  const router = Router();

  router.use(healthRouter);
  router.use(authRouter);
  // Payment router has its own auth guard, except for its signature-verified
  // Dodo webhook, which must accept provider callbacks without a user cookie.
  router.use(paymentsRouter);
  // Every other operational API requires an authenticated user session.
  router.use(requireAuthenticated);
  router.use(miscRouter);
  router.use(trucksRouter);
  router.use(capacityRouter);
  router.use(shipmentsRouter);
  router.use(driverRouter);
  router.use(incidentsRouter);
  router.use(recoveryRouter);
  router.use(eventsRouter);
  router.use(demoRouter);
  router.use(integrationsRouter);

  return router;
}

/** Machine-readable endpoint index for the demo team. */
export const ENDPOINT_INDEX = [
  { method: 'GET', path: '/health', purpose: 'Service health + counts' },
  { method: 'GET', path: '/state', purpose: 'Full read-only snapshot (client refetch target)' },
  { method: 'POST', path: '/auth/demo-login', purpose: 'Seeded demo role selection' },
  { method: 'POST', path: '/auth/register', purpose: 'Legacy development-only demo registration (disabled in production)' },
  { method: 'POST', path: '/auth/signup', purpose: 'Create a Shipper or Driver account and send email verification' },
  { method: 'POST', path: '/auth/login', purpose: 'Sign in with verified email and password' },
  { method: 'GET', path: '/auth/me', purpose: 'Restore the current authenticated session' },
  { method: 'POST', path: '/auth/verify-email', purpose: 'Consume an email verification token after an explicit user action' },
  { method: 'POST', path: '/auth/logout', purpose: 'Revoke the current session' },
  { method: 'POST', path: '/demo/reset', purpose: 'Restore deterministic demo state' },
  { method: 'GET', path: '/organizations', purpose: 'List organizations' },
  { method: 'POST', path: '/organizations', purpose: 'Create organization' },
  { method: 'GET', path: '/trucks', purpose: 'List trucks' },
  { method: 'GET', path: '/trucks/:id', purpose: 'Truck detail with shipments, driver, incidents' },
  { method: 'POST', path: '/trucks', purpose: 'Register a truck' },
  { method: 'POST', path: '/trucks/:id/depart', purpose: 'Start journey (truck + shipments → IN_TRANSIT)' },
  { method: 'GET', path: '/capacity', purpose: 'Compatible open capacity search' },
  { method: 'GET', path: '/capacity/options', purpose: 'What can carry this load: one truck, a split across trucks, or why not' },
  { method: 'GET', path: '/capacity/nearby', purpose: 'Other trucks nearest the selected one, with real distance + spare tonnage' },
  { method: 'GET', path: '/capacity/:id', purpose: 'Capacity offer detail' },
  { method: 'POST', path: '/capacity/:id/reserve', purpose: 'Atomically reserve capacity for a DRAFT shipment' },
  { method: 'GET', path: '/shipments', purpose: 'List shipments' },
  { method: 'POST', path: '/shipments', purpose: 'Create shipment; with capacityOfferId reserves and leaves it awaiting driver approval' },
  { method: 'GET', path: '/shipments/:id', purpose: 'Shipment detail' },
  { method: 'POST', path: '/shipments/:id/confirm', purpose: 'Driver accepts: CAPACITY_RESERVED → CONFIRMED' },
  { method: 'POST', path: '/shipments/:id/decline', purpose: 'Driver declines: release tonnage, shipment → DRAFT' },
  { method: 'GET', path: '/shipments/:id/timeline', purpose: 'Append-only event timeline' },
  { method: 'POST', path: '/shipments/:id/confirm-delivery', purpose: 'IN_TRANSIT → DELIVERED (business confirms receipt)' },
  { method: 'GET', path: '/driver/offers', purpose: 'Driver approval queue: pending offers + accepted loads' },
  { method: 'GET', path: '/incidents', purpose: 'List incidents' },
  { method: 'POST', path: '/incidents', purpose: 'Report incident (truck → INCIDENT, shipment → AT_RISK)' },
  { method: 'GET', path: '/incidents/:id', purpose: 'Incident detail' },
  { method: 'GET', path: '/incidents/:id/recovery-options', purpose: 'Deterministic recovery option preview' },
  { method: 'POST', path: '/recovery-plans', purpose: 'Create plan in PENDING_APPROVAL' },
  { method: 'GET', path: '/recovery-plans', purpose: 'List plans' },
  { method: 'GET', path: '/recovery-plans/:id', purpose: 'Plan detail' },
  { method: 'POST', path: '/recovery-plans/:id/approve', purpose: 'Operator approval gate' },
  { method: 'POST', path: '/recovery-plans/:id/reject', purpose: 'Reject plan' },
  { method: 'POST', path: '/recovery-plans/:id/execute', purpose: 'Execute APPROVED plan (idempotent)' },
  { method: 'GET', path: '/events', purpose: 'Event log' },
  { method: 'POST', path: '/events', purpose: 'Append an event' },
  { method: 'GET', path: '/agent/tools', purpose: 'Agent tool contract + JSON Schema' },
  { method: 'GET', path: '/payments', purpose: 'List payments visible to the signed-in account' },
  { method: 'POST', path: '/payments/dodo/checkout', purpose: 'Create a provider checkout session for an owned shipment (requires Dodo credentials)' },
  { method: 'POST', path: '/payments/dodo/confirm', purpose: 'Reject browser-side payment confirmation; verified provider webhook required' },
  { method: 'POST', path: '/payments/dodo/webhook', purpose: 'Receive Standard Webhooks signature-verified Dodo payment events' },
  { method: 'POST', path: '/payments/create', purpose: 'Create payment intent (501 — Dodo not connected)' },
  { method: 'POST', path: '/webhooks/dodo', purpose: 'Dodo payment webhook (501 — Dodo not connected)' },
  { method: 'POST', path: '/proof/anchor', purpose: 'Anchor event hash on EVM testnet (501 — not configured)' },
  { method: 'GET', path: '/notifications', purpose: 'Notification placeholder read model' },
  { method: 'WS', path: '/realtime', purpose: 'Realtime state/events' },
] as const;
