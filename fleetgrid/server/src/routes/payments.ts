import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { getPayment, listPayments } from '../services/paymentRecords.js';
import { createDemoPayment, settleDemoPayment } from '../services/demoPayments.js';
import { db } from '../store/db.js';
import { requireAuthenticated, requireRoles } from '../middleware/auth.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { ApiError } from '../lib/errors.js';
import { isProductionEnvironment } from '../config.js';
import type { User } from '../types.js';

export const paymentsRouter: Router = Router();

// Legacy Dodo endpoints are intentionally disabled. Operational payment routes require a user session.
// Dodo is intentionally disabled for FleetGrid shipment settlements. Its checkout
// model is not approved for collecting funds on behalf of independent carriers.
paymentsRouter.post('/payments/dodo/webhook', (_req, res) => {
  res.status(410).json({
    error: {
      code: 'DODO_SHIPMENT_PAYMENTS_DISABLED',
      message: 'Dodo checkout is disabled for FleetGrid shipment payments. Use the clearly labelled demo simulator.',
    },
  });
});

paymentsRouter.use(requireTrustedOrigin);
paymentsRouter.use(requireAuthenticated);

/** Clearly labelled college-demo simulator: no external provider or money movement. */
paymentsRouter.get('/payments/demo/status', (_req, res) => {
  res.json({ provider: 'FleetGrid Demo Simulator', mode: 'DEMO_ONLY', realMoney: false, ready: true });
});

paymentsRouter.post(
  '/payments/demo/checkout',
  requireRoles('BUSINESS'),
  validateBody(z.object({ shipmentId: z.string().min(2) })),
  asyncHandler(async (req, res) => {
    const user = res.locals.authUser as User;
    const { shipmentId } = req.body as { shipmentId: string };
    const payment = await createDemoPayment(shipmentId, user);
    res.status(201).json({ payment, mode: 'DEMO_ONLY', realMoney: false });
  }),
);

paymentsRouter.post(
  '/payments/demo/:id/settle',
  requireRoles('BUSINESS'),
  asyncHandler(async (req, res) => {
    const user = res.locals.authUser as User;
    const payment = await settleDemoPayment(requiredParam(req, 'id'), user);
    res.json({ payment, mode: 'DEMO_ONLY', realMoney: false });
  }),
);


paymentsRouter.get('/payments/dodo/status', (_req, res) => {
  res.status(410).json({
    provider: 'disabled',
    environment: 'disabled',
    ready: false,
    livePaymentsEnabled: false,
    message: 'Dodo is not enabled for FleetGrid shipment settlements.',
  });
});

paymentsRouter.post('/payments/dodo/checkout', (_req, res) => {
  res.status(410).json({
    error: {
      code: 'DODO_SHIPMENT_PAYMENTS_DISABLED',
      message: 'Dodo checkout is disabled for FleetGrid shipment payments. No real payment can be initiated.',
    },
  });
});

paymentsRouter.post('/payments/dodo/confirm', (_req, res) => {
  res.status(410).json({
    error: {
      code: 'DODO_SHIPMENT_PAYMENTS_DISABLED',
      message: 'Dodo shipment payment confirmation is disabled. Use the FleetGrid demo simulator.',
    },
  });
});

paymentsRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const all = await listPayments();
    if ((!isProductionEnvironment() && process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') || ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)) {
      res.json({ payments: all });
      return;
    }
    const ownShipments = await db.shipments.find((shipment) => shipment.shipperId === user.organizationId);
    const ownIds = new Set(ownShipments.map((shipment) => shipment.id));
    res.json({ payments: all.filter((payment) => Boolean(payment.shipmentId && ownIds.has(payment.shipmentId))) });
  }),
);

paymentsRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    const payment = await getPayment(id);
    const user = res.locals.authUser as User;
    if ((isProductionEnvironment() || process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') && !['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)) {
      const shipment = payment.shipmentId ? await db.shipments.findById(payment.shipmentId) : undefined;
      if (!shipment || shipment.shipperId !== user.organizationId) throw ApiError.notFound('Payment not found.');
    }
    res.json({ payment });
  }),
);

