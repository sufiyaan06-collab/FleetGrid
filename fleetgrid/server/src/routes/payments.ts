import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { createDodoCheckout, getPayment, listPayments } from '../services/payments.js';
import { db } from '../store/db.js';
import { requireRoles } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import type { User } from '../types.js';

export const paymentsRouter: Router = Router();

const createDodoCheckoutSchema = z.object({
  shipmentId: z.string().min(2).nullish(),
  recoveryPlanId: z.string().min(2).nullish(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  customerName: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
});

paymentsRouter.post(
  '/payments/dodo/checkout',
  requireRoles('BUSINESS'),
  validateBody(createDodoCheckoutSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createDodoCheckoutSchema>;
    const user = res.locals.authUser as User;
    if (!body.shipmentId) throw ApiError.badRequest('A shipment must be linked to a shipper payment.');
    const shipment = await db.shipments.findById(body.shipmentId);
    if (!shipment || (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && shipment.shipperId !== user.organizationId)) {
      throw ApiError.notFound('Shipment not found.');
    }
    const account = await db.authAccounts.findById(user.id);
    if (!account?.email) throw new ApiError(400, 'BILLING_EMAIL_REQUIRED', 'Add a verified account email before starting checkout.');
    const result = await createDodoCheckout({
      shipmentId: shipment.id,
      amount: shipment.price,
      currency: shipment.currency,
      customerName: user.name,
      customerEmail: account.email,
    });
    res.status(201).json(result);
  }),
);

// A browser redirect or client request is not proof that money was received.
// Only a signature-verified provider webhook may transition a payment to PAID.
paymentsRouter.post('/payments/dodo/confirm', (_req, res) => {
  res.status(409).json({
    error: {
      code: 'PROVIDER_CONFIRMATION_REQUIRED',
      message: 'Payment confirmation is only accepted from a verified Dodo Payments webhook.',
    },
  });
});

paymentsRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const all = await listPayments();
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' || ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)) {
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
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && !['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)) {
      const shipment = payment.shipmentId ? await db.shipments.findById(payment.shipmentId) : undefined;
      if (!shipment || shipment.shipperId !== user.organizationId) throw ApiError.notFound('Payment not found.');
    }
    res.json({ payment });
  }),
);

// Do not trust unsigned webhook payloads. Signature verification must be
// configured against Dodo's webhook secret before processing any event.
paymentsRouter.post('/payments/dodo/webhook', (_req, res) => {
  res.status(503).json({
    error: {
      code: 'WEBHOOK_NOT_CONFIGURED',
      message: 'Dodo webhook signature verification is not configured. No payment status was changed.',
    },
  });
});
