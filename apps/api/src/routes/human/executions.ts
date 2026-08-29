import { Hono } from 'hono';
import { AuditQuerySchema, ExecutionListQuerySchema } from '@agentcerta/contracts';
import { listAuditEvents, listMandatesForUser, type Database } from '@agentcerta/db';
import type { Clock } from '../../clock.js';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { requireHuman } from '../../middleware/session.js';
import type { CheckoutService } from '../../services/checkout-service.js';
import {
  listExecutionSummaries,
  purchaseReceipt,
  type ExecutionViews,
} from '../../services/execution-views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Console read models: executions, merchant verification, catalog (human session). */
export function consoleReadRoutes(deps: {
  db: Database;
  clock: Clock;
  views: ExecutionViews;
  checkout: CheckoutService;
}) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.get('/executions', async (c) => {
    const parsed = ExecutionListQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await listExecutionSummaries({ db: deps.db }, parsed.data));
  });

  routes.get('/audit/events', async (c) => {
    const parsed = AuditQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await listAuditEvents(deps.db, parsed.data));
  });

  routes.get('/purchases', async (c) => {
    const user = c.get('user')!;
    const mandateIds = new Set(
      (await listMandatesForUser(deps.db, user.id)).map((m) => m.mandate.id),
    );
    const all = await listExecutionSummaries({ db: deps.db }, { limit: 200 });
    return ok(
      c,
      all.filter(
        (e) =>
          e.mandateId &&
          mandateIds.has(e.mandateId) &&
          (e.state === 'SUCCEEDED' || e.state === 'PAYMENT_PENDING' || e.state === 'FAILED'),
      ),
    );
  });

  routes.get('/purchases/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) throw ApiProblem.notFound('purchase');
    return ok(c, await purchaseReceipt({ db: deps.db, clock: deps.clock, views: deps.views }, id));
  });

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
