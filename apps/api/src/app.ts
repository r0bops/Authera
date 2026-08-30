import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requestId } from 'hono/request-id';
import type { ReadinessCheck } from '@authera/contracts';
import { listActiveMandates, SEED_IDS, type Database, type SeedInput } from '@authera/db';
import type { KeyMaterial } from '@authera/domain';
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
import { humanEvidenceRoutes } from './routes/human/approvals.js';
import { consoleReadRoutes } from './routes/human/executions.js';
import { discoveryRoutes } from './routes/public/discovery.js';
import { mockWebhookRoutes, providerWebhookRoutes } from './routes/webhooks/webhooks.js';
import { humanMandateRoutes } from './routes/human/mandates.js';
import { meRoutes } from './routes/human/me.js';
import { databaseAgentIdentityStore } from './services/agent-identity.js';
import { AgentRunner } from './services/agent-runner.js';
import { DuffelFlightMarketProvider } from './services/flight-market/duffel-provider.js';
import type { FlightMarketProvider } from './services/flight-market/provider.js';
import { productRoutes } from './routes/gateway/products.js';
import { PriceWatcher } from './services/price-watch.js';
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
import { BookingService } from './services/booking-service.js';
import { MandateChatService } from './services/mandate-chat.js';
import { ChatNarrator } from './services/chat-narrator.js';
import { humanChatSessionRoutes } from './routes/human/chat-sessions.js';
import { ChatSessionService } from './services/chat-session-service.js';

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
const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/**
 * Assemble the Hono application. Pure function of its dependencies so tests can
 * swap the database probe, omit services, and skip static serving.
 */
export function createApp(deps: AppDependencies): App {
  const app = new Hono<AppEnv>();

  app.use(requestId());
  app.use(requestLogger(deps.logger));
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_REQUEST_BODY_BYTES,
      onError: (c) => fail(c, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large'),
    }),
  );

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
    let priceWatcher: PriceWatcher | undefined;
    let runner: AgentRunner | undefined;
    const mandates = new MandateService({
      db,
      signer: new MandateSigner(keys.trustedSurface),
      clock,
      logger: deps.logger,
      // A new plan looks at its market right away, even if that route was refreshed a minute ago.
      onCreated: () => priceWatcher?.refreshNow(),
    });

    // Public discovery (agent key directory + profiles).
    app.route('/', discoveryRoutes({ db, keys, config: deps.config, clock }));

    // Signed agent lane: identity is verified here; authority is decided by the gateway.
    const identity = databaseAgentIdentityStore(db);
    const markets: FlightMarketProvider[] = [];
    const duffelMarket = deps.config.markets.duffel
      ? new DuffelFlightMarketProvider({
          accessToken: deps.config.markets.duffel.accessToken,
          merchantId: SEED_IDS.duffel,
          priceModel: deps.config.markets.duffelPriceModel,
        })
      : undefined;
    if (duffelMarket) markets.push(duffelMarket);
    const checkout = new CheckoutService({
      db,
      clock,
      markets,
      logger: deps.logger,
      priceModel: deps.config.markets.duffelPriceModel,
    });
    // "Aria watches prices": discovery only, on a schedule, for every ACTIVE mandate.
    if (deps.config.markets.priceWatchIntervalMs > 0 && markets.length > 0) {
      priceWatcher = new PriceWatcher({
        checkout,
        listMandates: async () =>
          (await listActiveMandates(db)).map((m) => ({
            id: m.mandate.id,
            status: m.runtime.status,
            policy: m.policy,
            remainingCount:
              m.policy.limits.maxFulfillments - m.runtime.consumedCount - m.runtime.reservedCount,
          })),
        clock,
        logger: deps.logger,
        refreshMs: deps.config.markets.priceWatchIntervalMs,
        warmRoutes: deps.config.markets.priceWatchWarmRoutes,
        // "Buy when it drops": the agent attempts the eligible offer through the gateway.
        ...(deps.config.markets.priceWatchAutoBuy
          ? {
              // Inside the limit the agent chooses; a near miss is attempted as that exact offer
              // so the gateway can hand the decision to the human.
              autoBuy: async (mandateId: string, offerId: string, withinLimit: boolean) => {
                if (!runner) return;
                if (withinLimit) await runner.run({ mandateId, trigger: 'watch' });
                else await runner.direct({ mandateId, offerId, trigger: 'watch' });
              },
            }
          : {}),
      });
      priceWatcher.start();
    }
    const bookings = new BookingService({ db, duffel: duffelMarket, logger: deps.logger });
    const payments = new PaymentService({
      store: databasePaymentStore(db),
      processor: paymentProcessor,
      clock,
      logger: deps.logger,
      fulfill: (reserved, providerPaymentId) => bookings.fulfill(reserved, providerPaymentId),
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
    app.use('/api/products', agentSignature({ store: identity, clock, tag: AGENT_TAGS.browse }));
    app.route('/api/products', productRoutes({ checkout }));
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
      '/api/chat',
      '/api/chat/*',
      '/api/chats',
      '/api/chats/*',
      '/api/demo',
      '/api/demo/*',
    ]) {
      app.use(path, sessionMiddleware(sessionDeps));
      app.use(path, csrfGuard({ publicBaseUrl: deps.config.publicBaseUrl }));
    }
    app.route('/api/me', meRoutes(sessionDeps));
    const chat = new MandateChatService({ agent: deps.config.agent, clock, logger: deps.logger });
    app.route('/api/mandates', humanMandateRoutes({ db, mandates }));
    app.route(
      '/api/chats',
      humanChatSessionRoutes({
        db,
        sessions: new ChatSessionService({
          db,
          chat,
          mandates,
          market: async (origin, destination, limitMinor) => {
            const live = (await checkout.listCatalog())
              .filter(
                (o) => o.kind === 'flight' && o.origin === origin && o.destination === destination,
              )
              .sort((a, b) => a.total.minor - b.total.minor);
            const cheapest = live[0];
            return {
              origin,
              destination,
              count: live.length,
              cheapest: cheapest
                ? {
                    amountMinor: cheapest.total.minor,
                    currency: cheapest.total.currency,
                    airline: cheapest.airline ?? cheapest.merchantName,
                    date: (cheapest.departureAt ?? '').slice(0, 10),
                    stops: cheapest.stops ?? null,
                    durationMinutes:
                      cheapest.departureAt && cheapest.arrivalAt
                        ? Math.round(
                            (Date.parse(cheapest.arrivalAt) - Date.parse(cheapest.departureAt)) /
                              60_000,
                          )
                        : null,
                  }
                : null,
              limitMinor,
              withinLimitCount:
                limitMinor === null ? null : live.filter((o) => o.total.minor <= limitMinor).length,
            };
          },
        }),
      }),
    );
    app.route(
      '/api',
      consoleReadRoutes({ db, clock, views, checkout, processor: paymentProcessor }),
    );
    const evidence = new EvidenceService({ db, clock });
    const ap2Evidence = new Ap2EvidenceService({ evidence, merchantKey: keys.merchant, clock });
    const approvals = new ApprovalService({
      db,
      clock,
      logger: deps.logger,
      // The human said yes: the agent retries that exact cart once, consuming the approval.
      onApproved: (approval) => {
        if (!runner || !approval.offer) return;
        void runner
          .direct({
            mandateId: approval.mandateId,
            offerId: approval.offer.id,
            checkoutId: approval.checkoutId,
          })
          .catch((error: unknown) =>
            deps.logger.warn(
              { err: error, approvalId: approval.id },
              'retry after approval failed',
            ),
          );
      },
    });
    const disputes = new DisputeService({ db, clock, logger: deps.logger, evidence });
    app.route('/api', humanEvidenceRoutes({ db, approvals, disputes, evidence, ap2Evidence }));

    // Demo controls (DEMO_MODE only). The runner talks to this very app over signed HTTP.
    if (deps.config.demo.enabled) {
      const narrator = new ChatNarrator({ db, logger: deps.logger });
      runner = new AgentRunner({
        db,
        keys,
        clock,
        config: deps.config,
        logger: deps.logger,
        // Aria talks back: the conversation a plan came from hears what happened under it.
        onOutcome: (event) => void narrator.tell(event),
        fetch: (request) => Promise.resolve(app.fetch(request)),
      });
      app.route(
        '/api/demo',
        demoRoutes({
          db,
          config: deps.config,
          clock,
          runner,
          processor: paymentProcessor,
          seed,
          onOfferInjected: () => priceWatcher?.refreshNow(),
        }),
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
