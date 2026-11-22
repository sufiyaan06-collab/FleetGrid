import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from '../lib/errors.js';
import { isProductionEnvironment } from '../config.js';

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'fleetgrid_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export interface IssuedToken {
  token: string;
  tokenHash: string;
  expiresAt: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = (await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function issueToken(ttlMs: number): IssuedToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashOpaqueToken(token),
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
}

export const issueSessionToken = (): IssuedToken => issueToken(SESSION_TTL_MS);
export const issueVerificationToken = (): IssuedToken => issueToken(VERIFY_TTL_MS);

export function setSessionCookie(res: { setHeader(name: string, value: string): void }, token: string): void {
  const production = isProductionEnvironment();
  const secure = production ? '; Secure' : '';
  const sameSite = 'Lax';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(res: { setHeader(name: string, value: string): void }): void {
  const production = isProductionEnvironment();
  const secure = production ? '; Secure' : '';
  const sameSite = production ? 'None' : 'Lax';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`);
}

export function readSessionCookie(cookieHeader?: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return /^[A-Za-z0-9_-]{40,}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function assertEmailProviderConfigured(): void {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !process.env.APP_BASE_URL) {
    throw new ApiError(
      503,
      'EMAIL_PROVIDER_NOT_CONFIGURED',
      'Email verification is not available yet. Configure RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL before enabling real account registration.',
    );
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  assertEmailProviderConfigured();
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !baseUrl) {
    throw new ApiError(
      503,
      'EMAIL_PROVIDER_NOT_CONFIGURED',
      'Email verification is not available yet. Configure RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL before enabling real account registration.',
    );
  }

  let url: URL;
  try {
    url = new URL('/', baseUrl);
    url.searchParams.set('token', token);
  } catch {
    throw new ApiError(503, 'EMAIL_CONFIGURATION_INVALID', 'APP_BASE_URL must be a valid absolute URL.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Verify your FleetGrid email',
      text: `Verify your FleetGrid account by opening this link: ${url.toString()}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
    }),
  });

  if (!response.ok) {
    // Do not include provider response bodies, credentials, or verification tokens in logs/errors.
    throw new ApiError(502, 'EMAIL_DELIVERY_FAILED', 'FleetGrid could not send the verification email. Please try again later.');
  }
}
