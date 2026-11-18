import type { RequestHandler } from 'express';
import { db } from '../store/db.js';
import { hashOpaqueToken, readSessionCookie } from '../services/authSecurity.js';
import type { User } from '../types.js';
import { config } from '../config.js';

/** Authenticated identity is attached to response locals, never trusted from a body. */
export const requireAuthenticated: RequestHandler = (req, res, next) => {
  void (async () => {
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') {
      const seeded = (await db.users.get())[0];
      if (seeded) {
        res.locals.authUser = seeded;
        return next();
      }
    }

    // Cookie sessions use SameSite=None for the separately hosted frontend.
    // Validate browser origins on every state-changing request to mitigate CSRF.
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && !config.corsOrigins.includes(origin)) {
        res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'This request origin is not allowed.' } });
        return;
      }
    }

    const token = readSessionCookie(req.headers.cookie);
    if (!token) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' } });
      return;
    }

    const tokenHash = hashOpaqueToken(token);
    const accounts = await db.authAccounts.find((account) => account.sessionTokenHash === tokenHash);
    const account = accounts[0];
    if (!account || !account.sessionExpiresAt || Date.parse(account.sessionExpiresAt) <= Date.now() || !account.emailVerifiedAt) {
      res.status(401).json({ error: { code: 'SESSION_EXPIRED', message: 'Your session is invalid or expired. Please sign in again.' } });
      return;
    }

    const user = await db.users.findById(account.id);
    if (!user) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' } });
      return;
    }

    res.locals.authUser = user satisfies User;
    next();
  })().catch(next);
};

export function requireRoles(...roles: User['role'][]): RequestHandler {
  return (_req, res, next) => {
    if (process.env.FLEETGRID_TEST_BYPASS_AUTH === 'true') return next();
    const user = res.locals.authUser as User | undefined;
    if (!user) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Please sign in to continue.' } });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: { code: 'ROLE_FORBIDDEN', message: 'Your account does not have permission to perform this action.' } });
      return;
    }
    next();
  };
}
