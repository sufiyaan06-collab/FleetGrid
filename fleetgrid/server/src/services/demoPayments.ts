import { db } from '../store/db.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import { runExclusive } from '../lib/mutex.js';
import { recordEvent } from './events.js';
import { hub } from './realtime.js';
import type { Payment, Shipment, User } from '../types.js';

/**
 * College-demo payment simulator. This records an explicitly simulated payment
 * in FleetGrid only; it never contacts a bank, wallet, card network or payment
 * provider and must never be represented as a real-money settlement.
 */
export async function createDemoPayment(shipmentId: string, actor: User): Promise<Payment> {
  return runExclusive(async () => {
    const shipment = await db.shipments.findById(shipmentId);
    if (!shipment || shipment.shipperId !== actor.organizationId) {
      throw ApiError.notFound('Shipment not found.');
    }
    if (shipment.status !== 'CONFIRMED') {
      throw ApiError.conflict('The assigned driver must accept the shipment before a demo payment can be created.');
    }
    if (shipment.price === null || !Number.isFinite(shipment.price) || shipment.price <= 0 || !shipment.currency || !/^[A-Z]{3}$/.test(shipment.currency)) {
      throw ApiError.badRequest('The shipment must have a valid agreed amount and currency.');
    }
    const existing = await db.payments.find((payment) =>
      payment.shipmentId === shipment.id && payment.status !== 'FAILED',
    );
    if (existing.some((payment) => payment.status === 'PAID')) {
      throw ApiError.conflict('This shipment already has a completed payment.');
    }
    if (existing.some((payment) => payment.status === 'PENDING' || payment.status === 'CREATED')) {
      throw ApiError.conflict('A payment is already awaiting confirmation for this shipment.');
    }

    const timestamp = nowIso();
    const payment: Payment = {
      id: newId('pay'),
      shipmentId: shipment.id,
      recoveryPlanId: null,
      provider: 'FleetGrid Demo Simulator',
      amount: shipment.price,
      currency: shipment.currency,
      status: 'PENDING',
      providerReference: null,
      providerPaymentId: null,
      checkoutUrl: null,
      customerName: actor.name,
      customerEmail: null,
      paymentMethod: 'DEMO_SIMULATOR',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    let saved: Payment;
    try {
      saved = await db.payments.create(payment);
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'fleetgrid_active_payment_shipment_unique_idx') {
        throw ApiError.conflict('A payment is already awaiting confirmation for this shipment.');
      }
      throw error;
    }
    await recordEvent({
      eventType: 'payment.demo_created',
      shipmentId: shipment.id,
      truckId: shipment.truckId,
      payload: {
        paymentId: saved.id,
        amount: saved.amount,
        currency: saved.currency,
        mode: 'DEMO_ONLY_NO_MONEY_MOVED',
      },
      actorType: 'BUSINESS',
      actorId: actor.id,
    });
    hub.broadcast('payment.updated', saved);
    return saved;
  });
}

/** Server-side demo action; repeated settlement requests are safely idempotent. */
export async function settleDemoPayment(paymentId: string, actor: User): Promise<Payment> {
  return runExclusive(async () => {
    const payment = await db.payments.findById(paymentId);
    if (!payment || payment.provider !== 'FleetGrid Demo Simulator' || !payment.shipmentId) {
      throw ApiError.notFound('Demo payment not found.');
    }
    const shipment = await db.shipments.findById(payment.shipmentId);
    if (!shipment || shipment.shipperId !== actor.organizationId) {
      throw ApiError.notFound('Demo payment not found.');
    }
    if (payment.status === 'PAID') return payment;
    if (payment.status !== 'PENDING') {
      throw ApiError.conflict(`Demo payment cannot be settled from ${payment.status}.`);
    }

    const updated = await db.payments.update(payment.id, {
      status: 'PAID',
      paymentMethod: 'DEMO_SIMULATED',
      updatedAt: nowIso(),
    });
    if (!updated) throw ApiError.notFound('Demo payment not found.');
    await recordEvent({
      eventType: 'payment.demo_settled',
      shipmentId: shipment.id,
      truckId: shipment.truckId,
      payload: {
        paymentId: updated.id,
        amount: updated.amount,
        currency: updated.currency,
        mode: 'DEMO_ONLY_NO_MONEY_MOVED',
      },
      actorType: 'BUSINESS',
      actorId: actor.id,
    });
    hub.broadcast('payment.updated', updated);
    return updated;
  });
}
