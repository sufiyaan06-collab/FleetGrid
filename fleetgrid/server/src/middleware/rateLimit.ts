import type { Request, RequestHandler } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  message: string;
  identityMax?: number;
  identity?: (req: Request) => string | null;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Small process-local limiter for public authentication endpoints.
 * It uses the socket peer address (not an untrusted X-Forwarded-For header)
 * and, where available, a normalized account identity.
 */
export function authRateLimit(options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const peer = req.socket.remoteAddress ?? 'unknown';
    const identity = options.identity?.(req)?.trim().toLowerCase();
    const keys = [{ key: `ip:${peer}`, max: options.max }];
    if (identity) keys.push({ key: `identity:${identity}`, max: options.identityMax ?? options.max });

    // Bound memory use during sustained traffic.
    if (buckets.size > 10_000) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
    }

    let retryAfter = 0;
    for (const entry of keys) {
      const current = buckets.get(entry.key);
      if (!current || current.resetAt <= now) {
        buckets.set(entry.key, { count: 1, resetAt: now + options.windowMs });
        continue;
      }
      if (current.count >= entry.max) {
        retryAfter = Math.max(retryAfter, Math.ceil((current.resetAt - now) / 1000));
      } else {
        current.count += 1;
      }
    }

    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: options.message,
        },
      });
      return;
    }
    next();
  };
}

export function emailIdentity(req: Request): string | null {
  const body = req.body as { email?: unknown } | undefined;
  return typeof body?.email === 'string' ? body.email : null;
}
