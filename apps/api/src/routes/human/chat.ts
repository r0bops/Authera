import { Hono } from 'hono';
import { MandateChatRequestSchema } from '@authera/contracts';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem, formatZodIssues } from '../../http/problem.js';
import { requireHuman } from '../../middleware/session.js';
import type { MandateChatService } from '../../services/mandate-chat.js';

export function humanChatRoutes(deps: { chat: MandateChatService }) {
  const routes = new Hono<AppEnv>();
  routes.use('*', requireHuman());

  routes.post('/interpret', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const parsed = MandateChatRequestSchema.safeParse(raw);
    if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
    return ok(c, await deps.chat.interpret(parsed.data));
  });

  return routes;
}
