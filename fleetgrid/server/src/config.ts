import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** `server/` directory. */
export const serverRoot = resolve(here, '..');

// Load local environment variables before config and database modules read process.env.
// Render-provided environment variables take precedence over values in .env.
const envPath = resolve(serverRoot, '.env');
if (existsSync(envPath)) {
  try {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator <= 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const rawValue = trimmed.slice(separator + 1).trim();
      const quote = rawValue[0];
      const value =
        (quote === "'" || quote === '"') && rawValue.endsWith(quote)
          ? rawValue.slice(1, -1)
          : rawValue;
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    console.warn('[fleetgrid] could not load server/.env:', error);
  }
}

function envStr(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

function envNum(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: envNum('PORT', 4000),
  host: envStr('HOST', '0.0.0.0'),
  /** Directory holding the JSON collections. */
  dataDir: envStr('DATA_DIR', resolve(serverRoot, 'data')),
  /** Comma-separated list of allowed browser origins, or `*` for any. */
  corsOrigins: envStr('CORS_ORIGIN', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Reap dead websocket clients. */
  heartbeatMs: envNum('WS_HEARTBEAT_MS', 30_000),
  /** Reset demo data automatically when the data directory is empty. */
  autoSeed: envStr('AUTO_SEED', 'true') !== 'false',
} as const;

export type AppConfig = typeof config;
