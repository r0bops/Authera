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
import { bookingConfirmationHtml, paymentReceiptHtml } from '../../services/purchase-documents.js';

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

  routes.get('/purchases/:id/receipt.html', async (c) => {
    const id = purchaseId(c.req.param('id'));
    await requireExecutionAccess(deps.db, c.get('user')!, id);
    const receipt = await purchaseReceipt(
      { db: deps.db, clock: deps.clock, views: deps.views },
      id,
    );
    if (
      receipt.execution.state !== 'SUCCEEDED' ||
      receipt.execution.payment?.state !== 'SUCCEEDED'
    ) {
      throw ApiProblem.conflict('RECEIPT_NOT_AVAILABLE', 'Payment has not completed');
    }
    return htmlDownload(c, paymentReceiptHtml(receipt), `authera-payment-receipt-${id}.html`);
  });

  routes.get('/purchases/:id/booking-confirmation.html', async (c) => {
    const id = purchaseId(c.req.param('id'));
    await requireExecutionAccess(deps.db, c.get('user')!, id);
    const receipt = await purchaseReceipt(
      { db: deps.db, clock: deps.clock, views: deps.views },
      id,
    );
    if (receipt.booking?.state !== 'BOOKED' || receipt.offer?.kind !== 'flight') {
      throw ApiProblem.conflict(
        'BOOKING_DOCUMENT_NOT_AVAILABLE',
        'Flight booking is not confirmed',
      );
    }
    return htmlDownload(
      c,
      bookingConfirmationHtml(receipt),
      `authera-booking-confirmation-${id}.html`,
    );
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

function purchaseId(id: string): string {
  if (!UUID.test(id)) throw ApiProblem.notFound('purchase');
  return id;
}

function htmlDownload(
  c: { body: (body: string, status: 200, headers: Record<string, string>) => Response },
  body: string,
  filename: string,
): Response {
  return c.body(body, 200, {
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'private, no-store',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff',
  });
}
