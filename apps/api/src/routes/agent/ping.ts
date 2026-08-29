import { Hono } from 'hono';
import { ok, type AppEnv } from '../../http/envelope.js';

/** Protected no-op behind the signature middleware (Phase 4 acceptance route). */
export function agentPingRoutes() {
  const routes = new Hono<AppEnv>();
  routes.post('/ping', (c) => {
    const request = c.get('agentRequest')!;
    return ok(c, {
      agentId: request.agent.agentId,
      keyThumbprint: request.agent.thumbprint,
      nonce: request.nonce,
      requestDigest: request.requestDigest,
      tag: request.tag,
    });
  });
  return routes;
}
