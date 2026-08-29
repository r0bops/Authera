import { Hono } from 'hono';
import { z } from 'zod';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { requireHuman } from '../../middleware/session.js';
import type { MockPaymentProcessor } from '../../services/payments/mock-processor.js';
import type { PaymentService } from '../../services/payments/payment-service.js';
import {
  WebhookVerificationError,
  type PaymentProcessor,
} from '../../services/payments/processor.js';

const MAX_WEBHOOK_BYTES = 256 * 1024;

const MockWebhookRequestSchema = z.strictObject({
  outcome: z.enum(['succeeded', 'failed', 'pending']),
  eventId: z.string().min(1).max(120).optional(),
  amountMinor: z.number().int().min(0).optional(),
  currency: z.enum(['USD', 'MXN', 'COP', 'BRL', 'ARS']).optional(),
});

/** `POST /webhooks/yuno` — raw-body HMAC verification happens inside the adapter before JSON parsing. */
export function providerWebhookRoutes(deps: {
  processor: PaymentProcessor;
  payments: PaymentService;
}) {
  const routes = new Hono<AppEnv>();
  routes.post('/yuno', async (c) => {
    if (deps.processor.provider !== 'yuno')
      throw ApiProblem.notFound('yuno webhook (PAYMENT_MODE is not yuno)');
    const raw = new Uint8Array(await c.req.arrayBuffer());
    if (raw.byteLength > MAX_WEBHOOK_BYTES)
      throw new ApiProblem(413, 'PAYLOAD_TOO_LARGE', 'Webhook body too large');
    let event;
    try {
      event = await deps.processor.parseWebhook(raw, c.req.raw.headers);
    } catch (error) {
      if (error instanceof WebhookVerificationError)
        throw new ApiProblem(401, 'WEBHOOK_UNVERIFIED', error.message);
      throw error;
    }
    const outcome = await deps.payments.handleWebhook(event);
    return ok(c, { outcome });
  });
  return routes;
}

/**
 * `POST /webhooks/mock/:executionId` — demo-only simulated provider event (spec §12). Mounted only
 * when the mock processor is active and demo mode is on; requires the human console session.
 */
export function mockWebhookRoutes(deps: {
  processor: MockPaymentProcessor;
  payments: PaymentService;
}) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());
  routes.post('/mock/:executionId', async (c) => {
    const executionId = c.req.param('executionId');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const parsed = MockWebhookRequestSchema.safeParse(raw);
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    const known = deps.processor.resultFor(executionId);
    const event = deps.processor.buildEvent({
      executionId,
      amount: { currency: parsed.data.currency ?? 'USD', minor: parsed.data.amountMinor ?? 0 },
      type:
        parsed.data.outcome === 'succeeded'
          ? 'PAYMENT_SUCCEEDED'
          : parsed.data.outcome === 'failed'
            ? 'PAYMENT_FAILED'
            : 'PAYMENT_PENDING',
      ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : {}),
      ...(known ? { providerPaymentId: known.providerPaymentId } : {}),
    });
    const outcome = await deps.payments.handleWebhook(event);
    return ok(c, { outcome, event });
  });
  return routes;
}
