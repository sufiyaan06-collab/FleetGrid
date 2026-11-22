import { Router } from 'express';
import DodoPayments from 'dodopayments';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { confirmDodoPayment, createDodoCheckout, failDodoPayment, getPayment, listPayments } from '../services/payments.js';
import { db } from '../store/db.js';
import { requireAuthenticated, requireRoles } from '../middleware/auth.js';
import { requireTrustedOrigin } from '../middleware/trustedOrigin.js';
import { ApiError } from '../lib/errors.js';
import { isProductionEnvironment } from '../config.js';
import { toDodoMinorUnits } from '../services/payments.js';
import type { User } from '../types.js';

export const paymentsRouter: Router = Router();

// Provider callbacks are public only at this route and are authenticated by the
// Dodo Standard Webhooks signature. All other payment routes require a user session.
paymentsRouter.post(
  '/payments/dodo/webhook',
  asyncHandler(async (req, res) => {
    const webhookKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    if (!webhookKey) {
      res.status(503).json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'Dodo webhook signature verification is not configured.' } });
      return;
    }

    const rawBody = (req as typeof req & { rawBody?: string }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: { code: 'WEBHOOK_RAW_BODY_REQUIRED', message: 'The original signed request body is unavailable.' } });
      return;
    }

    // The SDK constructor requires a bearer token even though unwrap performs no API call.
    const client = new DodoPayments({
      bearerToken: process.env.DODO_PAYMENTS_API_KEY || 'webhook-verification-only',
      webhookKey,
    });
    let event;
    try {
      event = client.webhooks.unwrap(rawBody, {
        headers: {
          'webhook-id': req.get('webhook-id') ?? '',
          'webhook-signature': req.get('webhook-signature') ?? '',
          'webhook-timestamp': req.get('webhook-timestamp') ?? '',
        },
      });
    } catch {
      res.status(401).json({ error: { code: 'WEBHOOK_SIGNATURE_INVALID', message: 'Dodo webhook signature is invalid or expired.' } });
      return;
    }

    const data = event.data as {
      checkout_session_id?: string | null;
      payment_id?: string;
      payment_method?: string | null;
      currency?: string;
      status?: string | null;
      total_amount?: number;
      tax?: number | null;
      metadata?: Record<string, string>;
    };
    const sessionId = data.checkout_session_id;
    if (!sessionId) {
      res.json({ ok: true, ignored: true, reason: 'No checkout session reference was present.' });
      return;
    }

    const matches = await db.payments.find((payment) =>
      payment.provider === 'Dodo Payments' && payment.providerReference === sessionId,
    );
    const payment = matches[0];
    if (!payment) {
      // Dodo can deliver the event before the local checkout row finishes saving.
      // A FleetGrid metadata marker makes this a retryable out-of-order event.
      if (data.metadata?.fleetgrid_payment_id) {
        res.status(503).json({ error: { code: 'PAYMENT_RECORD_NOT_READY', message: 'FleetGrid is still preparing this payment record. Please retry the webhook.' } });
        return;
      }
      // A webhook configured for this endpoint may also receive unrelated Dodo events.
      res.json({ ok: true, ignored: true });
      return;
    }

    if (data.metadata?.fleetgrid_payment_id && data.metadata.fleetgrid_payment_id !== payment.id) {
      console.warn('[DodoPayments] Ignored verified event with mismatched FleetGrid payment metadata', payment.id);
      res.json({ ok: true, ignored: true, reason: 'Payment metadata did not match the local record.' });
      return;
    }

    if (!data.currency || data.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      console.warn('[DodoPayments] Ignored verified event with currency mismatch for local payment', payment.id);
      res.json({ ok: true, ignored: true, reason: 'Currency did not match the local checkout.' });
      return;
    }

    if (event.type === 'payment.succeeded') {
      if (data.status !== 'succeeded' || !Number.isSafeInteger(data.total_amount)) {
        console.warn('[DodoPayments] Ignored success event without a settled status and integer total', payment.id);
        res.json({ ok: true, ignored: true, reason: 'Payment was not reported as settled.' });
        return;
      }
      const expectedMinor = toDodoMinorUnits(payment.amount, payment.currency);
      const paidBeforeTax = data.total_amount! - (data.tax ?? 0);
      if (paidBeforeTax !== expectedMinor) {
        console.warn('[DodoPayments] Ignored verified event with amount mismatch', payment.id, {
          expectedMinor,
          providerTotalMinor: data.total_amount,
          providerTaxMinor: data.tax ?? 0,
        });
        res.json({ ok: true, ignored: true, reason: 'Provider amount did not match the agreed shipment amount.' });
        return;
      }
      await confirmDodoPayment(payment.id, sessionId, data.payment_method ?? undefined, data.payment_id);
    } else if ((event.type === 'payment.failed' && data.status === 'failed') ||
               (event.type === 'payment.cancelled' && data.status === 'cancelled')) {
      await failDodoPayment(payment.id, sessionId, event.type);
    }

    res.status(200).json({ ok: true, received: true });
  }),
);

paymentsRouter.use(requireTrustedOrigin);
paymentsRouter.use(requireAuthenticated);

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
    // The server-side shipment record is authoritative. Never accept a client-
    // supplied amount as the source of truth or start a zero-value checkout.
    if (!Number.isFinite(shipment.price) || shipment.price <= 0) {
      throw ApiError.badRequest('Set a positive agreed shipment price before starting checkout.');
    }
    if (!/^[A-Z]{3}$/.test(shipment.currency)) {
      throw ApiError.badRequest('The shipment must have a valid three-letter currency code before checkout.');
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

