import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import cors from 'cors';
import express from 'express';
import { config, serverRoot } from './config.js';
import { db } from './store/db.js';
import { ensureSeeded } from './services/demo.js';
import { hub } from './services/realtime.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { buildRouter, ENDPOINT_INDEX } from './routes/index.js';

export function createApp(): express.Express {
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (config.corsOrigins.includes('*') && process.env.NODE_ENV !== 'production') return callback(null, true);
        if (config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );
  app.use(express.json({
    limit: '256kb',
    verify: (req, _res, buffer) => {
      // Dodo signs the exact request bytes. Preserve the raw body before JSON parsing.
      if (req.url?.split('?')[0] === '/payments/dodo/webhook') {
        Object.assign(req, { rawBody: buffer.toString('utf8') });
      }
    },
  }));

  const webDist = resolve(serverRoot, '../web/dist');
  const hasWeb = existsSync(webDist);

  if (hasWeb) {
    app.use(express.static(webDist));
    app.get('/', (req, res, next) => {
      if (req.accepts('html')) {
        return res.sendFile(resolve(webDist, 'index.html'));
      }
      return next();
    });
  }

  app.get('/api', (_req, res) => {
    res.json({
      service: 'FleetGrid API',
      phase: 'Authoritative self-healing logistics network',
      realtime: '/realtime (WebSocket)',
      endpoints: ENDPOINT_INDEX,
    });
  });

  if (!hasWeb) {
    app.get('/', (_req, res) => {
      res.json({
        service: 'FleetGrid API',
        phase: 'Authoritative self-healing logistics network',
        realtime: '/realtime (WebSocket)',
        endpoints: ENDPOINT_INDEX,
      });
    });
  }

  app.use(buildRouter());

  if (hasWeb) {
    app.get('*', (req, res, next) => {
      if (
        req.path.startsWith('/state') ||
        req.path.startsWith('/realtime') ||
        req.path.startsWith('/incidents') ||
        req.path.startsWith('/trucks') ||
        req.path.startsWith('/shipments') ||
        req.path.startsWith('/payments') ||
        req.path.startsWith('/auth') ||
        req.path.startsWith('/capacity') ||
        req.path.startsWith('/bids') ||
        req.path.startsWith('/recovery-plans') ||
        req.path.startsWith('/agent') ||
        req.path.startsWith('/demo')
      ) {
        return next();
      }
      res.sendFile(resolve(webDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

async function main(): Promise<void> {
  const app = createApp();
  const server = createServer(app);
  hub.attach(server);

  await db.initialize();
  console.log(`[fleetgrid] storage ${db.storage}`);

  const seed = await ensureSeeded();
  if (seed.seeded) {
    console.log(`[fleetgrid] seeded demo data → ${config.dataDir} (${seed.trucks} trucks, ${seed.shipments} shipments)`);
  }

  server.listen(config.port, config.host, () => {
    console.log(`[fleetgrid] API      http://localhost:${config.port}`);
    console.log(`[fleetgrid] realtime ws://localhost:${config.port}/realtime`);
    if (db.storage === 'json-file') console.log(`[fleetgrid] data dir ${config.dataDir}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[fleetgrid] ${signal} received, shutting down.`);
    await hub.close();
    await db.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Exporting createApp for integration tests must not also start a second listener.
const invokedDirectly = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('[fleetgrid] failed to start:', err);
    process.exit(1);
  });
}
