import { Router } from 'express';
import { z } from 'zod';
import { driverOffers } from '../services/shipments.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateQuery } from '../middleware/validate.js';
import { requireRoles } from '../middleware/auth.js';
import { db } from '../store/db.js';
import type { User } from '../types.js';

export const driverRouter: Router = Router();

const driverQuerySchema = z.object({
  driverId: z.string().min(2),
});

/**
 * GET /driver/offers - the approval queue.
 *
 * A read model over existing rows, not a new entity. `pending` is exactly the set of
 * shipments sitting in CAPACITY_RESERVED on the driver's own truck, which is the same
 * condition `POST /shipments/:id/confirm` and `/decline` accept, so what the driver
 * sees and what the state machine allows can never drift apart.
 */
driverRouter.get(
  '/driver/offers',
  requireRoles('DRIVER'),
  validateQuery(driverQuerySchema),
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const ownDrivers = await db.drivers.find((driver) => driver.userId === user.id);
    const driver = ownDrivers[0];
    if (!driver) {
      res.json({ driver: null, truck: null, pending: [], accepted: [], counts: { pending: 0, accepted: 0 }, note: 'No driver profile is linked to this account yet.' });
      return;
    }
    const result = await driverOffers(driver.id);
    res.json({
      ...result,
      counts: { pending: result.pending.length, accepted: result.accepted.length },
      note:
        'Accepting runs CAPACITY_RESERVED -> CONFIRMED. Declining releases the tonnage and returns the shipment to DRAFT.',
    });
  }),
);
