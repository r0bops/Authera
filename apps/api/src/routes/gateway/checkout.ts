import { Hono } from 'hono';
import { CreateCheckoutSessionRequestSchema } from '@authera/contracts';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import type { CheckoutService } from '../../services/checkout-service.js';

/**
 * Checkout lifecycle under /ucp/v1 (signed agent lane). The session shape is pinned to
 * UCP 2026-04-08 semantics in Phase 10; the merchant-signed cart hash is authoritative now.
 */
export function checkoutRoutes(deps: { checkout: CheckoutService }) {
  const routes = new Hono<AppEnv>();

  routes.post('/checkout-sessions', async (c) => {
    const request = c.get('agentRequest');
    const raw = request ? new TextDecoder().decode(request.rawBody) : await c.req.text();
    let body: unknown;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const parsed = CreateCheckoutSessionRequestSchema.safeParse(body);
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.checkout.createSession(parsed.data), 201);
  });

  routes.get('/checkout-sessions/:id', async (c) => {
    const session = await deps.checkout.getSession(c.req.param('id'));
    if (!session) throw ApiProblem.notFound('checkout session');
    return ok(c, session);
  });

  return routes;
}
