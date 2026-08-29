import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import type { ReadinessCheck } from '@agentcerta/contracts';
import type { Database, SeedInput } from '@agentcerta/db';
import type { KeyMaterial } from '@agentcerta/domain';
import type { Clock } from './clock.js';
import type { AppConfig } from './config.js';
import { fail, type AppEnv } from './http/envelope.js';
import { ApiProblem } from './http/problem.js';
import { mountSpa } from './http/static.js';
import type { Logger } from './logger.js';
import { AGENT_TAGS, agentSignature } from './middleware/agent-signature.js';
import { csrfGuard } from './middleware/csrf.js';
import { requestLogger } from './middleware/request-logger.js';
import { sessionMiddleware } from './middleware/session.js';
import { agentPingRoutes } from './routes/agent/ping.js';
import { demoRoutes } from './routes/demo/demo.js';
import { checkoutRoutes } from './routes/gateway/checkout.js';
import { flightRoutes } from './routes/gateway/flights.js';
import { purchaseAttemptRoutes } from './routes/gateway/purchase-attempts.js';
import { healthRoutes } from './routes/health.js';
import { ugliesRoutes } from './routes/human/approvals.js';
import { consoleReadRoutes } from './routes/human/executions.js';
import { discoveryRoutes } from './routes/public/discovery.js';
import { mockWebhookRoutes, providerWebhookRoutes } from './routes/webhooks/webhooks.js';
import { humanMandateRoutes } from './routes/human/mandates.js';
import { meRoutes } from './routes/human/me.js';
import { databaseAgentIdentityStore } from './services/agent-identity.js';
import { AgentRunner } from './services/agent-runner.js';
import { ApprovalService } from './services/approval-service.js';
import { Ap2EvidenceService } from './services/ap2-evidence.js';
import { DisputeService } from './services/dispute-service.js';
import { EvidenceService } from './services/evidence-service.js';
import { CheckoutService } from './services/checkout-service.js';
import { ExecutionViews } from './services/execution-views.js';
import { MandateGateway } from './services/gateway.js';
import { databaseGatewayStore } from './services/gateway-store.js';
import { MandateService } from './services/mandate-service.js';
import { MockPaymentProcessor } from './services/payments/mock-processor.js';
import { databasePaymentStore } from './services/payments/payment-store.js';
import { PaymentService } from './services/payments/payment-service.js';
import type { PaymentProcessor } from './services/payments/processor.js';
import { MandateSigner } from './services/mandate-signer.js';

export interface AppServices {
  db: Database;
  keys: KeyMaterial;
  clock: Clock;
  /** Selected by PAYMENT_MODE; the mock is the P0 reference implementation. */
  paymentProcessor: PaymentProcessor;
  /** Seed input used by demo reset (public keys + base URL). */
  seed: SeedInput;
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
    const { db, keys, clock, paymentProcessor, seed } = deps.services;
    const sessionDeps = { db, config: deps.config, clock };
    const mandates = new MandateService({
      db,
      signer: new MandateSigner(keys.trustedSurface),
      clock,
      logger: deps.logger,
    });

    // Public discovery (agent key directory + profiles).
    app.route('/', discoveryRoutes({ db, keys, config: deps.config, clock }));

    // Signed agent lane: identity is verified here; authority is decided by the gateway.
    const identity = databaseAgentIdentityStore(db);
    const checkout = new CheckoutService({ db, clock });
    const payments = new PaymentService({
      store: databasePaymentStore(db),
      processor: paymentProcessor,
      clock,
      logger: deps.logger,
    });
    if (paymentProcessor instanceof MockPaymentProcessor)
      paymentProcessor.onWebhook((event) => payments.handleWebhook(event));
    const gateway = new MandateGateway({
      store: databaseGatewayStore(db),
      clock,
      logger: deps.logger,
      // Payment runs only after a committed reservation; BLOCK/REQUIRE_HUMAN never reach it.
      onReserved: (reserved) => payments.executeReserved(reserved),
    });
    app.use('/api/agent/*', agentSignature({ store: identity, clock, tag: AGENT_TAGS.browse }));
    app.route('/api/agent', agentPingRoutes());
    app.use('/api/flights', agentSignature({ store: identity, clock, tag: AGENT_TAGS.browse }));
    app.route('/api/flights', flightRoutes({ checkout }));
    app.use('/ucp/*', agentSignature({ store: identity, clock, tag: AGENT_TAGS.browse }));
    app.route('/ucp/v1', checkoutRoutes({ checkout }));
    app.use(
      '/api/purchase-attempts',
      agentSignature({ store: identity, clock, tag: AGENT_TAGS.payment }),
    );
    app.route('/api/purchase-attempts', purchaseAttemptRoutes({ gateway }));

    // Human lane: cookie session + CSRF on every console route.
    const views = new ExecutionViews({ db, clock });
    for (const path of [
      '/api/me',
      '/api/mandates',
      '/api/mandates/*',
      '/api/executions',
      '/api/executions/*',
      '/api/purchases',
      '/api/purchases/*',
      '/api/verification/*',
      '/api/offers',
      '/api/approvals',
      '/api/approvals/*',
      '/api/disputes',
      '/api/disputes/*',
      '/api/evidence/*',
      '/api/audit/*',
      '/api/demo',
      '/api/demo/*',
    ]) {
      app.use(path, sessionMiddleware(sessionDeps));
      app.use(path, csrfGuard({ publicBaseUrl: deps.config.publicBaseUrl }));
    }
    app.route('/api/me', meRoutes(sessionDeps));
    app.route('/api/mandates', humanMandateRoutes({ db, mandates }));
    app.route('/api', consoleReadRoutes({ db, clock, views, checkout }));
    const evidence = new EvidenceService({ db, clock });
    const ap2Evidence = new Ap2EvidenceService({ evidence, merchantKey: keys.merchant, clock });
    const approvals = new ApprovalService({ db, clock, logger: deps.logger });
    const disputes = new DisputeService({ db, clock, logger: deps.logger, evidence });
    app.route('/api', ugliesRoutes({ db, approvals, disputes, evidence, ap2Evidence }));

    // Demo controls (DEMO_MODE only). The runner talks to this very app over signed HTTP.
    if (deps.config.demo.enabled) {
      const runner = new AgentRunner({
        db,
        keys,
        clock,
        config: deps.config,
        logger: deps.logger,
        fetch: (request) => Promise.resolve(app.fetch(request)),
      });
      app.route(
        '/api/demo',
        demoRoutes({ db, config: deps.config, clock, runner, processor: paymentProcessor, seed }),
      );
    }

    // Provider webhooks: raw-body verification inside the adapter. The mock webhook is a demo
    // control (human session) and exists only when the mock processor is active in demo mode.
    app.route('/webhooks', providerWebhookRoutes({ processor: paymentProcessor, payments }));
    if (deps.config.demo.enabled && paymentProcessor instanceof MockPaymentProcessor) {
      app.use('/webhooks/mock/*', sessionMiddleware(sessionDeps));
      app.use('/webhooks/mock/*', csrfGuard({ publicBaseUrl: deps.config.publicBaseUrl }));
      app.route('/webhooks', mockWebhookRoutes({ processor: paymentProcessor, payments }));
    }
  }

  if (deps.webDistDir) {
    mountSpa(app, deps.webDistDir);
  }

  return app;
}
