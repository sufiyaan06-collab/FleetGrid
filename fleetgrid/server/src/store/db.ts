import { Pool } from 'pg';
import { config, isProductionEnvironment } from '../config.js';
import { createJsonStore, dataFile, type Store } from './jsonStore.js';
import { createPostgresStore, initializePostgres } from './postgresStore.js';
import type {
  AuthAccount,
  CapacityOffer,
  Driver,
  FleetSnapshot,
  Incident,
  Notification,
  Organization,
  Payment,
  RecoveryPlan,
  Shipment,
  ShipmentEvent,
  Truck,
  User,
} from '../types.js';

/**
 * The single persistence surface for the whole application.
 *
 * Services receive `db` (this object) and never know that files are involved.
 */
export interface Db {
  organizations: Store<Organization>;
  users: Store<User>;
  /** Private credentials and session hashes; deliberately excluded from snapshot(). */
  authAccounts: Store<AuthAccount>;
  drivers: Store<Driver>;
  trucks: Store<Truck>;
  shipments: Store<Shipment>;
  capacityOffers: Store<CapacityOffer>;
  incidents: Store<Incident>;
  recoveryPlans: Store<RecoveryPlan>;
  payments: Store<Payment>;
  events: Store<ShipmentEvent>;
  notifications: Store<Notification>;
  /** Initializes persistent storage before any collection is accessed. */
  initialize(): Promise<void>;
  close(): Promise<void>;
  storage: 'postgresql' | 'json-file';
  snapshot(): Promise<FleetSnapshot>;
}

function build(dataDir: string): Db {
  const connectionString = process.env.DATABASE_URL;
  const pool = connectionString
    ? new Pool({
        connectionString,
        max: 5,
        ...(process.env.PGSSLMODE === 'require'
          ? { ssl: { rejectUnauthorized: false } }
          : {}),
      })
    : null;

  const store = <T extends { id: string }>(name: string, file: string) =>
    pool
      ? createPostgresStore<T>(pool, { collection: name })
      : createJsonStore<T>({ filePath: dataFile(dataDir, file), name });

  const db: Db = {
    storage: pool ? 'postgresql' : 'json-file',
    async initialize() {
      // A Render free web service has an ephemeral filesystem. Never silently
      // start production with JSON-file storage and lose writes on restart.
      if (!pool && isProductionEnvironment()) {
        throw new Error('DATABASE_URL is required in production. Refusing to start with ephemeral JSON-file storage.');
      }
      // The existing Render database contains legacy relational tables. Require
      // an explicit release gate before the Node app creates its JSONB schema.
      if (pool && isProductionEnvironment() && process.env.FLEETGRID_POSTGRES_SCHEMA_READY !== 'true') {
        throw new Error('FLEETGRID_POSTGRES_SCHEMA_READY=true is required before initializing FleetGrid PostgreSQL storage. Verify the target database and backup first.');
      }
      if (pool) await initializePostgres(pool);
    },
    async close() {
      if (pool) await pool.end();
    },
    organizations: store<Organization>('organizations', 'organizations.json'),
    users: store<User>('users', 'users.json'),
    authAccounts: store<AuthAccount>('auth-accounts', 'auth-accounts.json'),
    drivers: store<Driver>('drivers', 'drivers.json'),
    trucks: store<Truck>('trucks', 'trucks.json'),
    shipments: store<Shipment>('shipments', 'shipments.json'),
    capacityOffers: store<CapacityOffer>('capacity-offers', 'capacity-offers.json'),
    incidents: store<Incident>('incidents', 'incidents.json'),
    recoveryPlans: store<RecoveryPlan>('recovery-plans', 'recovery-plans.json'),
    payments: store<Payment>('payments', 'payments.json'),
    events: store<ShipmentEvent>('shipment-events', 'shipment-events.json'),
    notifications: store<Notification>('notifications', 'notifications.json'),

    async snapshot() {
      const [
        organizations,
        users,
        drivers,
        trucks,
        shipments,
        capacityOffers,
        incidents,
        recoveryPlans,
        payments,
        events,
        notifications,
      ] = await Promise.all([
        db.organizations.get(),
        db.users.get(),
        db.drivers.get(),
        db.trucks.get(),
        db.shipments.get(),
        db.capacityOffers.get(),
        db.incidents.get(),
        db.recoveryPlans.get(),
        db.payments.get(),
        db.events.get(),
        db.notifications.get(),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        organizations,
        users,
        drivers,
        trucks,
        shipments,
        capacityOffers,
        incidents,
        recoveryPlans,
        payments,
        events,
        notifications,
      };
    },
  };

  return db;
}

export const db: Db = build(config.dataDir);
