import { Hono } from 'hono';
import { LinkChatMandateRequestSchema, SendChatMessageRequestSchema } from '@authera/contracts';
import type { Database } from '@authera/db';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { idempotent } from '../../middleware/idempotency.js';
import { requireHuman } from '../../middleware/session.js';
import type { ChatSessionService } from '../../services/chat-session-service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chatId(c: { req: { param: (key: 'id') => string } }): string {
  const id = c.req.param('id');
  if (!UUID.test(id)) throw ApiProblem.notFound('chat');
  return id;
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
}

export function humanChatSessionRoutes(deps: { db: Database; sessions: ChatSessionService }) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.get('/', async (c) => ok(c, await deps.sessions.list(c.get('user')!)));

  routes.post('/', idempotent('chats.create', deps.db), async (c) => {
    const parsed = SendChatMessageRequestSchema.safeParse(await body(c));
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.sessions.create(c.get('user')!, parsed.data.message), 201);
  });

  routes.get('/:id', async (c) => ok(c, await deps.sessions.get(c.get('user')!, chatId(c))));

  routes.post('/:id/messages', idempotent('chats.send', deps.db), async (c) => {
    const parsed = SendChatMessageRequestSchema.safeParse(await body(c));
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.sessions.send(c.get('user')!, chatId(c), parsed.data.message));
  });

  routes.post('/:id/mandate', idempotent('chats.link-mandate', deps.db), async (c) => {
    const parsed = LinkChatMandateRequestSchema.safeParse(await body(c));
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.sessions.linkMandate(c.get('user')!, chatId(c), parsed.data.mandateId));
  });

  routes.post('/:id/revoke', idempotent('chats.revoke', deps.db), async (c) =>
    ok(c, await deps.sessions.revokeMandate(c.get('user')!, chatId(c))),
  );

  return routes;
}
