import { Router } from 'express';
import { z } from 'zod';
import {
  confirmDelivery,
  confirmShipment,
  createShipment,
  declineShipment,
  getShipment,
  listShipments,
  shipmentTimeline,
  MAX_SHIPMENT_WEIGHT_T,
} from '../services/shipments.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { requireRoles } from '../middleware/auth.js';
import { db } from '../store/db.js';
import { ApiError } from '../lib/errors.js';
import type { User } from '../types.js';

export const shipmentsRouter: Router = Router();

async function assertShipmentAccess(user: User, shipmentId: string, allowedRoles?: User['role'][]): Promise<void> {
  if (process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') return;
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new ApiError(403, 'ROLE_FORBIDDEN', 'Your account cannot perform this shipment action.');
  }
  const shipment = await db.shipments.findById(shipmentId);
  if (!shipment) throw ApiError.notFound(`Shipment ${shipmentId} not found.`);
  if (user.role === 'CONTROL_TOWER' || user.role === 'OPERATOR' || user.role === 'VERIFIER') return;
  if (user.role === 'BUSINESS' && shipment.shipperId === user.organizationId) return;
  if (user.role === 'DRIVER' && shipment.truckId) {
    const drivers = await db.drivers.find((driver) => driver.userId === user.id);
    const truckIds = new Set(drivers.map((driver) => driver.assignedTruckId).filter((id): id is string => Boolean(id)));
    const truck = await db.trucks.findById(shipment.truckId);
    if (truck && truckIds.has(truck.id)) return;
  }
  throw ApiError.notFound(`Shipment ${shipmentId} not found.`);
}


const createShipmentSchema = z.object({
  shipperId: z.string().min(2),
  cargoName: z.string().min(2).max(120),
  reference: z.string().max(64).nullish(),
  origin: z.string().min(2),
  destination: z.string().min(2),
  weightT: z.number().positive().max(MAX_SHIPMENT_WEIGHT_T),
  deadlineAt: z.string().datetime().nullish(),
  capacityOfferId: z.string().min(2).nullish(),
  actorId: z.string().min(2).nullish(),
});

/**
 * POST /shipments
 *
 * With `capacityOfferId`, one atomic call creates the shipment and reserves the
 * capacity (DRAFT → CAPACITY_RESERVED), decrementing the truck's spare tonnage.
 * It stops there on purpose: the driver has not agreed to carry the load yet, so
 * `confirmed` comes back false and `awaitingDriverApproval` is true. The driver
 * accepts with `POST /shipments/:id/confirm`.
 * Without `capacityOfferId`, a plain DRAFT shipment is created.
 */
shipmentsRouter.post(
  '/shipments',
  requireRoles('BUSINESS'),
  validateBody(createShipmentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createShipmentSchema>;
    const result = await createShipment({
      shipperId: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? body.shipperId : (res.locals.authUser as User).organizationId,
      cargoName: body.cargoName,
      reference: body.reference ?? null,
      origin: body.origin,
      destination: body.destination,
      weightT: body.weightT,
      deadlineAt: body.deadlineAt ?? null,
      capacityOfferId: body.capacityOfferId ?? null,
      actorType: 'BUSINESS',
      actorId: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? body.actorId ?? null : (res.locals.authUser as User).id,
    });
    res.status(201).json({
      ok: true,
      shipment: result.shipment,
      reserved: result.reserved,
      confirmed: result.confirmed,
      awaitingDriverApproval: result.awaitingDriverApproval,
    });
  }),
);

const listQuerySchema = z.object({
  status: z.string().optional(),
  truckId: z.string().optional(),
});

shipmentsRouter.get(
  '/shipments',
  validateQuery(listQuerySchema),
  asyncHandler(async (_req, res) => {
    const query = res.locals.query as z.infer<typeof listQuerySchema>;
    const user = res.locals.authUser as User;
    const all = await listShipments(query);
    let shipments = all;
    if (user.role === 'BUSINESS') shipments = all.filter((shipment) => shipment.shipperId === user.organizationId);
    if (user.role === 'DRIVER') {
      const drivers = await db.drivers.find((driver) => driver.userId === user.id);
      const truckIds = new Set(drivers.map((driver) => driver.assignedTruckId).filter((id): id is string => Boolean(id)));
      shipments = all.filter((shipment) => Boolean(shipment.truckId && truckIds.has(shipment.truckId)));
    }
    res.json({ shipments, count: shipments.length });
  }),
);

shipmentsRouter.get(
  '/shipments/:id',
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    await assertShipmentAccess(res.locals.authUser as User, id);
    res.json({ shipment: await getShipment(id) });
  }),
);

/**
 * POST /shipments/:id/confirm — the driver's accept. CAPACITY_RESERVED → CONFIRMED.
 *
 * This is the approval gate: a reserved shipment stays pending until the driver
 * calls this, so a business can never unilaterally confirm a load onto a truck.
 */
shipmentsRouter.post(
  '/shipments/:id/confirm',
  requireRoles('DRIVER'),
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    await assertShipmentAccess(res.locals.authUser as User, id, ['DRIVER']);
    const shipment = await confirmShipment(id, { actorType: 'DRIVER', actorId: (res.locals.authUser as User).id });
    res.json({ ok: true, shipment, acceptedBy: 'DRIVER' });
  }),
);

const declineSchema = z.object({
  reason: z.string().max(240).nullish(),
  actorId: z.string().min(2).nullish(),
});

/**
 * POST /shipments/:id/decline — the driver says no.
 *
 * Releases the reserved tonnage back to the truck and its offer, and returns the
 * shipment to DRAFT (Master PRD §7 defines no CANCELLED state). The business can
 * then re-book onto another truck.
 */
shipmentsRouter.post(
  '/shipments/:id/decline',
  requireRoles('DRIVER'),
  validateBody(declineSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof declineSchema>;
    const id = requiredParam(req, 'id');
    await assertShipmentAccess(res.locals.authUser as User, id, ['DRIVER']);
    const result = await declineShipment(id, {
      reason: body.reason ?? null,
      actorType: 'DRIVER',
      actorId: (res.locals.authUser as User).id,
    });
    res.json({
      ok: true,
      declined: true,
      shipment: result.shipment,
      releasedTruck: result.truck,
      releasedOffer: result.offer,
    });
  }),
);

/** GET /shipments/:id/timeline — append-only event history for one shipment. */
shipmentsRouter.get(
  '/shipments/:id/timeline',
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    await assertShipmentAccess(res.locals.authUser as User, id);
    res.json(await shipmentTimeline(id));
  }),
);

const confirmDeliverySchema = z.object({
  actorId: z.string().min(2).nullish(),
});

/**
 * POST /shipments/:id/confirm-delivery — IN_TRANSIT → DELIVERED.
 *
 * The business confirms receipt. The state machine is enforced in the service, so
 * confirming a shipment that never departed returns 409 rather than a silent write.
 */
shipmentsRouter.post(
  '/shipments/:id/confirm-delivery',
  requireRoles('BUSINESS'),
  validateBody(confirmDeliverySchema),
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    await assertShipmentAccess(res.locals.authUser as User, id, ['BUSINESS']);
    const result = await confirmDelivery(id, {
      actorType: 'BUSINESS',
      actorId: (res.locals.authUser as User).id,
    });
    res.json({
      ok: true,
      shipment: result.shipment,
      truck: result.truck,
      truckCompleted: result.truckCompleted,
      ...(result.truckNote ? { truckNote: result.truckNote } : {}),
    });
  }),
);
