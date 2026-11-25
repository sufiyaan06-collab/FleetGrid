import { db } from '../store/db.js';
import { isProductionEnvironment } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { newId, nowIso, round } from '../lib/ids.js';
import { runExclusive } from '../lib/mutex.js';
import { recordEvent } from './events.js';
import { hub } from './realtime.js';
import { getIncident, setIncidentStatus } from './incidents.js';
import { getShipment, releaseCapacity, setShipmentStatus } from './shipments.js';
import { transitionTruck } from './trucks.js';
import { segmentFit } from '../lib/geo.js';
import { RECOVERY_PLAN_TRANSITIONS, type RecoveryOption, type RecoveryPlan, type Truck } from '../types.js';

/**
 * Deterministic demo estimates (Master PRD §17).
 *
 * These are seeded demo numbers, NOT routing-provider output. Anything not listed
 * falls back to a haversine estimate with a road factor, and the UI labels every
 * distance/ETA as a demo estimate.
 */
const DEMO_LEG_ESTIMATES: Record<string, { distanceKm: number; etaMinutes: number }> = {
  'FG-041': { distanceKm: 8.2, etaMinutes: 17 },
  'FG-052': { distanceKm: 15.8, etaMinutes: 26 },
};

const DEMO_SPEED_KMH = 32;
const ROAD_FACTOR = 1.35;
const RECOVERY_COST_MULTIPLIER = 1.25;
const CARGO_TRANSFER_MINUTES = 25;
const UNASSIGNED_RECOVERY_TRUCKS = ['FG-041', 'FG-052'];

export interface ImpactSummary {
  incidentId: string;
  truckId: string;
  location: string;
  affectedShipments: Array<{
    id: string;
    cargoName: string;
    weightT: number;
    status: string;
    origin: string;
    destination: string;
    deadlineAt: string | null;
    shipperId: string;
  }>;
  totalWeightT: number;
  origin: string;
  destination: string;
  notes: string[];
}

export async function calculateImpact(incidentId: string): Promise<ImpactSummary> {
  const incident = await getIncident(incidentId);
  const truck = await db.trucks.findById(incident.truckId);
  if (!truck) throw ApiError.notFound(`Truck ${incident.truckId} does not exist.`);
  const origin = truck.origin;
  const destination = truck.destination;
  if (!origin?.trim() || !destination?.trim()) {
    throw ApiError.conflict('Recovery planning requires a recorded origin and destination for the affected truck.');
  }

  if (!incident.affectedShipmentIds?.length) {
    throw ApiError.conflict('This legacy incident has no verified affected-shipment list. Review its shipment links before generating a recovery plan.');
  }
  const shipments = await db.shipments.find((s) => incident.affectedShipmentIds!.includes(s.id));
  const totalWeightT = round(shipments.reduce((sum, s) => sum + s.weightT, 0));

  return {
    incidentId: incident.id,
    truckId: truck.id,
    location: incident.location,
    origin,
    destination,
    totalWeightT,
    affectedShipments: shipments.map((s) => ({
      id: s.id,
      cargoName: s.cargoName ?? 'Cargo description not recorded',
      weightT: s.weightT,
      status: s.status,
      origin: s.origin,
      destination: s.destination,
      shipperId: s.shipperId,
      deadlineAt: s.deadlineAt,
    })),
    notes: [
      `Truck ${truck.id} is blocked at ${incident.location} (${(incident.severity ?? 'unknown').toLowerCase()} severity).`,
      `${shipments.length} shipment(s) carrying ${totalWeightT}T are now AT_RISK.`,
      'Distances and ETAs below are demo estimates unless a routing provider is integrated.',
    ],
  };
}

function pointForTruck(truck: Truck): { lat: number; lng: number } | null {
  const { lat, lng } = truck;
  if (lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function estimateLeg(
  truckId: string,
  from: { lat: number; lng: number } | null,
  to: { lat: number; lng: number } | null,
): { distanceKm: number; etaMinutes: number } | null {
  const seeded = DEMO_LEG_ESTIMATES[truckId];
  if (seeded && UNASSIGNED_RECOVERY_TRUCKS.includes(truckId)) return seeded;
  if (!from || !to) return null;

  const distanceKm = round(haversineKm(from, to) * ROAD_FACTOR, 1);
  return { distanceKm, etaMinutes: Math.max(5, Math.round((distanceKm / DEMO_SPEED_KMH) * 60)) };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const UNAVAILABLE_RECOVERY_STATES = new Set(['DELIVERED', 'RECOVERY', 'INCIDENT']);

/** Deterministic candidate generation, identical to the eventual agent's read tools. */
export async function findRecoveryOptions(incidentId: string): Promise<{
  impact: ImpactSummary;
  options: RecoveryOption[];
}> {
  const impact = await calculateImpact(incidentId);
  const incident = await getIncident(incidentId);
  const blockedTruck = await db.trucks.findById(impact.truckId);
  if (!blockedTruck) throw ApiError.notFound(`Truck ${impact.truckId} does not exist.`);

  const [trucks, offers, drivers, users, organizations, authAccounts] = await Promise.all([
    db.trucks.get(),
    db.capacityOffers.get(),
    db.drivers.get(),
    db.users.get(),
    db.organizations.get(),
    db.authAccounts.get(),
  ]);
  const production = isProductionEnvironment();

  const incidentPoint = pointForTruck(blockedTruck);

  const options: RecoveryOption[] = trucks
    .flatMap((truck) => {
      if (truck.id === blockedTruck.id) return [];
      const offer = offers.find((candidate) => candidate.truckId === truck.id);
      const truckPoint = pointForTruck(truck);
      const leg = estimateLeg(truck.id, incidentPoint, truckPoint);
      if (!leg) return [];

      const pricePerT = offer && offer.pricePerT !== null && Number.isFinite(offer.pricePerT) && offer.pricePerT > 0
        ? offer.pricePerT
        : null;
      const cost = pricePerT === null ? null : Math.round(impact.totalWeightT * pricePerT * RECOVERY_COST_MULTIPLIER);
      const blockers: string[] = [];
      const driver = truck.driverId ? drivers.find((d) => d.id === truck.driverId) : undefined;
      if (!driver) {
        blockers.push('no registered driver is assigned to this vehicle');
      } else {
        if (driver.assignedTruckId !== truck.id) blockers.push('driver assignment does not match this vehicle');
        if (!['AVAILABLE', 'ON_JOURNEY'].includes(driver.status)) blockers.push(`driver is ${driver.status.toLowerCase().replace('_', ' ')}`);
        const driverUser = users.find((u) => u.id === driver.userId && u.role === 'DRIVER' && u.organizationId === truck.organizationId);
        if (!driverUser || driver.organizationId !== truck.organizationId) blockers.push('driver account or fleet ownership is invalid');
        const operator = organizations.find((o) => o.id === truck.organizationId && o.type === 'FLEET_OPERATOR' && o.status === 'ACTIVE');
        if (!operator) blockers.push('fleet operator is not active');
        if (production && !authAccounts.some((a) => a.id === driver.userId && Boolean(a.emailVerifiedAt))) blockers.push('driver email is not verified');
      }
      if (!['AVAILABLE', 'ASSIGNED', 'IN_TRANSIT'].includes(truck.status)) blockers.push(`truck is ${truck.status.toLowerCase().replace('_', ' ')}`);
      if (offer?.status === 'CLOSED') blockers.push('capacity offer is closed');
      if (truck.availableT < impact.totalWeightT) {
        blockers.push(`insufficient spare capacity (${round(truck.availableT)}T < ${impact.totalWeightT}T)`);
      }
      const coversAffectedRoutes = impact.affectedShipments.every((shipment) => {
        const fit = segmentFit(truck.origin, truck.destination, shipment.origin, shipment.destination);
        return fit === 'EXACT' || fit === 'PARTIAL';
      });
      if (!coversAffectedRoutes) {
        blockers.push('route does not cover every affected shipment in the same direction');
      }
      if (UNAVAILABLE_RECOVERY_STATES.has(truck.status)) {
        blockers.push(`truck is ${truck.status}`);
      }

      const facts = [
        `${round(truck.availableT)}T spare`,
        `${leg.distanceKm} km away`,
        `${leg.etaMinutes} min estimated arrival`,
        driver ? `driver ${driver.name}` : 'no driver assigned',
      ];

      return [{
        truckId: truck.id,
        availableT: round(truck.availableT),
        etaMinutes: leg.etaMinutes,
        distanceKm: leg.distanceKm,
        cost,
        currency: 'INR',
        compatible: blockers.length === 0,
        reason: blockers.length === 0 ? `Compatible: ${facts.join(', ')}` : `Rejected: ${blockers.join('; ')}`,
      } satisfies RecoveryOption];
    })
    .sort((a, b) => {
      if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
      if (a.etaMinutes !== b.etaMinutes) return a.etaMinutes - b.etaMinutes;
      return a.cost - b.cost;
    });
  void incident;
  return { impact, options };
}

export async function listRecoveryPlans(filter?: { incidentId?: string }): Promise<RecoveryPlan[]> {
  return db.recoveryPlans.find((p) => (filter?.incidentId ? p.incidentId === filter.incidentId : true));
}

export async function getRecoveryPlan(id: string): Promise<RecoveryPlan> {
  const plan = await db.recoveryPlans.findById(id);
  if (!plan) throw ApiError.notFound(`Recovery plan ${id} does not exist.`);
  return plan;
}

export interface CreatePlanResult {
  plan: RecoveryPlan;
  incident: Awaited<ReturnType<typeof getIncident>>;
  options: RecoveryOption[];
  created: boolean;
}

/**
 * create_recovery_plan — deterministic, no LLM.
 *
 * The incident moves OPEN -> ANALYZING -> PLAN_READY and the plan is created in
 * PENDING_APPROVAL. Nothing is reassigned until an operator approves and executes.
 */
export async function createRecoveryPlan(incidentId: string): Promise<CreatePlanResult> {
  return runExclusive(async () => {
    const incident = await getIncident(incidentId);
    const { impact, options } = await findRecoveryOptions(incidentId);

    const existing = await db.recoveryPlans.find((p) => p.incidentId === incidentId);
    if (existing.length > 0) {
      const plan = existing[0] as RecoveryPlan;
      return { plan, incident, options: plan.options ?? [], created: false };
    }

    if (incident.status === 'OPEN') {
      await setIncidentStatus(incident, 'ANALYZING', { reason: 'Recovery analysis started' });
    }
    const analyzing = incident.status === 'OPEN' ? { ...incident, status: 'ANALYZING' as const } : incident;
    if (analyzing.status === 'ANALYZING') {
      await setIncidentStatus(analyzing, 'PLAN_READY', { reason: 'Deterministic options generated' });
    }

    const compatible = options.filter((o) => o.compatible);
    const selected = compatible[0] ?? null;

    const plan: RecoveryPlan = {
      id: newId('RCP'),
      incidentId,
      affectedShipmentIds: impact.affectedShipments.map((s) => s.id),
      options,
      selectedTruckId: selected?.truckId ?? null,
      cost: selected?.cost ?? null,
      etaDeltaMinutes: selected ? selected.etaMinutes + CARGO_TRANSFER_MINUTES : 0,
      status: 'PENDING_APPROVAL',
      approvedBy: null,
      approvedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    const saved = await db.recoveryPlans.create(plan);
    await db.incidents.update(incidentId, { recoveryPlanId: saved.id, updatedAt: nowIso() });
    await recordEvent({
      eventType: 'recovery.plan_proposed',
      incidentId,
      truckId: impact.truckId,
      payload: {
        planId: saved.id,
        candidateCount: compatible.length,
        rejectedCount: options.length - compatible.length,
        selectedTruckId: saved.selectedTruckId,
        cost: saved.cost,
        etaDeltaMinutes: saved.etaDeltaMinutes,
        engine: 'DETERMINISTIC_PLACEHOLDER',
        note: 'LLM reasoning is a later phase. Options are generated deterministically from backend state.',
      },
      actorType: 'AGENT',
    });
    hub.broadcast('recovery.updated', saved);
    return { plan: saved, incident, options, created: true };
  });
}

export async function approveRecoveryPlan(planId: string, approvedBy: string): Promise<RecoveryPlan> {
  return runExclusive(async () => {
    const plan = await getRecoveryPlan(planId);
    if (plan.status === 'APPROVED' || plan.status === 'EXECUTING' || plan.status === 'COMPLETED') {
      return plan;
    }
    if (plan.status !== 'PENDING_APPROVAL') {
      throw ApiError.conflict(
        `Recovery plan ${planId} is ${plan.status}. Only a PENDING_APPROVAL plan can be approved.`,
        { status: plan.status },
      );
    }
    const updated = await db.recoveryPlans.update(planId, {
      status: 'APPROVED',
      approvedBy,
      approvedAt: nowIso(),
      driverAcceptedBy: null,
      driverAcceptedAt: null,
      updatedAt: nowIso(),
    });
    if (!updated) throw ApiError.notFound(`Recovery plan ${planId} disappeared during approval.`);
    const incident = await getIncident(updated.incidentId);
    const affectedTruck = await db.trucks.findById(incident.truckId);
    const replacementTruck = updated.selectedTruckId ? await db.trucks.findById(updated.selectedTruckId) : undefined;
    const replacementDriver = replacementTruck?.driverId ? await db.drivers.findById(replacementTruck.driverId) : undefined;
    if (replacementDriver) {
      const notice = await db.notifications.create({
        id: newId('ntf'), recipientId: replacementDriver.userId, type: 'RECOVERY_ASSISTANCE_REQUEST',
        message: `Emergency assistance requested: collect shipment ${(updated.affectedShipmentIds ?? []).join(', ')} from ${affectedTruck?.id ?? 'the affected vehicle'} at ${incident.location}. Review and accept this recovery request in FleetGrid.`,
        status: 'PENDING', createdAt: nowIso(),
      });
      hub.broadcast('notification.created', notice);
    }
    const strandedDriver = affectedTruck?.driverId ? await db.drivers.findById(affectedTruck.driverId) : undefined;
    if (strandedDriver) {
      const notice = await db.notifications.create({
        id: newId('ntf'), recipientId: strandedDriver.userId, type: 'RECOVERY_CANDIDATE_FOUND',
        message: `A replacement vehicle has been identified for your shipment. Waiting for its driver to accept the handover.`,
        status: 'PENDING', createdAt: nowIso(),
      });
      hub.broadcast('notification.created', notice);
    }
    await recordEvent({
      eventType: 'recovery.approved',
      incidentId: updated.incidentId,
      payload: { planId: updated.id, approvedBy },
      actorType: 'OPERATOR',
      actorId: approvedBy,
    });
    hub.broadcast('recovery.updated', updated);
    return updated;
  });
}

export async function rejectRecoveryPlan(planId: string, rejectedBy: string, reason: string): Promise<RecoveryPlan> {
  return runExclusive(async () => {
    const plan = await getRecoveryPlan(planId);
    const updated = await db.recoveryPlans.update(planId, {
      status: 'REJECTED',
      approvedBy: rejectedBy,
      updatedAt: nowIso(),
    });
    if (!updated) throw ApiError.notFound(`Recovery plan ${planId} disappeared.`);
    void RECOVERY_PLAN_TRANSITIONS[plan.status];
    await recordEvent({
      eventType: 'recovery.rejected',
      incidentId: updated.incidentId,
      payload: { planId: updated.id, rejectedBy, reason },
      actorType: 'OPERATOR',
      actorId: rejectedBy,
    });
    hub.broadcast('recovery.updated', updated);
    return updated;
  });
}

/** Replacement driver acceptance is tied to the authenticated driver's own assigned truck. */
export async function acceptRecoveryPlan(planId: string, userId: string): Promise<RecoveryPlan> {
  return runExclusive(async () => {
    const plan = await getRecoveryPlan(planId);
    if (plan.status !== 'APPROVED') {
      throw ApiError.conflict('This recovery request is not awaiting driver acceptance.', { status: plan.status });
    }
    if (!plan.selectedTruckId) throw ApiError.conflict('No replacement vehicle has been selected for this recovery request.');
    const driver = (await db.drivers.find((item) => item.userId === userId))[0];
    if (!driver || driver.assignedTruckId === null) throw new ApiError(403, 'FORBIDDEN', 'No assigned driver vehicle is linked to this account.');
    const truck = await db.trucks.findById(plan.selectedTruckId);
    if (!truck || truck.driverId !== driver.id || driver.assignedTruckId !== truck.id) {
      throw new ApiError(403, 'FORBIDDEN', 'This recovery request is assigned to a different driver and vehicle.');
    }
    if (plan.driverAcceptedAt && plan.driverAcceptedBy === driver.id) return plan;
    if (plan.driverAcceptedAt) throw ApiError.conflict('Another driver has already accepted this recovery request.');
    const updated = await db.recoveryPlans.update(planId, {
      driverAcceptedBy: driver.id,
      driverAcceptedAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (!updated) throw ApiError.notFound(`Recovery plan ${planId} disappeared during acceptance.`);
    const incident = await getIncident(plan.incidentId);
    const affectedTruck = await db.trucks.findById(incident.truckId);
    const strandedDriver = affectedTruck?.driverId ? await db.drivers.findById(affectedTruck.driverId) : undefined;
    if (strandedDriver) {
      const notice = await db.notifications.create({
        id: newId('ntf'), recipientId: strandedDriver.userId, type: 'RECOVERY_DRIVER_ACCEPTED',
        message: `The driver of replacement vehicle ${truck.id} has accepted the shipment handover. Coordinate the cargo transfer at ${incident.location}.`,
        status: 'PENDING', createdAt: nowIso(),
      });
      hub.broadcast('notification.created', notice);
    }
    await recordEvent({ eventType: 'recovery.driver_accepted', incidentId: incident.id, truckId: truck.id, payload: { planId, replacementDriverId: driver.id, replacementTruckId: truck.id }, actorType: 'DRIVER', actorId: userId });
    hub.broadcast('recovery.updated', updated);
    return updated;
  });
}

export interface ExecuteResult {
  plan: RecoveryPlan;
  reassignments: Array<{
    shipmentId: string;
    fromTruckId: string | null;
    toTruckId: string;
    releasedT: number;
  }>;
  verification: {
    shipmentStatus: string;
    fromTruckStatus: string;
    toTruckStatus: string;
    toTruckAvailableT: number;
    incidentStatus: string;
  };
  notifications: string[];
  alreadyExecuted: boolean;
}

/**
 * execute_recovery — the only path that moves cargo, and only for an APPROVED plan.
 * Idempotent: re-running a COMPLETED plan returns the recorded result.
 */
export async function executeRecoveryPlan(planId: string, executedBy: string): Promise<ExecuteResult> {
  return runExclusive(async () => {
    const plan = await getRecoveryPlan(planId);

    const state = await readPlanState(plan);
    if (plan.status === 'COMPLETED') {
      return { ...state, alreadyExecuted: true };
    }
    if (plan.status !== 'APPROVED' && plan.status !== 'EXECUTING') {
      throw ApiError.conflict(
        `Recovery plan ${planId} is ${plan.status}. Execution requires an APPROVED plan — the approval gate cannot be bypassed.`,
        { status: plan.status, required: ['APPROVED'] },
      );
    }
    if (!plan.selectedTruckId) {
      throw ApiError.conflict(`Recovery plan ${planId} has no selected replacement truck, so it cannot execute.`);
    }
    if (!plan.driverAcceptedAt || !plan.driverAcceptedBy) {
      throw ApiError.conflict('The replacement driver must accept the recovery request before shipment handover can execute.', { required: 'DRIVER_ACCEPTANCE' });
    }

    if (
      !plan.affectedShipmentIds?.length ||
      plan.etaDeltaMinutes === null ||
      !plan.options?.length
    ) {
      throw ApiError.conflict('This recovery plan has incomplete legacy shipment, option, cost, or ETA data and cannot be executed. Generate a fresh reviewed plan first.');
    }
    await db.recoveryPlans.update(planId, { status: 'EXECUTING', updatedAt: nowIso() });

    const incident = await getIncident(plan.incidentId);
    const originalTruck = await db.trucks.findById(incident.truckId);
    const targetTruck = await db.trucks.findById(plan.selectedTruckId);
    if (!originalTruck) throw ApiError.notFound(`Truck ${incident.truckId} does not exist.`);
    if (!targetTruck) throw ApiError.notFound(`Replacement truck ${plan.selectedTruckId} does not exist.`);
    if (!targetTruck.driverId || targetTruck.driverId !== plan.driverAcceptedBy) {
      throw ApiError.conflict('The accepting driver is no longer assigned to the selected replacement vehicle. Re-analyze recovery before proceeding.');
    }

    const reassignments: ExecuteResult['reassignments'] = [];
    let targetAvailableT = targetTruck.availableT;

    for (const shipmentId of (plan.affectedShipmentIds ?? [])) {
      const shipment = await db.shipments.findById(shipmentId);
      if (!shipment) continue;
      if (shipment.truckId === targetTruck.id) {
        reassignments.push({ shipmentId, fromTruckId: shipment.truckId, toTruckId: targetTruck.id, releasedT: 0 });
        continue;
      }

      const release = await releaseCapacity(shipment, `Recovery plan ${planId} approved by ${executedBy}`);

      if (targetAvailableT < shipment.weightT) {
        throw ApiError.unprocessable(
          `Replacement truck ${targetTruck.id} now has only ${round(targetAvailableT)}T spare, which cannot take ${shipment.weightT}T.`,
        );
      }
      targetAvailableT = round(targetAvailableT - shipment.weightT);

      const decremented = await db.trucks.update(targetTruck.id, {
        availableT: targetAvailableT,
        status: targetTruck.status === 'AVAILABLE' ? 'ASSIGNED' : targetTruck.status,
      });
      if (!decremented) throw ApiError.notFound(`Truck ${targetTruck.id} disappeared during recovery.`);
      hub.broadcast('truck.updated', decremented);
      const offers = await db.capacityOffers.find((o) => o.truckId === targetTruck.id);
      const offer = offers[0];
      if (offer) {
        const nextAvailable = round(decremented.availableT);
        const updatedOffer = await db.capacityOffers.update(offer.id, {
          availableT: nextAvailable,
          status: nextAvailable > 0 ? 'OPEN' : 'HELD',
          updatedAt: nowIso(),
        });
        if (updatedOffer) hub.broadcast('capacity.updated', updatedOffer);
      }

      const reassigned = await db.shipments.update(shipment.id, {
        truckId: targetTruck.id,
        updatedAt: nowIso(),
      });
      if (!reassigned) throw ApiError.notFound(`Shipment ${shipment.id} disappeared during recovery.`);

      if (reassigned.status === 'AT_RISK') {
        await setShipmentStatus(reassigned, 'RECOVERY', {
          planId: plan.id,
          toTruckId: targetTruck.id,
        }, 'AGENT');
      }
      const recoveryState = await db.shipments.findById(shipment.id);
      if (recoveryState && recoveryState.status === 'RECOVERY') {
        await setShipmentStatus(
          recoveryState,
          'IN_TRANSIT',
          { planId: plan.id, toTruckId: targetTruck.id, cargoTransferMinutes: CARGO_TRANSFER_MINUTES },
          'AGENT',
        );
      }

      await recordEvent({
        eventType: 'cargo.handoff',
        shipmentId: shipment.id,
        truckId: targetTruck.id,
        payload: {
          planId: plan.id,
          fromTruckId: originalTruck.id,
          toTruckId: targetTruck.id,
          releasedT: release.releasedT,
          recoveredTruckAvailableT: release.truck.availableT,
          note: 'Demo cargo handoff. No physical proof captured in this phase.',
        },
        actorType: 'AGENT',
      });

      reassignments.push({
        shipmentId: shipment.id,
        fromTruckId: release.truck.id,
        toTruckId: targetTruck.id,
        releasedT: release.releasedT,
      });
    }

    const replacementAfterHandoff = await db.trucks.findById(targetTruck.id);
    if (replacementAfterHandoff?.status === 'ASSIGNED') {
      await transitionTruck(replacementAfterHandoff, 'IN_TRANSIT', {}, {
        eventType: 'truck.recovery_departure',
        payload: { planId: plan.id, incidentId: incident.id, acceptedBy: plan.driverAcceptedBy },
      });
    }
    const replacementDriverProfile = targetTruck.driverId ? await db.drivers.findById(targetTruck.driverId) : undefined;
    if (replacementDriverProfile?.status === 'AVAILABLE') {
      await db.drivers.update(replacementDriverProfile.id, { status: 'ON_JOURNEY' });
      hub.broadcast('driver.updated', await db.drivers.findById(replacementDriverProfile.id));
    }

    if (originalTruck.status === 'INCIDENT') {
      await transitionTruck(originalTruck, 'RECOVERY', {}, {
        eventType: 'truck.recovery',
        payload: { planId: plan.id },
      });
    }

    const currentIncident = await db.incidents.findById(incident.id);
    if (currentIncident && currentIncident.status !== 'RESOLVED') {
      const toPlanReady: Record<string, 'ANALYZING' | 'PLAN_READY'> = {
        OPEN: 'ANALYZING',
        ANALYZING: 'PLAN_READY',
        ESCALATED: 'ANALYZING',
      };
      const next = toPlanReady[currentIncident.status];
      if (next) {
        const moved = await setIncidentStatus(currentIncident, next, { planId: plan.id });
        await setIncidentStatus(moved, 'PLAN_READY', { planId: plan.id });
      }
      // Keep the incident in PLAN_READY after cargo recovery: the shipment is safe,
      // but the original vehicle remains disabled until an operator confirms repair.
    }

    const notificationIds: string[] = [];
    const targetDriver = targetTruck.driverId ? await db.drivers.findById(targetTruck.driverId) : undefined;
    if (targetDriver) {
      const row = await db.notifications.create({
        id: newId('ntf'),
        recipientId: targetDriver.userId,
        type: 'RECOVERY_INSTRUCTION',
        message: `Collect ${(plan.affectedShipmentIds ?? []).join(', ')} from ${originalTruck.id} at ${incident.location} and continue to ${targetTruck.destination ?? 'the recorded destination'}.`,
        status: 'PENDING',
        createdAt: nowIso(),
      });
      notificationIds.push(row.id);
    }
    for (const shipmentId of (plan.affectedShipmentIds ?? [])) {
      const shipment = await db.shipments.findById(shipmentId);
      if (!shipment) continue;
      const shipperUsers = await db.users.find((user) => user.organizationId === shipment.shipperId && user.role === 'BUSINESS');
      for (const shipperUser of shipperUsers) {
        const row = await db.notifications.create({
          id: newId('ntf'),
          recipientId: shipperUser.id,
          type: 'SHIPMENT_RECOVERED',
          message: `Shipment ${shipment.id} (${shipment.cargoName}) is being moved by ${targetTruck.id} after a breakdown near ${incident.location}. Revised ETA impact: +${plan.etaDeltaMinutes} min (demo estimate).`,
          status: 'PENDING',
          createdAt: nowIso(),
        });
        notificationIds.push(row.id);
        hub.broadcast('notification.created', row);
      }
    }

    const completed = await db.recoveryPlans.update(planId, {
      status: 'COMPLETED',
      updatedAt: nowIso(),
    });
    if (!completed) throw ApiError.notFound(`Recovery plan ${planId} disappeared during execution.`);

    // The original vehicle is still mechanically disabled. Keep it in RECOVERY
    // until an operator explicitly confirms repair; transferring the shipment must
    // never falsely mark a broken-down truck as roadworthy.
    const strandedDriver = originalTruck.driverId ? await db.drivers.findById(originalTruck.driverId) : undefined;
    if (strandedDriver && strandedDriver.status === 'ON_JOURNEY') {
      await db.drivers.update(strandedDriver.id, { status: 'INCIDENT_REPORTED' });
      hub.broadcast('driver.updated', await db.drivers.findById(strandedDriver.id));
    }

    await recordEvent({
      eventType: 'recovery.completed',
      incidentId: incident.id,
      payload: {
        planId: plan.id,
        reassignments,
        toTruckId: targetTruck.id,
        notificationCount: notificationIds.length,
      },
      actorType: 'AGENT',
      actorId: executedBy,
    });
    hub.broadcast('recovery.updated', completed);

    const verified = await readPlanState(completed);
    return { ...verified, alreadyExecuted: false };
  });
}

async function readPlanState(plan: RecoveryPlan): Promise<Omit<ExecuteResult, 'alreadyExecuted'>> {
  const incident = await db.incidents.findById(plan.incidentId);
  const affectedShipmentIds = plan.affectedShipmentIds ?? [];
  const shipment = affectedShipmentIds[0] ? await getShipment(affectedShipmentIds[0]) : null;
  const fromTruck = incident ? await db.trucks.findById(incident.truckId) : undefined;
  const toTruck = plan.selectedTruckId ? await db.trucks.findById(plan.selectedTruckId) : undefined;

  const reassignments: ExecuteResult['reassignments'] = affectedShipmentIds.map((id) => ({
    shipmentId: id,
    fromTruckId: fromTruck?.id ?? null,
    toTruckId: plan.selectedTruckId ?? '',
    releasedT: shipment && fromTruck ? shipment.weightT : 0,
  }));

  return {
    plan,
    reassignments,
    verification: {
      shipmentStatus: shipment?.status ?? 'UNKNOWN',
      fromTruckStatus: fromTruck?.status ?? 'UNKNOWN',
      toTruckStatus: toTruck?.status ?? 'UNKNOWN',
      toTruckAvailableT: toTruck ? round(toTruck.availableT) : 0,
      incidentStatus: incident?.status ?? 'UNKNOWN',
    },
    notifications: (await db.notifications.find((n) => n.type === 'RECOVERY_INSTRUCTION')).map((n) => n.id),
  };
}
