import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import {
  checkDatabaseReady,
  checkMigrationsApplied,
  createDatabase,
  createPool,
  runMigrations,
  seedDemo,
} from '@agentcerta/db';
import { loadKeyMaterial } from '@agentcerta/domain';
import { createApp } from './app.js';
import { createClock } from './clock.js';
import { ConfigError, loadConfig, type AppConfig } from './config.js';
import { loadDotEnv } from './dotenv.js';
import { createLogger } from './logger.js';

const SHUTDOWN_GRACE_MS = 10_000;

function resolveWebDistDir(config: AppConfig): string | undefined {
  // From apps/api/dist/server.js (production) or apps/api/src/server.ts (tsx dev),
  // the compiled SPA lives at apps/web/dist.
  const candidate =
    config.webDistDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  return existsSync(resolve(candidate, 'index.html')) ? candidate : undefined;
}

async function main(): Promise<void> {
  const dotEnvPath = loadDotEnv();

  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });
  if (dotEnvPath) logger.debug({ path: dotEnvPath }, 'loaded .env file');

  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);

  // Schema first, then the deterministic demo scenario (idempotent) when demo mode is on.
  await runMigrations(db);
  const keys = loadKeyMaterial({
    trustedSurfacePrivateJwk: config.keys.trustedSurfacePrivateJwk,
    merchantPrivateJwk: config.keys.merchantPrivateJwk,
    agentPrivateJwk: config.keys.agentPrivateJwk,
    demoSecret: config.demo.enabled ? config.demo.resetSecret : undefined,
  });
  if (keys.derived)
    logger.warn(
      'signing keys derived from DEMO_RESET_SECRET (demo mode); set explicit *_PRIVATE_JWK for real deployments',
    );
  if (config.demo.enabled) {
    await seedDemo(db, {
      publicBaseUrl: config.publicBaseUrl,
      keys: {
        trustedSurface: { kid: keys.trustedSurface.kid, publicJwk: keys.trustedSurface.publicJwk },
        merchant: { kid: keys.merchant.kid, publicJwk: keys.merchant.publicJwk },
        agent: { thumbprint: keys.agent.thumbprint, publicJwk: keys.agent.publicJwk },
      },
    });
    logger.info('demo scenario seeded');
  }

  const clock = createClock({ demoClockEnabled: config.demo.enabled && config.demo.clockEnabled });
  const webDistDir = resolveWebDistDir(config);
  const app = createApp({
    config,
    logger,
    checkDatabase: () => checkDatabaseReady(pool),
    checkMigrations: () => checkMigrationsApplied(pool),
    services: { db, keys, clock },
    ...(webDistDir ? { webDistDir } : {}),
  });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' }, (info) => {
    logger.info(
      {
        port: info.port,
        nodeEnv: config.nodeEnv,
        paymentMode: config.payment.mode,
        agentMode: config.agent.mode,
        demoMode: config.demo.enabled,
        staticDir: webDistDir ?? null,
      },
      'AgentCerta API listening',
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      logger.error('forced exit after shutdown grace period');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    force.unref();

    server.close(() => {
      pool
        .end()
        .catch((error: unknown) => logger.warn({ err: error }, 'pool shutdown failed'))
        .finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  console.error('fatal startup error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
