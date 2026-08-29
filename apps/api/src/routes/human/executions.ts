import { Hono } from 'hono';
import { AuditQuerySchema, ExecutionListQuerySchema } from '@authera/contracts';
import { listAuditEventsForUser, type Database } from '@authera/db';
import type { Clock } from '../../clock.js';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { requireHuman } from '../../middleware/session.js';
import { requireExecutionAccess } from '../../services/access-control.js';
import type { CheckoutService } from '../../services/checkout-service.js';
import {
  listExecutionSummaries,
  purchaseReceipt,
  type ExecutionViews,
} from '../../services/execution-views.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return ok(
      c,
      await listExecutionSummaries({ db: deps.db, userId: c.get('user')!.id }, parsed.data),
    );
  });

  routes.get('/audit/events', async (c) => {
    const parsed = AuditQuerySchema.safeParse(c.req.query());
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await listAuditEventsForUser(deps.db, c.get('user')!.id, parsed.data));
  });

  routes.get('/purchases', async (c) => {
    const all = await listExecutionSummaries(
      { db: deps.db, userId: c.get('user')!.id },
      { limit: 200 },
    );
    return ok(
      c,
      all.filter(
        (e) => e.state === 'SUCCEEDED' || e.state === 'PAYMENT_PENDING' || e.state === 'FAILED',
      ),
    );
  });

  routes.get('/purchases/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) throw ApiProblem.notFound('purchase');
    await requireExecutionAccess(deps.db, c.get('user')!, id);
    return ok(c, await purchaseReceipt({ db: deps.db, clock: deps.clock, views: deps.views }, id));
  });

  routes.get('/executions/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) throw ApiProblem.notFound('execution');
    await requireExecutionAccess(deps.db, c.get('user')!, id);
    return ok(c, await deps.views.execution(id));
  });

  routes.get('/verification/:executionId', async (c) => {
    const id = c.req.param('executionId');
    if (!UUID.test(id)) throw ApiProblem.notFound('execution');
    await requireExecutionAccess(deps.db, c.get('user')!, id);
    return ok(c, await deps.views.verification(id));
  });

  routes.get('/offers', async (c) => ok(c, await deps.checkout.listCatalog()));

  return routes;
}
