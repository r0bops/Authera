import { Hono } from 'hono';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem } from '../../http/problem.js';
import { requireHuman } from '../../middleware/session.js';
import type { CheckoutService } from '../../services/checkout-service.js';
import type { ExecutionViews } from '../../services/execution-views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Console read models: executions, merchant verification, catalog (human session). */
export function consoleReadRoutes(deps: { views: ExecutionViews; checkout: CheckoutService }) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.get('/executions/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) throw ApiProblem.notFound('execution');
    return ok(c, await deps.views.execution(id));
  });

  routes.get('/verification/:executionId', async (c) => {
    const id = c.req.param('executionId');
    if (!UUID.test(id)) throw ApiProblem.notFound('execution');
    return ok(c, await deps.views.verification(id));
  });

  routes.get('/offers', async (c) => ok(c, await deps.checkout.listCatalog()));

  return routes;
}
