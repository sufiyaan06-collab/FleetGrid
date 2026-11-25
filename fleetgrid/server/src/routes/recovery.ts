import { Router } from 'express';
import { z } from 'zod';
import {
  acceptRecoveryPlan,
  approveRecoveryPlan,
  createRecoveryPlan,
  executeRecoveryPlan,
  findRecoveryOptions,
  getRecoveryPlan,
  listRecoveryPlans,
  rejectRecoveryPlan,
} from '../services/recovery.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { requiredParam } from '../middleware/params.js';
import { requireRoles } from '../middleware/auth.js';
import type { User } from '../types.js';

export const recoveryRouter: Router = Router();

// A replacement driver can accept only the recovery request for their own assigned truck.
recoveryRouter.post(
  '/driver/recovery-plans/:id/accept',
  requireRoles('DRIVER'),
  asyncHandler(async (req, res) => {
    const user = res.locals.authUser as User;
    const plan = await acceptRecoveryPlan(requiredParam(req, 'id'), user.id);
    res.json({ ok: true, plan });
  }),
);

// Recovery plans change fleet-wide assignments and require an operations role.
recoveryRouter.use('/recovery-plans', requireRoles('CONTROL_TOWER', 'OPERATOR', 'VERIFIER'));

const createPlanSchema = z.object({
  incidentId: z.string().min(2),
});

/**
 * POST /recovery-plans — the ANALYZE RECOVERY action.
 *
 * Deterministic options are generated from backend state (no LLM in this phase)
 * and the plan is parked in PENDING_APPROVAL. Nothing is reassigned until an
 * operator approves and a separate execute call runs.
 */
recoveryRouter.post(
  '/recovery-plans',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  validateBody(createPlanSchema),
  asyncHandler(async (req, res) => {
    const { incidentId } = req.body as z.infer<typeof createPlanSchema>;
    const result = await createRecoveryPlan(incidentId);
    res.status(result.created ? 201 : 200).json({
      ok: true,
      plan: result.plan,
      options: result.options,
      created: result.created,
      engine: 'DETERMINISTIC_PLACEHOLDER',
      note: 'Option generation is deterministic. LLM reasoning is a later phase. Approval is required before execution.',
    });
  }),
);

recoveryRouter.get(
  '/recovery-plans',
  validateQuery(z.object({ incidentId: z.string().optional() })),
  asyncHandler(async (_req, res) => {
    const query = res.locals.query as { incidentId?: string };
    const plans = await listRecoveryPlans(query);
    res.json({ plans, count: plans.length });
  }),
);

recoveryRouter.get(
  '/recovery-plans/:id',
  asyncHandler(async (req, res) => {
    res.json({ plan: await getRecoveryPlan(requiredParam(req, 'id')) });
  }),
);

/** GET /incidents/:id/recovery-options — read-only preview, creates nothing. */
recoveryRouter.get(
  '/incidents/:id/recovery-options',
  requireRoles('CONTROL_TOWER', 'OPERATOR', 'VERIFIER'),
  asyncHandler(async (req, res) => {
    const { impact, options } = await findRecoveryOptions(requiredParam(req, 'id'));
    res.json({ impact, options, engine: 'DETERMINISTIC_PLACEHOLDER' });
  }),
);

const approveSchema = z.object({
  approvedBy: z.string().min(2).optional(),
});

recoveryRouter.post(
  '/recovery-plans/:id/approve',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  validateBody(approveSchema),
  asyncHandler(async (req, res) => {
    const { approvedBy } = req.body as z.infer<typeof approveSchema>;
    const plan = await approveRecoveryPlan(requiredParam(req, 'id'), process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? approvedBy ?? 'operator_demo' : (res.locals.authUser as { id: string }).id);
    res.json({ ok: true, plan });
  }),
);

const rejectSchema = z.object({
  rejectedBy: z.string().min(2).optional(),
  reason: z.string().min(2).max(300).default('Rejected by operator'),
});

recoveryRouter.post(
  '/recovery-plans/:id/reject',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  validateBody(rejectSchema),
  asyncHandler(async (req, res) => {
    const { rejectedBy, reason } = req.body as z.infer<typeof rejectSchema>;
    const plan = await rejectRecoveryPlan(requiredParam(req, 'id'), process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? rejectedBy ?? 'operator_demo' : (res.locals.authUser as { id: string }).id, reason);
    res.json({ ok: true, plan });
  }),
);

const executeSchema = z.object({
  executedBy: z.string().min(2).optional(),
});

recoveryRouter.post(
  '/recovery-plans/:id/execute',
  requireRoles('CONTROL_TOWER', 'OPERATOR'),
  validateBody(executeSchema),
  asyncHandler(async (req, res) => {
    const { executedBy } = req.body as z.infer<typeof executeSchema>;
    const result = await executeRecoveryPlan(requiredParam(req, 'id'), process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true' ? executedBy ?? 'operator_demo' : (res.locals.authUser as { id: string }).id);
    res.json({ ok: true, ...result });
  }),
);
