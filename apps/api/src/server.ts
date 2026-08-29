import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { checkDatabaseReady, createPool } from '@agentcerta/db';
import { createApp } from './app.js';
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

function main(): void {
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
  const webDistDir = resolveWebDistDir(config);
  const app = createApp({
    config,
    logger,
    checkDatabase: () => checkDatabaseReady(pool),
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

main();
