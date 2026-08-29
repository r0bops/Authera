import { Hono } from 'hono';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ApiProblem } from '../../http/problem.js';
import type { MandateGateway } from '../../services/gateway.js';

/** POST /api/purchase-attempts — the full Mandate Gateway, behind the payment-tag signature. */
export function purchaseAttemptRoutes(deps: { gateway: MandateGateway }) {
  const routes = new Hono<AppEnv>();
  routes.post('/', async (c) => {
    const request = c.get('agentRequest');
    if (!request) throw ApiProblem.unauthenticated();
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(request.rawBody));
    } catch {
      throw new ApiProblem(400, 'INVALID_JSON', 'Request body must be valid JSON');
    }
    const response = await deps.gateway.attempt(
      {
        agentId: request.agent.agentId,
        agentKeyId: request.agent.agentKeyId,
        keyThumbprint: request.agent.thumbprint,
        profileUri: request.agent.profileUri,
        nonce: request.nonce,
        requestDigest: request.requestDigest,
      },
      body,
    );
    const status =
      response.decision === 'ALLOW' ? 200 : response.decision === 'REQUIRE_HUMAN' ? 202 : 403;
    return ok(c, response, status);
  });
  return routes;
}
