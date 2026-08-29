import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { ReadinessCheck } from '@agentcerta/contracts';
import type { AppConfig } from './config.js';
import { fail, type AppEnv } from './http/envelope.js';
import { mountSpa } from './http/static.js';
import type { Logger } from './logger.js';
import { requestLogger } from './middleware/request-logger.js';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  /** Real database probe used by /health/ready. */
  checkDatabase: () => Promise<ReadinessCheck>;
  /** Absolute path of the compiled SPA. When omitted, no static files are served. */
  webDistDir?: string;
}

export type App = Hono<AppEnv>;

/**
 * Assemble the Hono application. Pure function of its dependencies so tests can
 * swap the database probe and skip static serving.
 */
export function createApp(deps: AppDependencies): App {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(requestLogger(deps.logger));

  app.onError((error, c) => {
    c.get('logger').error({ err: error }, 'unhandled error');
    return fail(c, 500, 'INTERNAL_ERROR', 'Unexpected server error');
  });

  app.notFound((c) => fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`));

  app.route('/health', healthRoutes({ checkDatabase: deps.checkDatabase }));

  if (deps.webDistDir) {
    mountSpa(app, deps.webDistDir);
  }

  return app;
}
