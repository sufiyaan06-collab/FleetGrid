import { Router } from 'express';
import { z } from 'zod';
import { db } from '../store/db.js';
import { ApiError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/errors.js';
import { validateBody } from '../middleware/validate.js';
import { register } from '../services/registration.js';
import type { AuthAccount, Role } from '../types.js';
import {
  assertEmailProviderConfigured,
  clearSessionCookie,
  hashOpaqueToken,
  hashPassword,
  issueSessionToken,
  issueVerificationToken,
  readSessionCookie,
  sendVerificationEmail,
  setSessionCookie,
  verifyPassword,
} from '../services/authSecurity.js';
import { ApiError as AuthApiError } from '../lib/errors.js';

export const authRouter: Router = Router();

async function authenticatedSession(userId: string) {
  const user = await db.users.findById(userId);
  if (!user) throw new AuthApiError(401, 'AUTH_REQUIRED', 'Please sign in.');
  const organization = user.organizationId ? await db.organizations.findById(user.organizationId) : undefined;
  const drivers = await db.drivers.find((driver) => driver.userId === user.id);
  return {
    ok: true as const,
    mode: 'authenticated' as const,
    user,
    organization: organization ?? null,
    driver: drivers[0] ?? null,
    availableRoles: [user.role],
  };
}

const DEMO_ROLES = ['CONTROL_TOWER', 'BUSINESS', 'DRIVER', 'OPERATOR', 'VERIFIER'] as const;

const demoLoginSchema = z.object({
  role: z.enum(DEMO_ROLES).default('CONTROL_TOWER'),
});

/**
 * POST /auth/demo-login
 *
 * Demo role selection only — no password, no token, no session store.
 * It returns the seeded user + organization context for the requested role so the
 * UI can attribute actions to an actor. It is NOT authentication.
 */
authRouter.post(
  '/auth/demo-login',
  validateBody(demoLoginSchema),
  asyncHandler(async (req, res) => {
    const { role } = req.body as { role: Role };
    const users = await db.users.get();
    const user = users.find((u) => u.role === role) ?? users[0];

    if (!user) {
      throw ApiError.notFound('No seeded users are available. Run POST /demo/reset first.');
    }

    const organization = user.organizationId
      ? await db.organizations.findById(user.organizationId)
      : undefined;

    const driver = await db.drivers.find((d) => d.userId === user.id);

    res.json({
      ok: true,
      mode: 'demo',
      warning: 'Demo role selection. No authentication, no tokens. Do not use outside a hackathon demo.',
      user,
      organization: organization ?? null,
      driver: driver[0] ?? null,
      availableRoles: DEMO_ROLES,
    });
  }),
);

const registerSchema = z.object({
  role: z.enum(['BUSINESS', 'DRIVER']),
  name: z.string().min(2).max(120),
  contact: z.string().min(3).max(160),
  organizationName: z.string().min(2).max(120).nullish(),
  truck: z
    .object({
      registrationNo: z.string().min(2).max(32),
      capacityT: z.number().positive().max(50),
      origin: z.string().min(2).max(80),
      destination: z.string().min(2).max(80),
    })
    .nullish(),
});

/**
 * POST /auth/register
 *
 * Self-service onboarding. The caller picks whether they are a shipper or a driver;
 * the server creates only the entities that role needs (Master PRD §10).
 *
 * A DRIVER may pass `truck` to register a truck in the same call, which is what
 * makes them able to receive offers immediately. A DRIVER without a truck is
 * created but has nothing to accept until an operator assigns one.
 *
 * Returns the same `{ user, organization, driver }` shape as `demo-login` so the
 * client can treat a freshly registered account exactly like a seeded one.
 */
authRouter.post(
  '/auth/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof registerSchema>;
    const result = await register({
      role: body.role,
      name: body.name,
      contact: body.contact,
      organizationName: body.organizationName ?? null,
      truck: body.truck ?? null,
    });
    res.status(201).json({
      ok: true,
      mode: 'registered',
      warning:
        'Account created, but this is not authentication: no password, token, or session. Demo scope only.',
      user: result.user,
      organization: result.organization,
      driver: result.driver,
      truck: result.truck,
    });
  }),
);


// Credential-based account flow. These endpoints establish a real identity;
// legacy demo endpoints remain for the existing demo UI until the UI migration
// and route-by-route authorization work is complete.
const secureRegisterSchema = z.object({
  role: z.enum(['BUSINESS', 'DRIVER']),
  name: z.string().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  contact: z.string().min(3).max(160),
  organizationName: z.string().min(2).max(120).nullish(),
  truck: z.object({
    registrationNo: z.string().min(2).max(32),
    capacityT: z.number().positive().max(50),
    origin: z.string().min(2).max(80),
    destination: z.string().min(2).max(80),
  }).nullish(),
});

authRouter.post(
  '/auth/signup',
  validateBody(secureRegisterSchema),
  asyncHandler(async (req, res) => {
    assertEmailProviderConfigured();
    const body = req.body as z.infer<typeof secureRegisterSchema>;
    const email = body.email.trim().toLowerCase();
    const existing = await db.authAccounts.find((account) => account.email === email);
    if (existing.length) throw AuthApiError.conflict('An account with this email already exists.');

    const verification = issueVerificationToken();
    // Send before creating domain records: a provider outage must not leave an
    // account that exists but can never receive its verification link.
    await sendVerificationEmail(email, verification.token);
    const result = await register({
      role: body.role,
      name: body.name,
      contact: body.contact,
      organizationName: body.organizationName ?? null,
      truck: body.truck ?? null,
    });
    const timestamp = new Date().toISOString();
    const account: AuthAccount = {
      id: result.user.id,
      email,
      passwordHash: await hashPassword(body.password),
      emailVerifiedAt: null,
      verificationTokenHash: verification.tokenHash,
      verificationExpiresAt: verification.expiresAt,
      sessionTokenHash: null,
      sessionExpiresAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await db.authAccounts.create(account);

    res.status(202).json({
      ok: true,
      verificationRequired: true,
      message: 'Account created. Check your email for the verification link before signing in.',
      email,
    });
  }),
);

const credentialSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

authRouter.post(
  '/auth/login',
  validateBody(credentialSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof credentialSchema>;
    const email = body.email.trim().toLowerCase();
    const matches = await db.authAccounts.find((account) => account.email === email);
    const account = matches[0];
    const now = Date.now();

    // Same response for unknown email and incorrect password to reduce account enumeration.
    if (!account) throw new AuthApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    if (account.lockedUntil && Date.parse(account.lockedUntil) > now) {
      throw new AuthApiError(429, 'LOGIN_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again later.');
    }

    const valid = await verifyPassword(body.password, account.passwordHash);
    if (!valid) {
      const failures = account.failedLoginCount + 1;
      await db.authAccounts.update(account.id, {
        failedLoginCount: failures >= 5 ? 0 : failures,
        lockedUntil: failures >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null,
        updatedAt: new Date(now).toISOString(),
      });
      throw new AuthApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    if (!account.emailVerifiedAt) {
      throw new AuthApiError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before signing in.');
    }

    const user = await db.users.findById(account.id);
    if (!user) throw new AuthApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    const session = issueSessionToken();
    await db.authAccounts.update(account.id, {
      sessionTokenHash: session.tokenHash,
      sessionExpiresAt: session.expiresAt,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date().toISOString(),
    });
    setSessionCookie(res, session.token);
    res.json(await authenticatedSession(user.id));
  }),
);

authRouter.get(
  '/auth/verify-email',
  asyncHandler(async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) throw AuthApiError.badRequest('Verification token is required.');
    const tokenHash = hashOpaqueToken(token);
    const matches = await db.authAccounts.find((account) => account.verificationTokenHash === tokenHash);
    const account = matches[0];
    if (!account || !account.verificationExpiresAt || Date.parse(account.verificationExpiresAt) < Date.now()) {
      throw new AuthApiError(400, 'VERIFICATION_LINK_INVALID', 'This verification link is invalid or expired. Request a new one.');
    }
    await db.authAccounts.update(account.id, {
      emailVerifiedAt: new Date().toISOString(),
      verificationTokenHash: null,
      verificationExpiresAt: null,
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: 'Email verified. You can now sign in.' });
  }),
);

authRouter.post(
  '/auth/resend-verification',
  validateBody(z.object({ email: z.string().email().max(254) })),
  asyncHandler(async (req, res) => {
    assertEmailProviderConfigured();
    const email = (req.body as { email: string }).email.trim().toLowerCase();
    const matches = await db.authAccounts.find((account) => account.email === email);
    const account = matches[0];
    if (account && !account.emailVerifiedAt) {
      const verification = issueVerificationToken();
      await db.authAccounts.update(account.id, {
        verificationTokenHash: verification.tokenHash,
        verificationExpiresAt: verification.expiresAt,
        updatedAt: new Date().toISOString(),
      });
      await sendVerificationEmail(email, verification.token);
    }
    // Do not reveal whether an email has an account.
    res.json({ ok: true, message: 'If the account needs verification, a new email has been sent.' });
  }),
);

authRouter.get(
  '/auth/me',
  asyncHandler(async (req, res) => {
    const token = readSessionCookie(req.headers.cookie);
    if (!token) throw new AuthApiError(401, 'AUTH_REQUIRED', 'Please sign in.');
    const tokenHash = hashOpaqueToken(token);
    const matches = await db.authAccounts.find((account) => account.sessionTokenHash === tokenHash);
    const account = matches[0];
    if (!account || !account.sessionExpiresAt || Date.parse(account.sessionExpiresAt) < Date.now()) {
      throw new AuthApiError(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
    }
    if (!account.emailVerifiedAt) throw new AuthApiError(401, 'AUTH_REQUIRED', 'Please sign in.');
    res.json({ ...(await authenticatedSession(account.id)), email: account.email });
  }),
);

authRouter.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    const token = readSessionCookie(req.headers.cookie);
    if (token) {
      const tokenHash = hashOpaqueToken(token);
      const matches = await db.authAccounts.find((account) => account.sessionTokenHash === tokenHash);
      if (matches[0]) {
        await db.authAccounts.update(matches[0].id, {
          sessionTokenHash: null,
          sessionExpiresAt: null,
          updatedAt: new Date().toISOString(),
        });
      }
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  }),
);
