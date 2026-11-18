import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { recordEvent } from '../services/events.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requireRoles } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import type { User } from '../types.js';

export const eventsRouter: Router = Router();

const recordEventSchema = z.object({
  eventType: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'eventType must be lower_snake or dot.separated, e.g. "shipment.note"'),
  shipmentId: z.string().min(2).nullish(),
  incidentId: z.string().min(2).nullish(),
  truckId: z.string().min(2).nullish(),
  payload: z.record(z.unknown()).optional(),
  actorType: z.enum(['SYSTEM', 'AGENT', 'OPERATOR', 'DRIVER', 'BUSINESS']).optional(),
  actorId: z.string().min(2).nullish(),
});

/** POST /events — append an event to the immutable log. */
eventsRouter.post(
  '/events',
  validateBody(recordEventSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof recordEventSchema>;
    const user = res.locals.authUser as User;

    if (body.shipmentId) {
      const shipment = await db.shipments.findById(body.shipmentId);
      if (!shipment || (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && user.role === 'BUSINESS' && shipment.shipperId !== user.organizationId)) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: `Shipment ${body.shipmentId} does not exist.` },
        });
        return;
      }
    }

    if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && user.role === 'DRIVER') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      if (!driver || (body.truckId && driver.assignedTruckId !== body.truckId)) throw ApiError.notFound('Event resource not found.');
      if (body.incidentId) {
        const incident = await db.incidents.findById(body.incidentId);
        if (!incident || incident.truckId !== driver.assignedTruckId) throw ApiError.notFound('Event resource not found.');
      }
    }

    const event = await recordEvent({
      eventType: body.eventType,
      shipmentId: body.shipmentId ?? null,
      incidentId: body.incidentId ?? null,
      truckId: body.truckId ?? null,
      payload: body.payload ?? {},
      actorType: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? body.actorType : user.role === 'BUSINESS' ? 'BUSINESS' : user.role === 'DRIVER' ? 'DRIVER' : 'OPERATOR',
      actorId: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? body.actorId ?? null : user.id,
    });
    res.status(201).json({ ok: true, event });
  }),
);

const listQuerySchema = z.object({
  shipmentId: z.string().optional(),
  truckId: z.string().optional(),
  incidentId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

eventsRouter.get(
  '/events',
  validateQuery(listQuerySchema),
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const query = res.locals.query as z.infer<typeof listQuerySchema>;
    const events = await db.events.find((e) => {
      if (query.shipmentId && e.shipmentId !== query.shipmentId) return false;
      if (query.truckId && e.truckId !== query.truckId) return false;
      if (query.incidentId && e.incidentId !== query.incidentId) return false;
      return true;
    });
    let visible = events;
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && user.role === 'BUSINESS') {
      const shipments = await db.shipments.find((shipment) => shipment.shipperId === user.organizationId);
      const shipmentIds = new Set(shipments.map((shipment) => shipment.id));
      visible = visible.filter((event) => Boolean(event.shipmentId && shipmentIds.has(event.shipmentId)));
    } else if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && user.role === 'DRIVER') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      visible = driver?.assignedTruckId ? visible.filter((event) => event.truckId === driver.assignedTruckId) : [];
    }
    const limited = query.limit ? visible.slice(-query.limit) : visible;
    res.json({ events: limited, count: limited.length, total: visible.length });
  }),
);
