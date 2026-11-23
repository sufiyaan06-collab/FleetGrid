import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../store/db.js';
import { hub } from '../services/realtime.js';
import { asyncHandler } from '../middleware/errors.js';
import { nowIso } from '../lib/ids.js';

export const healthRouter: Router = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const [trucks, shipments, incidents, events] = await Promise.all([
      db.trucks.get(),
      db.shipments.get(),
      db.incidents.get(),
      db.events.get(),
    ]);

    res.json({
      status: 'ok',
      service: 'fleetgrid-api',
      version: '0.1.0',
      time: nowIso(),
      storage: db.storage,
      ...(db.storage === 'json-file' ? { dataDir: config.dataDir } : {}),
      readiness: {
        persistentStorage: db.storage === 'postgresql',
        postgresSchemaApproved: process.env.FLEETGRID_POSTGRES_SCHEMA_READY === 'true',
        emailDelivery: Boolean(
          process.env.RESEND_API_KEY?.trim()
          && process.env.EMAIL_FROM?.trim()
          && process.env.APP_BASE_URL?.trim(),
        ),
      },
      payments: { mode: 'DEMO_ONLY', realMoneyEnabled: false },
      realtime: { path: '/realtime', connectedClients: hub.clientCount() },
      counts: {
        trucks: trucks.length,
        shipments: shipments.length,
        incidents: incidents.length,
        events: events.length,
      },
    });
  }),
);
