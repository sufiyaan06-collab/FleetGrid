import { config, isProductionEnvironment } from '../config.js';
import { buildSeedData } from '../seed/seed.js';
import { db } from '../store/db.js';
import { hub } from './realtime.js';

/**
 * Writes the deterministic demo dataset into every collection.
 * `POST /demo/reset` calls this so a rehearsal always starts from the same state.
 */
export async function seedDemoData(): Promise<{ trucks: number; shipments: number }> {
  const data = buildSeedData();

  await Promise.all([
    db.organizations.replaceAll(data.organizations),
    db.users.replaceAll(data.users),
    db.drivers.replaceAll(data.drivers),
    db.trucks.replaceAll(data.trucks),
    db.shipments.replaceAll(data.shipments),
    db.capacityOffers.replaceAll(data.capacityOffers),
    db.incidents.replaceAll(data.incidents),
    db.recoveryPlans.replaceAll(data.recoveryPlans),
    db.payments.replaceAll(data.payments),
    db.events.replaceAll(data.events),
    db.notifications.replaceAll(data.notifications),
  ]);

  return { trucks: data.trucks.length, shipments: data.shipments.length };
}

export async function resetDemo(): Promise<{ trucks: number; shipments: number }> {
  const result = await seedDemoData();
  hub.broadcast('demo.reset', { ...result, at: new Date().toISOString() });
  return result;
}

/** Seeds automatically on a fresh clone so the demo works with zero manual steps. */
export async function ensureSeeded(): Promise<{ seeded: boolean; trucks: number; shipments: number }> {
  // Never populate a production database with deterministic demo identities or fleet records.
  if (isProductionEnvironment()) {
    return { seeded: false, trucks: (await db.trucks.get()).length, shipments: (await db.shipments.get()).length };
  }
  const existingTrucks = await db.trucks.get();
  if (existingTrucks.length > 0) {
    return { seeded: false, trucks: existingTrucks.length, shipments: (await db.shipments.get()).length };
  }
  if (!config.autoSeed) {
    return { seeded: false, trucks: 0, shipments: 0 };
  }
  const result = await seedDemoData();
  return { seeded: true, ...result };
}
