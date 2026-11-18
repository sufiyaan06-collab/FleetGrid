import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { createDodoCheckout, getPayment, listPayments } from '../services/payments.js';

export const paymentsRouter: Router = Router();

const createDodoCheckoutSchema = z.object({
  shipmentId: z.string().min(2).nullish(),
  recoveryPlanId: z.string().min(2).nullish(),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  customerName: z.string().min(1).optional(),
  customerEmail: z.string().email().optional(),
  returnUrl: z.string().url().optional(),
});

paymentsRouter.post(
  '/payments/dodo/checkout',
  validateBody(createDodoCheckoutSchema),
  asyncHandler(async (req, res) => {
    const result = await createDodoCheckout(req.body);
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
    res.json({ payments: await listPayments() });
  }),
);

paymentsRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    res.json({ payment: await getPayment(id) });
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
