import { Hono } from 'hono';
import { SEED_IDS, type Database } from '@agentcerta/db';
import { signRequest, type KeyMaterial } from '@agentcerta/domain';
import type { Clock } from '../../clock.js';
import type { AppConfig } from '../../config.js';
import { fail, type AppEnv } from '../../http/envelope.js';
import { agentDirectory } from '../../services/agent-identity.js';

export const UCP_VERSION = '2026-04-08';

/**
 * Public discovery surface (spec §12):
 * - `/.well-known/http-message-signatures-directory` — the demo agent's signed key directory
 *   (Web Bot Auth). The response itself carries an RFC 9421 signature over `@authority`.
 * - `/agents/:agentId/profile` — the agent's UCP profile, including its signing keys.
 */
export function discoveryRoutes(deps: {
  db: Database;
  keys: KeyMaterial;
  config: AppConfig;
  clock: Clock;
}) {
  const routes = new Hono<AppEnv>();

  routes.get('/.well-known/http-message-signatures-directory', async (c) => {
    const entries = await agentDirectory(deps.db, SEED_IDS.marta);
    const keys = entries.flatMap((e) => e.keys);
    const body = JSON.stringify({ keys });
    const now = deps.clock.now();
    const headers = signRequest(
      { method: 'GET', url: c.req.url, headers: {}, body: new TextEncoder().encode(body) },
      {
        privateJwk: deps.keys.agent.privateJwk,
        keyid: deps.keys.agent.thumbprint,
        tag: 'http-message-signatures-directory',
        nonce: `dir-${now.getTime()}`,
        created: now,
        expires: new Date(now.getTime() + 300_000),
        signatureAgent: entries[0]?.profileUri ?? deps.config.publicBaseUrl,
        ucpAgent: `profile="${entries[0]?.profileUri ?? deps.config.publicBaseUrl}"`,
        components: ['@authority', 'content-digest'],
      },
    );
    return c.body(body, 200, {
      'content-type': 'application/http-message-signatures-directory+json',
      'cache-control': 'public, max-age=300',
      'content-digest': headers['content-digest'],
      'signature-input': headers['signature-input'],
      signature: headers.signature,
    });
  });

  routes.get('/agents/:agentId/profile', async (c) => {
    const agentId = c.req.param('agentId');
    const entry = (await agentDirectory(deps.db, SEED_IDS.marta)).find(
      (e) => e.agentId === agentId,
    );
    if (!entry) return fail(c, 404, 'NOT_FOUND', 'agent profile not found');
    c.header('cache-control', 'public, max-age=300');
    return c.json({
      ucp: { version: UCP_VERSION },
      id: entry.profileUri,
      agentId: entry.agentId,
      name: entry.displayName,
      status: entry.status,
      signature_agent: entry.profileUri,
      keys: entry.keys,
      capabilities: ['agentcerta.mandate.v1', 'ucp.checkout'],
      gateway: `${deps.config.publicBaseUrl}/api/purchase-attempts`,
    });
  });

  return routes;
}
