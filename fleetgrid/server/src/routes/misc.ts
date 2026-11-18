import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { TOOL_CATALOG } from '../services/agentTools.js';
import { AGENT_TOOL_CONTRACT } from '../services/agentToolSchema.js';
import type { User } from '../types.js';
import { requireRoles } from '../middleware/auth.js';

export const miscRouter: Router = Router();

/**
 * GET /state — one read-only aggregate of every collection.
 *
 * The web client refetches this after every realtime event, which is how it stays
 * consistent with server authority without ever deriving state locally. It adds
 * no mutation surface, so it does not widen the Master PRD contract.
 */
miscRouter.get(
  '/state',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const snapshot = await db.snapshot();
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') {
      res.json(snapshot);
      return;
    }

    // Operations roles need the network-wide picture. Shippers and drivers receive
    // only their organisation's private records plus the public capacity network.
    if (user.role === 'CONTROL_TOWER' || user.role === 'OPERATOR' || user.role === 'VERIFIER') {
      res.json(snapshot);
      return;
    }

    const ownDrivers = snapshot.drivers.filter((driver) => driver.userId === user.id);
    const ownTruckIds = new Set(ownDrivers.map((driver) => driver.assignedTruckId).filter((id): id is string => Boolean(id)));
    const ownTrucks = snapshot.trucks.filter((truck) => ownTruckIds.has(truck.id));

    const ownShipments = user.role === 'BUSINESS'
      ? snapshot.shipments.filter((shipment) => shipment.shipperId === user.organizationId)
      : snapshot.shipments.filter((shipment) => Boolean(shipment.truckId && ownTruckIds.has(shipment.truckId)));
    const ownShipmentIds = new Set(ownShipments.map((shipment) => shipment.id));
    const ownIncidents = snapshot.incidents.filter((incident) => ownTruckIds.has(incident.truckId));
    const ownIncidentIds = new Set(ownIncidents.map((incident) => incident.id));
    const visibleTruckIds = user.role === 'BUSINESS'
      ? new Set(ownShipments.map((shipment) => shipment.truckId).filter((id): id is string => Boolean(id)))
      : ownTruckIds;

    res.json({
      ...snapshot,
      organizations: snapshot.organizations.filter((organization) => organization.id === user.organizationId),
      users: user.role === 'DRIVER'
        ? snapshot.users.filter((member) => member.id === user.id)
        : snapshot.users.filter((member) => member.organizationId === user.organizationId),
      drivers: ownDrivers,
      trucks: user.role === 'BUSINESS' ? snapshot.trucks : ownTrucks,
      // Capacity availability is shared across the network; shipment/customer data is not.
      capacityOffers: user.role === 'BUSINESS'
        ? snapshot.capacityOffers
        : snapshot.capacityOffers.filter((offer) => ownTruckIds.has(offer.truckId)),
      shipments: ownShipments,
      incidents: ownIncidents,
      recoveryPlans: snapshot.recoveryPlans.filter((plan) => ownIncidentIds.has(plan.incidentId)),
      payments: snapshot.payments.filter((payment) => Boolean(payment.shipmentId && ownShipmentIds.has(payment.shipmentId))),
      events: snapshot.events.filter((event) =>
        Boolean((event.shipmentId && ownShipmentIds.has(event.shipmentId)) || (event.truckId && visibleTruckIds.has(event.truckId))),
      ),
      notifications: snapshot.notifications.filter((notification) => notification.recipientId === user.id),
    });
  }),
);

/**
 * GET /agent/tools — the tool contract the recovery agent must use.
 *
 * Returns the readable catalog plus the formal JSON Schema (draft 2020-12) for
 * every tool's input, output, and failure shape, so an external tool-runner can be
 * pointed straight at this endpoint.
 */
miscRouter.get('/agent/tools', (_req, res) => {
  res.json({
    tools: TOOL_CATALOG,
    contract: AGENT_TOOL_CONTRACT,
    note: 'Mutations are only possible through these validated tools. No unrestricted database access for the agent.',
  });
});

const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(['SHIPPER', 'FLEET_OPERATOR']),
  id: z.string().min(2).max(64).optional(),
});

miscRouter.post(
  '/organizations',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  validateBody(createOrgSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createOrgSchema>;
    const org = {
      id: body.id ?? `org_${body.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: body.name.trim(),
      type: body.type,
      status: 'ACTIVE' as const,
      createdAt: new Date().toISOString(),
    };
    res.status(201).json({ organization: await db.organizations.create(org) });
  }),
);

miscRouter.get(
  '/organizations',
  requireRoles('CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  asyncHandler(async (_req, res) => {
    res.json({ organizations: await db.organizations.get() });
  }),
);

/**
 * GET /payments — placeholder read model.
 * Real payment capture (Dodo) is a later phase; nothing here reports a fake success.
 */
miscRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const allPayments = await db.payments.get();
    const shipments = await db.shipments.get();
    const ownShipmentIds = new Set(shipments.filter((shipment) => shipment.shipperId === user.organizationId).map((shipment) => shipment.id));
    const payments = user.role === 'CONTROL_TOWER' || user.role === 'OPERATOR' || user.role === 'VERIFIER'
      ? allPayments
      : user.role === 'BUSINESS'
        ? allPayments.filter((payment) => Boolean(payment.shipmentId && ownShipmentIds.has(payment.shipmentId)))
        : [];
    res.json({
      payments,
      note: 'Payment provider integration is a later phase. Seeded rows are labelled DEMO_PLACEHOLDER.',
    });
  }),
);

miscRouter.get(
  '/notifications',
  asyncHandler(async (_req, res) => {
    const user = res.locals.authUser as User;
    const notifications = user.role === 'CONTROL_TOWER' || user.role === 'OPERATOR' || user.role === 'VERIFIER'
      ? await db.notifications.get()
      : await db.notifications.find((notification) => notification.recipientId === user.id);
    res.json({
      notifications,
      note: 'Notification delivery is a later phase; rows are stored as PENDING.',
    });
  }),
);
