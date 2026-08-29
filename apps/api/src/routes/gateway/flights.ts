import { Hono } from 'hono';
import { FlightSearchQuerySchema } from '@authera/contracts';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import type { CheckoutService } from '../../services/checkout-service.js';

/** GET /api/flights — signed agent search over server-owned offers. Returns ids and summaries. */
export function flightRoutes(deps: { checkout: CheckoutService }) {
  const routes = new Hono<AppEnv>();
  routes.get('/', async (c) => {
    const parsed = FlightSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.checkout.searchFlights(parsed.data));
  });
  return routes;
}
