import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { ReadinessCheck } from '@agentcerta/contracts';
import type { Database } from '@agentcerta/db';
import type { KeyMaterial } from '@agentcerta/domain';
import type { Clock } from './clock.js';
import type { AppConfig } from './config.js';
import { fail, type AppEnv } from './http/envelope.js';
import { ApiProblem } from './http/problem.js';
import { mountSpa } from './http/static.js';
import type { Logger } from './logger.js';
import { csrfGuard } from './middleware/csrf.js';
import { requestLogger } from './middleware/request-logger.js';
import { sessionMiddleware } from './middleware/session.js';
import { healthRoutes } from './routes/health.js';
import { humanMandateRoutes } from './routes/human/mandates.js';
import { meRoutes } from './routes/human/me.js';
import { MandateService } from './services/mandate-service.js';
import { MandateSigner } from './services/mandate-signer.js';

export interface AppServices {
  db: Database;
  keys: KeyMaterial;
  clock: Clock;
}

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  /** Real database probe used by /health/ready. */
  checkDatabase: () => Promise<ReadinessCheck>;
  /** Optional migrations probe used by /health/ready. */
  checkMigrations?: () => Promise<ReadinessCheck>;
  /** Database-backed services. When omitted only health and static routes are mounted. */
  services?: AppServices;
  /** Absolute path of the compiled SPA. When omitted, no static files are served. */
  webDistDir?: string;
}

export type App = Hono<AppEnv>;

/**
 * Assemble the Hono application. Pure function of its dependencies so tests can
 * swap the database probe, omit services, and skip static serving.
 */
export function createApp(deps: AppDependencies): App {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(requestLogger(deps.logger));

  app.onError((error, c) => {
    if (error instanceof ApiProblem) {
      if (error.status >= 500) c.get('logger').error({ err: error }, 'api problem');
      return fail(c, error.status, error.code, error.message, error.details);
    }
    c.get('logger').error({ err: error }, 'unhandled error');
    return fail(c, 500, 'INTERNAL_ERROR', 'Unexpected server error');
  });

  app.notFound((c) => fail(c, 404, 'NOT_FOUND', `No route for ${c.req.method} ${c.req.path}`));

  app.route(
    '/health',
    healthRoutes({
      checkDatabase: deps.checkDatabase,
      ...(deps.checkMigrations ? { checkMigrations: deps.checkMigrations } : {}),
    }),
  );

  if (deps.services) {
    const { db, keys, clock } = deps.services;
    const sessionDeps = { db, config: deps.config, clock };
    const mandates = new MandateService({
      db,
      signer: new MandateSigner(keys.trustedSurface),
      clock,
      logger: deps.logger,
    });

    app.use('/api/*', sessionMiddleware(sessionDeps));
    app.use('/api/*', csrfGuard({ publicBaseUrl: deps.config.publicBaseUrl }));
    app.route('/api/me', meRoutes(sessionDeps));
    app.route('/api/mandates', humanMandateRoutes({ db, mandates }));
  }

  if (deps.webDistDir) {
    mountSpa(app, deps.webDistDir);
  }

  return app;
}
