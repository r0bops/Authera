import { Hono } from 'hono';
import { ProductSearchQuerySchema } from '@authera/contracts';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import type { CheckoutService } from '../../services/checkout-service.js';

/** GET /api/products — signed agent search over server-owned goods offers (live storefront). */
export function productRoutes(deps: { checkout: CheckoutService }) {
  const routes = new Hono<AppEnv>();
  routes.get('/', async (c) => {
    const parsed = ProductSearchQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.checkout.searchProducts(parsed.data));
  });
  return routes;
}
