import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import {
  DemoAttemptRequestSchema,
  DemoConcurrentAttemptsRequestSchema,
  DemoDirectAttemptRequestSchema,
  DemoInjectOfferRequestSchema,
  DemoPaymentBehaviorRequestSchema,
  DemoReplayRequestSchema,
  DemoTimeRequestSchema,
  type DemoState,
} from '@agentcerta/contracts';
import {
  getCheckout,
  insertOffer,
  resetDemo,
  SEED_IDS,
  tamperCheckoutCart,
  type Database,
  type SeedInput,
} from '@agentcerta/db';
import type { Clock } from '../../clock.js';
import type { AppConfig } from '../../config.js';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { idempotent } from '../../middleware/idempotency.js';
import { issueSession, requireHuman } from '../../middleware/session.js';
import type { AgentRunner } from '../../services/agent-runner.js';
import { toOfferView } from '../../services/checkout-service.js';
import { MockPaymentProcessor, type MockBehavior } from '../../services/payments/mock-processor.js';
import type { PaymentProcessor } from '../../services/payments/processor.js';

export interface DemoDependencies {
  db: Database;
  config: AppConfig;
  clock: Clock;
  runner: AgentRunner;
  processor: PaymentProcessor;
  seed: SeedInput;
}

async function parse<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: {
    safeParse: (
      v: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
  return parsed.data;
}

/**
 * Demo controls (spec §12). Enabled only with DEMO_MODE=true, behind the console session, CSRF,
 * and Idempotency-Key. They construct inputs and call the normal services — nothing here can
 * insert a successful execution or bypass signature/policy verification.
 */
export function demoRoutes(deps: DemoDependencies) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());
  let paymentBehavior: MockBehavior | null = null;

  const state = (): DemoState => ({
    demoMode: deps.config.demo.enabled,
    paymentMode: deps.config.payment.mode,
    agentMode: deps.config.agent.mode,
    clockOffsetMinutes: Math.round(deps.clock.offsetMs() / 60_000),
    clockEnabled: deps.config.demo.clockEnabled,
    now: deps.clock.now().toISOString(),
    paymentBehavior,
    paymentCalls: deps.processor instanceof MockPaymentProcessor ? deps.processor.calls.length : 0,
    capturedRequests: deps.runner.capturedRequests(),
  });

  routes.get('/state', (c) => ok(c, state()));

  routes.post('/reset', idempotent('demo.reset', deps.db), async (c) => {
    await resetDemo(deps.db, deps.seed);
    // Reset removes every human session. Rotate the demo cookie in the same response so the
    // operator can continue the trial without an otherwise surprising re-authentication step.
    await issueSession(c, { db: deps.db, config: deps.config, clock: deps.clock }, SEED_IDS.marta);
    if (deps.processor instanceof MockPaymentProcessor) deps.processor.reset();
    paymentBehavior = null;
    if (deps.config.demo.clockEnabled) deps.clock.setOffset(0);
    deps.runner.reset();
    return ok(c, state());
  });

  routes.post('/offers', idempotent('demo.offers', deps.db), async (c) => {
    const input = await parse(c, DemoInjectOfferRequestSchema);
    const now = deps.clock.now();
    const departureAt = input.departureAt
      ? new Date(input.departureAt)
      : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const offer = await insertOffer(deps.db, {
      id: randomUUID(),
      merchantId: SEED_IDS.vuelaya,
      airline: input.airline,
      flightNumber: input.flightNumber ?? `VY${Math.floor(100 + Math.random() * 900)}`,
      origin: input.origin,
      destination: input.destination,
      cabin: input.cabin,
      departureAt,
      arrivalAt: new Date(departureAt.getTime() + 5.5 * 60 * 60 * 1000),
      passengerCount: input.passengerCount,
      amountMinor: input.amountMinor,
      currency: input.currency,
      expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000),
      source: 'demo',
    });
    return ok(c, toOfferView(offer), 201);
  });

  routes.post('/attempts', idempotent('demo.attempts', deps.db), async (c) => {
    const input = await parse(c, DemoAttemptRequestSchema);
    if (input.offerId) {
      return ok(
        c,
        await deps.runner.direct({ mandateId: input.mandateId, offerId: input.offerId }),
      );
    }
    return ok(
      c,
      await deps.runner.run({
        mandateId: input.mandateId,
        ...(input.mode ? { mode: input.mode } : {}),
      }),
    );
  });

  routes.post('/attempts/direct', idempotent('demo.attempts.direct', deps.db), async (c) => {
    const input = await parse(c, DemoDirectAttemptRequestSchema);
    return ok(c, await deps.runner.direct(input));
  });

  routes.post(
    '/attempts/impersonate',
    idempotent('demo.attempts.impersonate', deps.db),
    async (c) => {
      const input = await parse(c, DemoDirectAttemptRequestSchema);
      return ok(c, await deps.runner.direct({ ...input, impersonate: true }));
    },
  );

  routes.post('/attempts/replay', idempotent('demo.attempts.replay', deps.db), async (c) => {
    const input = await parse(c, DemoReplayRequestSchema);
    return ok(c, await deps.runner.replay(input.executionId));
  });

  routes.post('/concurrent-attempts', idempotent('demo.concurrent', deps.db), async (c) => {
    const input = await parse(c, DemoConcurrentAttemptsRequestSchema);
    return ok(c, await deps.runner.concurrent(input));
  });

  /** Simulate a cart modified after authorization: the stored hash no longer matches the cart. */
  routes.post('/checkouts/:id/tamper', idempotent('demo.tamper', deps.db), async (c) => {
    const id = c.req.param('id');
    const checkout = await getCheckout(deps.db, id);
    if (!checkout) throw ApiProblem.notFound('checkout');
    const tampered = {
      ...checkout.cart,
      total: { ...checkout.cart.total, minor: checkout.cart.total.minor + 1 },
      lineItems: checkout.cart.lineItems.map((item, index) =>
        index === 0
          ? { ...item, unitPrice: { ...item.unitPrice, minor: item.unitPrice.minor + 1 } }
          : item,
      ),
    };
    const result = await tamperCheckoutCart(deps.db, id, tampered);
    return ok(c, {
      checkoutId: result.id,
      cartHash: result.cartHash,
      cartTotalMinor: result.cart.total.minor,
    });
  });

  routes.post('/time', idempotent('demo.time', deps.db), async (c) => {
    const input = await parse(c, DemoTimeRequestSchema);
    if (!deps.config.demo.clockEnabled)
      throw ApiProblem.conflict(
        'DEMO_CLOCK_DISABLED',
        'Set DEMO_CLOCK_ENABLED=true to move the demo clock',
      );
    deps.clock.setOffset(input.offsetMinutes * 60_000);
    return ok(c, state());
  });

  routes.post('/payment-behavior', idempotent('demo.payment', deps.db), async (c) => {
    const input = await parse(c, DemoPaymentBehaviorRequestSchema);
    if (!(deps.processor instanceof MockPaymentProcessor))
      throw ApiProblem.conflict(
        'PAYMENT_MODE_NOT_MOCK',
        'Payment behavior can only be scripted for the mock processor',
      );
    paymentBehavior = input;
    deps.processor.setDefaultBehavior(input);
    return ok(c, state());
  });

  return routes;
}
