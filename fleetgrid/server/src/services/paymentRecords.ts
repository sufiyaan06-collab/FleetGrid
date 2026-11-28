import { db } from '../store/db.js';
import { ApiError } from '../lib/errors.js';
import type { Payment } from '../types.js';

export async function listPayments(): Promise<Payment[]> {
  return db.payments.get();
}

export async function getPayment(id: string): Promise<Payment> {
  const payment = await db.payments.findById(id);
  if (!payment) throw ApiError.notFound(`Payment ${id} does not exist.`);
  return payment;
}
