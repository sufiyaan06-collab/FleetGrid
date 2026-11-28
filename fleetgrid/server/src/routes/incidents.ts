import { Router } from 'express';
import { z } from 'zod';
import { confirmVehicleRepair, createIncident, getIncident, listIncidents } from '../services/incidents.js';
import { createRecoveryPlan } from '../services/recovery.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { requireRoles } from '../middleware/auth.js';
import { db } from '../store/db.js';
import { hub } from '../services/realtime.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso } from '../lib/ids.js';
import type { User } from '../types.js';

export const incidentsRouter: Router = Router();

async function assertDriverOwnsTruck(user: User, truckId: string): Promise<void> {
  if (user.role !== 'DRIVER' || process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') return;
  const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
  if (!driver || driver.assignedTruckId !== truckId) throw ApiError.notFound('Truck not found.');
}

const INCIDENT_TYPES = [
  'TRUCK_BREAKDOWN',
  'ACCIDENT',
  'DELAY',
  'CARGO_DAMAGE',
  'ROUTE_BLOCKED',
  'OTHER',
] as const;

const createIncidentSchema = z.object({
  truckId: z.string().min(2),
  type: z.enum(INCIDENT_TYPES).default('TRUCK_BREAKDOWN'),
  location: z.string().min(2).max(120),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  description: z.string().max(600).optional(),
  transcript: z.string().max(2000).nullish(),
  source: z.enum(['DRIVER_APP', 'VOICE', 'OPERATOR', 'SYSTEM']).optional(),
  actorId: z.string().min(2).nullish(),
});

/**
 * POST /incidents
 * truck IN_TRANSIT → INCIDENT, shipments IN_TRANSIT → AT_RISK, incident OPEN.
 */
incidentsRouter.post(
  '/incidents',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR'),
  validateBody(createIncidentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createIncidentSchema>;
    const user = res.locals.authUser as User;
    await assertDriverOwnsTruck(user, body.truckId);
    const result = await createIncident({
      truckId: body.truckId,
      type: body.type,
      location: body.location,
      severity: body.severity,
      description: body.description,
      transcript: body.transcript ?? null,
      source: user.role === 'DRIVER' ? 'DRIVER_APP' : body.source,
      actorId: process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? body.actorId ?? null : user.id,
    });
    // Notify the operations desk and affected shippers in-app as soon as the incident
    // is persisted. This is an internal alert, not an external roadside dispatch.
    const operationsUsers = await db.users.find((member) => ['CONTROL_TOWER', 'OPERATOR'].includes(member.role));
    for (const member of operationsUsers) {
      const notice = await db.notifications.create({
        id: newId('ntf'),
        recipientId: member.id,
        type: 'EMERGENCY_INCIDENT',
        message: `Emergency ${body.type.replace(/_/g, ' ').toLowerCase()} reported for ${body.truckId} at ${result.incident.location}. Severity: ${result.incident.severity ?? 'unknown'}. Immediate review required.`,
        status: 'PENDING',
        createdAt: nowIso(),
      });
      hub.broadcast('notification.created', notice);
    }
    for (const shipment of result.affectedShipments) {
      const shipperUsers = await db.users.find((member) => member.organizationId === shipment.shipperId && member.role === 'BUSINESS');
      for (const member of shipperUsers) {
        const notice = await db.notifications.create({
          id: newId('ntf'),
          recipientId: member.id,
          type: 'SHIPMENT_AT_RISK',
          message: `Shipment ${shipment.id} is at risk after a vehicle incident near ${result.incident.location}. FleetGrid is coordinating assistance and recovery options.`,
          status: 'PENDING',
          createdAt: new Date().toISOString(),
        });
        hub.broadcast('notification.created', notice);
      }
    }

    // Breakdown and accident alerts immediately prepare a recovery proposal for the
    // Control Tower. The proposal is NOT executed automatically: operator approval
    // and replacement-driver acceptance are still mandatory before cargo can move.
    let recovery: Awaited<ReturnType<typeof createRecoveryPlan>> | null = null;
    let recoveryError: string | null = null;
    if (['TRUCK_BREAKDOWN', 'ACCIDENT'].includes(body.type) && result.affectedShipments.length > 0) {
      try {
        recovery = await createRecoveryPlan(result.incident.id);
      } catch (error) {
        recoveryError = (error as Error).message;
        console.error('[fleetgrid] emergency recovery analysis could not be prepared:', recoveryError);
      }
    }
    res.status(201).json({
      ok: true,
      incident: result.incident,
      truck: result.truck,
      affectedShipments: result.affectedShipments,
      recoveryPlan: recovery?.plan ?? null,
      recoveryOptions: recovery?.options ?? [],
      recoveryError,
    });
  }),
);

const listQuerySchema = z.object({
  status: z.string().optional(),
  truckId: z.string().optional(),
});

incidentsRouter.get(
  '/incidents',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  validateQuery(listQuerySchema),
  asyncHandler(async (_req, res) => {
    const query = res.locals.query as z.infer<typeof listQuerySchema>;
    const user = res.locals.authUser as User;
    let incidents = await listIncidents(query);
    if (user.role === 'DRIVER' && process.env.FLEETGRID_TEST_BYPASS_AUTH !== 'true') {
      const driver = (await db.drivers.find((item) => item.userId === user.id))[0];
      incidents = driver?.assignedTruckId
        ? incidents.filter((incident) => incident.truckId === driver.assignedTruckId)
        : [];
    }
    res.json({ incidents, count: incidents.length });
  }),
);

incidentsRouter.post(
  '/incidents/:id/repair-confirmed',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  asyncHandler(async (req, res) => {
    const user = res.locals.authUser as User;
    const result = await confirmVehicleRepair(requiredParam(req, 'id'), user.id);
    res.json({ ok: true, ...result });
  }),
);

incidentsRouter.get(
  '/incidents/:id',
  requireRoles('DRIVER', 'CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  asyncHandler(async (req, res) => {
    const incident = await getIncident(requiredParam(req, 'id'));
    await assertDriverOwnsTruck(res.locals.authUser as User, incident.truckId);
    res.json({ incident });
  }),
);
