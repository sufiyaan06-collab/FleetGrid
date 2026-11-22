import { Router } from 'express';
import { isProductionEnvironment } from '../config.js';
import { resetDemo } from '../services/demo.js';
import { asyncHandler } from '../middleware/errors.js';
import { requireRoles } from '../middleware/auth.js';

export const demoRouter: Router = Router();

/**
 * POST /demo/reset — restores the exact deterministic demo state
 * (FG-027 3.8T spare, FG-041 3.1T, FG-052 5.0T, no live incidents).
 */
demoRouter.post(
  '/demo/reset',
  requireRoles('CONTROL_TOWER'),
  asyncHandler(async (_req, res) => {
    if (isProductionEnvironment()) {
      res.status(403).json({ error: { code: 'DEMO_RESET_DISABLED', message: 'Demo reset is disabled in production.' } });
      return;
    }
    const result = await resetDemo();
    res.json({
      ok: true,
      message: 'Demo state restored to the deterministic seed.',
      ...result,
      state: 'READY',
    });
  }),
);
