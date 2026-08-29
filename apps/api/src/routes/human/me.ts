import { Hono } from 'hono';
import type { MeResponse } from '@authera/contracts';
import { listAgentKeys, listAgentsForUser, listMerchants, listPaymentMethods } from '@authera/db';
import { ok, type AppEnv } from '../../http/envelope.js';
import { ensureHuman, type SessionDependencies } from '../../middleware/session.js';

/** GET /api/me — current (or, in demo mode, auto-issued) human session and their resources. */
export function meRoutes(deps: SessionDependencies) {
  const routes = new Hono<AppEnv>();
  routes.get('/', async (c) => {
    const { user, session } = await ensureHuman(c, deps);
    const agents = await listAgentsForUser(deps.db, user.id);
    const agentViews = await Promise.all(
      agents.map(async (agent) => {
        const keys = (await listAgentKeys(deps.db, agent.id)).filter((k) => k.status === 'ACTIVE');
        return {
          id: agent.id,
          displayName: agent.displayName,
          status: agent.status as 'ACTIVE' | 'REVOKED',
          keyThumbprint: keys[0]?.thumbprint ?? null,
        };
      }),
    );
    const paymentMethods = (await listPaymentMethods(deps.db, user.id)).map((pm) => ({
      id: pm.id,
      provider: pm.provider,
      brand: pm.displayBrand,
      last4: pm.displayLast4,
    }));
    const merchants = (await listMerchants(deps.db)).map((m) => ({
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      market: m.market,
    }));
    const body: MeResponse = {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      agents: agentViews,
      paymentMethods,
      merchants,
      demoMode: deps.config.demo.enabled,
      session: { expiresAt: session.expiresAt.toISOString() },
    };
    return ok(c, body);
  });
  return routes;
}
