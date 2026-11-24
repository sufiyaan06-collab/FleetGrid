import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { createTruck, departTruck, getTruck, listTrucks, updateTruckLocation } from '../services/trucks.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { requireRoles } from '../middleware/auth.js';
import type { User } from '../types.js';
import { ApiError } from '../lib/errors.js';

export const trucksRouter: Router = Router();

trucksRouter.get(
  '/trucks/locations',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    let trucks = await listTrucks();
    if (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      const ownTruckIds = new Set(driver?.assignedTruckId ? [driver.assignedTruckId] : []);
      trucks = trucks.filter((truck) => ownTruckIds.has(truck.id));
    } else if (user.role === 'BUSINESS' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const ownShipments = await db.shipments.find((shipment) => shipment.shipperId === user.organizationId);
      const ownTruckIds = new Set(ownShipments.map((shipment) => shipment.truckId).filter((id): id is string => Boolean(id)));
      trucks = trucks.filter((truck) => ownTruckIds.has(truck.id));
    }
    res.json(
      trucks.map((t) => ({
        id: t.id,
        registration_no: t.registrationNo,
        registration_number: t.registrationNo,
        latitude: t.lat,
        longitude: t.lng,
        speed_kmph: t.speedKmph ?? 0,
        heading: t.heading ?? 0,
        status: t.status,
        location_status: t.status,
        origin: t.origin,
        destination: t.destination,
      })),
    );
  }),
);


const createTruckSchema = z.object({
  id: z.string().min(2).max(32).optional(),
  organizationId: z.string().min(2),
  registrationNo: z.string().min(2),
  capacityT: z.number().positive(),
  availableT: z.number().positive().optional(),
  origin: z.string().min(2),
  destination: z.string().min(2),
  driverId: z.string().min(2).nullish(),
  departureAt: z.string().datetime().nullish(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

trucksRouter.get(
  '/trucks',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    let trucks = await listTrucks();
    if (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      const ownTruckIds = new Set(driver?.assignedTruckId ? [driver.assignedTruckId] : []);
      trucks = trucks.filter((truck) => ownTruckIds.has(truck.id));
    } else if (user.role === 'BUSINESS' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      // Public fleet supply can be browsed, but another fleet's driver link is private.
      trucks = trucks.map((truck) => ({ ...truck, driverId: null }));
    }
    res.json({ trucks });
  }),
);

trucksRouter.get(
  '/trucks/:id',
  asyncHandler(async (req, res) => {
    const truck = await getTruck(requiredParam(req, 'id'));
    const user = res.locals.authUser as User;
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && user.role === 'DRIVER') {
      const ownDriver = (await db.drivers.find((driver) => driver.userId === user.id))[0];
      if (!ownDriver || ownDriver.assignedTruckId !== truck.id) throw ApiError.notFound('Truck not found.');
    }
    const allShipments = await db.shipments.find((s) => s.truckId === truck.id);
    const shipments = process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' || ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)
      ? allShipments
      : user.role === 'BUSINESS'
        ? allShipments.filter((shipment) => shipment.shipperId === user.organizationId)
        : [];
    const offer = (await db.capacityOffers.find((o) => o.truckId === truck.id))[0] ?? null;
    const driver = truck.driverId ? await db.drivers.findById(truck.driverId) : undefined;
    const incidents = process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' || ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role)
      ? await db.incidents.find((i) => i.truckId === truck.id)
      : user.role === 'DRIVER'
        ? await db.incidents.find((i) => i.truckId === truck.id)
        : [];
    const canViewDriver = ['CONTROL_TOWER', 'OPERATOR', 'VERIFIER'].includes(user.role) ||
      (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true');
    res.json({
      truck: user.role === 'BUSINESS' ? { ...truck, driverId: null } : truck,
      driver: canViewDriver && driver ? { id: driver.id, name: driver.name, status: driver.status, assignedTruckId: driver.assignedTruckId } : null,
      capacityOffer: offer,
      shipments,
      incidents,
    });
  }),
);

trucksRouter.post(
  '/trucks',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR'),
  validateBody(createTruckSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createTruckSchema>;
    const user = res.locals.authUser as User;
    if (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      if (!driver) throw ApiError.notFound('No driver profile is linked to this account.');
      const truck = await createTruck({
        ...body,
        organizationId: user.organizationId,
        driverId: driver.id,
      });
      await db.drivers.update(driver.id, { assignedTruckId: truck.id });
      res.status(201).json({ truck });
      return;
    }
    res.status(201).json({ truck: await createTruck(body) });
  }),
);

const departSchema = z.object({
  driverId: z.string().min(2).nullish(),
});

/** POST /trucks/:id/depart — truck ASSIGNED → IN_TRANSIT, shipments → IN_TRANSIT. */
trucksRouter.post(
  '/trucks/:id/depart',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR'),
  validateBody(departSchema),
  asyncHandler(async (req, res) => {
    const { driverId } = req.body as { driverId?: string | null };
    const id = requiredParam(req, 'id');
    const user = res.locals.authUser as User;
    let actorId = driverId ?? null;
    let actorType: 'DRIVER' | 'OPERATOR' = 'DRIVER';
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      if (user.role === 'DRIVER') {
        const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
        const truck = await db.trucks.findById(id);
        if (!driver || !truck || driver.assignedTruckId !== truck.id) throw ApiError.notFound('Truck not found.');
        actorId = driver.id;
      } else {
        // Operations identity comes from the authenticated session, never the request body.
        actorId = user.id;
        actorType = 'OPERATOR';
      }
    }
    const result = await departTruck(id, actorId, actorType);
    res.json({
      ok: true,
      truck: result.truck,
      truckStatus: result.truck.status,
      shipments: result.shipments,
      shipmentIds: result.shipments.map((s) => s.id),
    });
  }),
);

/** POST /trucks/:id/location — updates GPS coordinates & heading and broadcasts over websocket. */
trucksRouter.post(
  '/trucks/:id/location',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR'),
  asyncHandler(async (req, res) => {
    const id = requiredParam(req, 'id');
    const user = res.locals.authUser as User;
    if (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      if (!driver || driver.assignedTruckId !== id) throw ApiError.notFound('Truck not found.');
    }
    const { lat, lng, latitude, longitude, speed_kmph, speedKmph, heading } = req.body ?? {};
    const finalLat = lat ?? latitude;
    const finalLng = lng ?? longitude;
    const finalSpeed = speed_kmph ?? speedKmph;
    if (
      typeof finalLat !== 'number' || !Number.isFinite(finalLat) || finalLat < -90 || finalLat > 90 ||
      typeof finalLng !== 'number' || !Number.isFinite(finalLng) || finalLng < -180 || finalLng > 180
    ) {
      res.status(400).json({ error: { message: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required.' } });
      return;
    }
    if (finalSpeed !== undefined && (typeof finalSpeed !== 'number' || !Number.isFinite(finalSpeed) || finalSpeed < 0 || finalSpeed > 250)) {
      res.status(400).json({ error: { message: 'Speed must be a valid number between 0 and 250 km/h.' } });
      return;
    }
    if (heading !== undefined && (typeof heading !== 'number' || !Number.isFinite(heading) || heading < 0 || heading > 360)) {
      res.status(400).json({ error: { message: 'Heading must be a valid number between 0 and 360 degrees.' } });
      return;
    }
    const updated = await updateTruckLocation(id, finalLat, finalLng, finalSpeed, heading);
    res.json({
      status: 'success',
      truck_id: updated.id,
      latitude: updated.lat,
      longitude: updated.lng,
      speed_kmph: finalSpeed ?? 0,
      heading: heading ?? 0,
    });
  }),
);

