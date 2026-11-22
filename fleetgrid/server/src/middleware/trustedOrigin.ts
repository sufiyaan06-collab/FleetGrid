import type { RequestHandler } from 'express';
import { config } from '../config.js';

/**
 * Cookie-authenticated browser mutations must originate from the app itself or
 * an explicitly configured frontend origin. In production, missing Origin is
 * rejected rather than silently bypassing CSRF protection.
 */
export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || process.env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const originHeader = req.get('origin');
  if (!originHeader || originHeader === 'null') {
    res.status(403).json({ error: { code: 'ORIGIN_REQUIRED', message: 'A trusted browser origin is required for this request.' } });
    return;
  }

  let origin: string;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'This request origin is not allowed.' } });
    return;
  }

  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const sameOrigin = `${forwardedProto || req.protocol}://${req.get('host')}`;
  const configuredOrigins = config.corsOrigins
    .filter((value) => value !== '*')
    .map((value) => {
      try { return new URL(value).origin; } catch { return ''; }
    })
    .filter(Boolean);
  const appBaseUrl = process.env.APP_BASE_URL;
  if (appBaseUrl) {
    try { configuredOrigins.push(new URL(appBaseUrl).origin); } catch { /* invalid APP_BASE_URL is handled by email setup */ }
  }

  if (origin !== sameOrigin && !configuredOrigins.includes(origin)) {
    res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'This request origin is not allowed.' } });
    return;
  }
  next();
};
