import DodoPayments from 'dodopayments';
import { db } from '../store/db.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { runExclusive } from '../lib/mutex.js';
import { recordEvent } from './events.js';
import { hub } from './realtime.js';
import { isProductionEnvironment } from '../config.js';
import type { Payment, Shipment } from '../types.js';

/**
 * Dodo expects the currency's smallest denomination (paise for INR, cents for USD).
 * FleetGrid stores shipment prices in major currency units.
 */
export function toDodoMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw ApiError.badRequest('The shipment amount must be a positive finite number.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw ApiError.badRequest('The shipment currency must be a valid uppercase ISO 4217 code.');
  }
  let fractionDigits: number;
  try {
    fractionDigits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    throw ApiError.badRequest('The shipment currency is not supported for payment processing.');
  }
  const factor = 10 ** fractionDigits;
  const minorUnits = Math.round((amount + Number.EPSILON) * factor);
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0 || Math.abs(amount * factor - minorUnits) > 0.000001) {
    throw ApiError.badRequest('The shipment amount has unsupported precision for the selected currency.');
  }
  return minorUnits;
}

export interface CreateDodoCheckoutInput {
  shipmentId?: string | null;
  recoveryPlanId?: string | null;
  amount: number;
  currency?: string;
  customerName?: string;
  customerEmail?: string;
}

export interface DodoCheckoutResult {
  payment: Payment;
  checkoutUrl: string;
  isSandbox: boolean;
  provider: string;
}

/**
 * Creates a Dodo Payments checkout session.
 * Uses the real Dodo Payments API only when API credentials, product configuration,
 * signed webhook verification, and the explicit checkout-enable switch are configured.
 * There is no simulated or fabricated checkout fallback.
 */
export async function createDodoCheckout(input: CreateDodoCheckoutInput): Promise<DodoCheckoutResult> {
  return runExclusive(async () => {
    let shipment: Shipment | undefined;
    if (input.shipmentId) {
      shipment = await db.shipments.findById(input.shipmentId);
      if (!shipment) {
        throw ApiError.notFound(`Shipment ${input.shipmentId} does not exist.`);
      }
      const existingPayments = await db.payments.find((payment) =>
        payment.shipmentId === shipment!.id && payment.status !== 'FAILED',
      );
      if (existingPayments.some((payment) => payment.status === 'PAID')) {
        throw ApiError.conflict('This shipment already has a completed payment.');
      }
      if (existingPayments.some((payment) => payment.status === 'PENDING' || payment.status === 'CREATED')) {
        throw ApiError.conflict('A payment checkout is already pending for this shipment.');
      }
    }

    const paymentId = newId('pay');
    const currency = input.currency || 'INR';
    const amount = input.amount;
    const amountMinor = toDodoMinorUnits(amount, currency);
    const apiKey = process.env.DODO_PAYMENTS_API_KEY;
    const productId = process.env.DODO_PRODUCT_ID?.trim();
    const environment = process.env.DODO_ENVIRONMENT || 'test_mode';
    const webhookKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY;
    const webhookEnabled = process.env.DODO_PAYMENTS_WEBHOOK_ENABLED === 'true';

    if (!apiKey || apiKey.trim().length <= 5) {
      throw ApiError.notImplemented(
        'Dodo Payments is not configured. Add a valid DODO_PAYMENTS_API_KEY in the server environment before accepting payments.',
      );
    }

    if (!productId) {
      throw ApiError.notImplemented('Dodo Payments product is not configured. Set DODO_PRODUCT_ID to a real product in the selected Dodo account.');
    }
    if (!webhookKey) {
      throw ApiError.notImplemented('Dodo checkout is disabled until DODO_PAYMENTS_WEBHOOK_KEY is configured for signed payment confirmation.');
    }
    if (!webhookEnabled) {
      throw ApiError.notImplemented('Dodo checkout is disabled until the signed webhook endpoint has been tested and DODO_PAYMENTS_WEBHOOK_ENABLED is set to true.');
    }
    if (environment !== 'test_mode' && environment !== 'live_mode') {
      throw ApiError.badRequest('DODO_ENVIRONMENT must be test_mode or live_mode.');
    }
    if (environment === 'live_mode' && process.env.DODO_LIVE_PAYMENTS_ENABLED !== 'true') {
      throw ApiError.notImplemented('Live payments remain disabled until explicitly approved and test-mode verification is complete.');
    }
    if (!input.customerEmail || !input.customerName) {
      throw ApiError.badRequest('A real customer name and billing email are required to create a payment session.');
    }

    const client = new DodoPayments({
      bearerToken: apiKey,
      environment: environment as 'test_mode' | 'live_mode',
    });

    let session;
    try {
      session = await client.checkoutSessions.create({
        product_cart: [
          {
            product_id: productId,
            quantity: 1,
            amount: amountMinor,
          },
        ],
        metadata: {
          fleetgrid_payment_id: paymentId,
          fleetgrid_shipment_id: shipment?.id ?? '',
        },
        return_url: (() => {
          const frontendBase = process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || (!isProductionEnvironment() ? 'http://localhost:5173' : '');
          if (!frontendBase) throw ApiError.notImplemented('Set APP_BASE_URL to the public FleetGrid frontend before enabling Dodo checkout.');
          const url = new URL('/', frontendBase);
          url.searchParams.set('payment', 'return');
          url.searchParams.set('id', paymentId);
          return url.toString();
        })(),
        cancel_url: (() => {
          const frontendBase = process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || (!isProductionEnvironment() ? 'http://localhost:5173' : '');
          if (!frontendBase) throw ApiError.notImplemented('Set APP_BASE_URL to the public FleetGrid frontend before enabling Dodo checkout.');
          const url = new URL('/', frontendBase);
          url.searchParams.set('payment', 'cancelled');
          url.searchParams.set('id', paymentId);
          return url.toString();
        })(),
        customer: {
          email: input.customerEmail,
          name: input.customerName,
        },
      });
    } catch (err) {
      console.error('[DodoPayments] Checkout session creation failed:', err instanceof Error ? err.message : 'Unknown provider error');
      throw ApiError.notImplemented(
        'Dodo Payments could not create a checkout session. Check the API key, product configuration, and Dodo account mode, then try again.',
      );
    }

    if (!session.checkout_url || !session.session_id) {
      throw ApiError.notImplemented('Dodo Payments did not return a valid checkout URL and session reference.');
    }

    const checkoutUrl = session.checkout_url;
    const providerReference = session.session_id;
    const isSandbox = (process.env.DODO_ENVIRONMENT || 'test_mode') === 'test_mode';

    const payment: Payment = {
      id: paymentId,
      shipmentId: input.shipmentId ?? null,
      recoveryPlanId: input.recoveryPlanId ?? null,
      provider: 'Dodo Payments',
      amount,
      currency,
      status: 'PENDING',
      providerReference,
      checkoutUrl,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      paymentMethod: 'DODO_CHECKOUT',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    let saved: Payment;
    try {
      saved = await db.payments.create(payment);
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'fleetgrid_active_payment_shipment_unique_idx') {
        throw ApiError.conflict('A payment checkout is already active for this shipment.');
      }
      throw error;
    }

    await recordEvent({
      eventType: 'payment.created',
      shipmentId: shipment?.id ?? null,
      truckId: shipment?.truckId ?? null,
      payload: {
        paymentId: saved.id,
        amount: saved.amount,
        currency: saved.currency,
        provider: 'Dodo Payments',
        checkoutUrl,
      },
      actorType: 'BUSINESS',
    });

    hub.broadcast('payment.updated', saved);

    return {
      payment: saved,
      checkoutUrl,
      isSandbox,
      provider: 'Dodo Payments',
    };
  });
}

export interface ConfirmPaymentResult {
  payment: Payment;
  shipment: Shipment | null;
}

/**
 * Settles a payment only after the provider webhook has been signature-verified.
 * The checkout session id must match the session created by FleetGrid. Shipment
 * workflow state is deliberately untouched; driver acceptance remains its own gate.
 */
export async function confirmDodoPayment(
  paymentId: string,
  checkoutSessionId?: string,
  paymentMethod?: string,
  providerPaymentId?: string,
): Promise<ConfirmPaymentResult> {
  return runExclusive(async () => {
    const payment = await db.payments.findById(paymentId);
    if (!payment) throw ApiError.notFound(`Payment ${paymentId} does not exist.`);
    if (!checkoutSessionId || payment.providerReference !== checkoutSessionId) {
      throw ApiError.conflict('The verified Dodo event does not match this checkout session.');
    }
    const shipment = payment.shipmentId ? await db.shipments.findById(payment.shipmentId) ?? null : null;
    if (payment.status === 'PAID') return { payment, shipment };
    if (!['CREATED', 'PENDING', 'FAILED'].includes(payment.status)) {
      throw ApiError.conflict(`Payment ${payment.id} cannot be settled from ${payment.status}.`);
    }

    const updatedPayment = await db.payments.update(payment.id, {
      status: 'PAID',
      providerPaymentId: providerPaymentId ?? payment.providerPaymentId ?? null,
      paymentMethod: paymentMethod ?? payment.paymentMethod ?? 'Dodo Hosted Checkout',
      updatedAt: nowIso(),
    });
    if (!updatedPayment) throw ApiError.notFound(`Payment ${paymentId} disappeared.`);

    await recordEvent({
      eventType: 'payment.confirmed',
      shipmentId: shipment?.id ?? null,
      truckId: shipment?.truckId ?? null,
      payload: {
        paymentId: updatedPayment.id,
        providerPaymentId: updatedPayment.providerPaymentId ?? null,
        checkoutSessionId,
        amount: updatedPayment.amount,
        currency: updatedPayment.currency,
        provider: 'Dodo Payments',
      },
      actorType: 'SYSTEM',
    });
    hub.broadcast('payment.updated', updatedPayment);
    return { payment: updatedPayment, shipment };
  });
}

/** Mark a checkout failed/cancelled from a verified provider webhook. */
export async function failDodoPayment(
  paymentId: string,
  checkoutSessionId: string,
  reason?: string,
): Promise<Payment> {
  return runExclusive(async () => {
    const payment = await db.payments.findById(paymentId);
    if (!payment) throw ApiError.notFound(`Payment ${paymentId} does not exist.`);
    if (payment.providerReference !== checkoutSessionId) {
      throw ApiError.conflict('The verified Dodo event does not match this checkout session.');
    }
    if (payment.status === 'PAID' || payment.status === 'FAILED') return payment;

    const updated = await db.payments.update(payment.id, {
      status: 'FAILED',
      updatedAt: nowIso(),
    });
    if (!updated) throw ApiError.notFound(`Payment ${paymentId} disappeared.`);
    await recordEvent({
      eventType: 'payment.failed',
      shipmentId: payment.shipmentId,
      payload: { paymentId: payment.id, checkoutSessionId, reason: reason ?? 'Provider reported payment failure' },
      actorType: 'SYSTEM',
    });
    hub.broadcast('payment.updated', updated);
    return updated;
  });
}

export async function listPayments(): Promise<Payment[]> {
  return db.payments.get();
}

export async function getPayment(id: string): Promise<Payment> {
  const payment = await db.payments.findById(id);
  if (!payment) {
    throw ApiError.notFound(`Payment ${id} does not exist.`);
  }
  return payment;
}
