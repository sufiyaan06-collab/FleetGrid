import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { round } from '../lib/ids.js';
import { capacityOptions, findAvailableCapacity, reserveCapacity, searchCapacity, suggestNearbyCapacity } from '../services/capacity.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { requireRoles } from '../middleware/auth.js';
import { ApiError } from '../lib/errors.js';
import type { User } from '../types.js';

export const capacityRouter: Router = Router();

/** Shippers can browse public capacity, but driver identity remains private. */
function protectCapacityMatch<T extends { truck: { driverId: string | null }; driverName: string | null }>(match: T, user: User): T {
  if (user.role !== 'BUSINESS') return match;
  return { ...match, truck: { ...match.truck, driverId: null }, driverName: null };
}


const capacityQuerySchema = z.object({
  origin: z.string().min(2).optional(),
  destination: z.string().min(2).optional(),
  weightT: z.coerce.number().positive().optional(),
  minAvailableT: z.coerce.number().positive().optional(),
  includeAll: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

/** GET /capacity — compatible open capacity only, unless includeAll=true. */
capacityRouter.get(
  '/capacity',
  requireRoles('BUSINESS', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  validateQuery(capacityQuerySchema),
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const query = res.locals.query as z.infer<typeof capacityQuerySchema>;
    const matches = query.includeAll
      ? await searchCapacity(query)
      : await findAvailableCapacity(query);

    res.json({
      matches: matches.map((match) => protectCapacityMatch(match, user)),
      count: matches.length,
      criteria: {
        origin: query.origin ?? null,
        destination: query.destination ?? null,
        weightT: query.weightT ?? null,
      },
      note: 'All prices, ETAs and distances in this build are demo estimates.',
    });
  }),
);

const reserveSchema = z.object({
  shipmentId: z.string().min(2),
  actorId: z.string().min(2).nullish(),
});

/** POST /capacity/:id/reserve — atomic reservation of an existing DRAFT shipment. */
capacityRouter.post(
  '/capacity/:id/reserve',
  requireRoles('BUSINESS'),
  validateBody(reserveSchema),
  asyncHandler(async (req, res) => {
    const { shipmentId, actorId } = req.body as { shipmentId: string; actorId?: string | null };
    const user = res.locals.authUser as User;
    const shipment = await db.shipments.findById(shipmentId);
    if (!shipment || (process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true' && shipment.shipperId !== user.organizationId)) {
      throw ApiError.notFound('Shipment not found.');
    }
    const result = await reserveCapacity({
      offerId: requiredParam(req, 'id'),
      shipmentId,
      actorType: 'BUSINESS',
      actorId: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? actorId ?? null : user.id,
    });
    res.json({
      ok: true,
      ...result,
      truck: user.role === 'BUSINESS' ? { ...result.truck, driverId: null } : result.truck,
    });
  }),
);

const optionsQuerySchema = z.object({
  origin: z.string().min(2).optional(),
  destination: z.string().min(2).optional(),
  weightT: z.coerce.number().positive().optional(),
});

/**
 * GET /capacity/options — the honest answer for any load.
 *
 * Returns one truck, a split across several, or a plain reason it cannot be done.
 * Registered before `/capacity/:id` so "options" is not read as an offer id.
 */
capacityRouter.get(
  '/capacity/options',
  requireRoles('BUSINESS', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  validateQuery(optionsQuerySchema),
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const query = res.locals.query as z.infer<typeof optionsQuerySchema>;
    const result = await capacityOptions(query);
    res.json({
      ...result,
      single: result.single.map((match) => protectCapacityMatch(match, user)),
      partial: result.partial.map((match) => protectCapacityMatch(match, user)),
      split: result.split ? { ...result.split, legs: result.split.legs.map((leg) => ({ ...leg, truck: { ...leg.truck, driverId: user.role === 'BUSINESS' ? null : leg.truck.driverId } })) } : null,
      note:
        'A split is a plan, not a booking. Each leg is reserved and driver-approved separately, exactly like a single-truck load.',
    });
  }),
);

const nearbyQuerySchema = z.object({
  truckId: z.string().min(2),
  origin: z.string().min(2).optional(),
  destination: z.string().min(2).optional(),
  weightT: z.coerce.number().positive().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

/**
 * GET /capacity/nearby - other trucks worth knowing about, nearest first.
 *
 * Registered before `/capacity/:id` so "nearby" is not swallowed as an offer id.
 * Distances are great-circle over stored coordinates, reported as a proximity hint.
 */
capacityRouter.get(
  '/capacity/nearby',
  requireRoles('BUSINESS', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  validateQuery(nearbyQuerySchema),
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const query = res.locals.query as z.infer<typeof nearbyQuerySchema>;
    const result = await suggestNearbyCapacity(query);
    res.json({
      ...result,
      selected: result.selected ? protectCapacityMatch(result.selected, user) : null,
      suggestions: result.suggestions.map((match) => protectCapacityMatch(match, user)),
      selectedTruck: result.selectedTruck ? { ...result.selectedTruck, driverId: user.role === 'BUSINESS' ? null : result.selectedTruck.driverId } : null,
      count: result.suggestions.length,
      selectedTruckSpareT: result.selectedTruck ? round(result.selectedTruck.availableT) : null,
      note: 'Distance is straight-line from stored coordinates, not a routing provider result.',
    });
  }),
);

capacityRouter.get(
  '/capacity/:id',
  requireRoles('BUSINESS', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  asyncHandler(async (req, res) => {
    const user = res.locals.authUser as User;
    const offer = await db.capacityOffers.findById(requiredParam(req, 'id'));
    if (!offer) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: `Capacity offer ${requiredParam(req, 'id')} does not exist.` } });
      return;
    }
    const truck = await db.trucks.findById(offer.truckId);
    res.json({ offer, truck: truck ? { ...truck, driverId: user.role === 'BUSINESS' ? null : truck.driverId } : null });
  }),
);
