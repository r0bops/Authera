import { Hono } from 'hono';
import {
  CreateMandateRequestSchema,
  ReviseMandateRequestSchema,
  RevokeMandateRequestSchema,
} from '@authera/contracts';
import type { Database } from '@authera/db';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { idempotent } from '../../middleware/idempotency.js';
import { requireHuman } from '../../middleware/session.js';
import type { MandateService } from '../../services/mandate-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function parseBody<T>(
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
    throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
  return parsed.data;
}

function mandateId(c: { req: { param: (k: 'id') => string } }): string {
  const id = c.req.param('id');
  if (!UUID.test(id)) throw ApiProblem.notFound('mandate');
  return id;
}

export function humanMandateRoutes(deps: { db: Database; mandates: MandateService }) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.get('/', async (c) => ok(c, await deps.mandates.list(c.get('user')!)));

  routes.post('/', idempotent('mandates.create', deps.db), async (c) => {
    const input = await parseBody(c, CreateMandateRequestSchema);
    return ok(c, await deps.mandates.create(c.get('user')!, input), 201);
  });

  routes.get('/:id', async (c) => ok(c, await deps.mandates.get(c.get('user')!, mandateId(c))));

  routes.post('/:id/revoke', idempotent('mandates.revoke', deps.db), async (c) => {
    const input = await parseBody(c, RevokeMandateRequestSchema);
    return ok(c, await deps.mandates.revoke(c.get('user')!, mandateId(c), input.reason));
  });

  routes.post('/:id/revise', idempotent('mandates.revise', deps.db), async (c) => {
    const input = await parseBody(c, ReviseMandateRequestSchema);
    return ok(c, await deps.mandates.revise(c.get('user')!, mandateId(c), input), 201);
  });

  return routes;
}
