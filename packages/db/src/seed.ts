import { sql } from 'drizzle-orm';
import type { Ed25519PublicJwk } from '@authera/domain';
import type { Database, DbExecutor } from './client.js';
import {
  agentKeys,
  agents,
  merchants,
  offers,
  paymentMethods,
  signingKeys,
  users,
} from './schema.js';
import {
  SEED_AGENT,
  SEED_IDS,
  SEED_MERCHANTS,
  SEED_OFFERS,
  SEED_OFFER_EXPIRY,
  SEED_PAYMENT_METHOD,
  SEED_USER,
} from './seed-data.js';

export interface SeedKeys {
  trustedSurface: { kid: string; publicJwk: Ed25519PublicJwk };
  merchant: { kid: string; publicJwk: Ed25519PublicJwk };
  agent: { thumbprint: string; publicJwk: Ed25519PublicJwk };
}

export interface SeedInput {
  keys: SeedKeys;
  publicBaseUrl: string;
}

/** Idempotent demo seed: safe to run on every start and after every reset. */
export async function seedDemo(db: DbExecutor, input: SeedInput): Promise<void> {
  await db.insert(users).values(SEED_USER).onConflictDoNothing();
  await db
    .insert(merchants)
    .values(SEED_MERCHANTS)
    .onConflictDoUpdate({
      target: merchants.id,
      set: {
        displayName: sql`excluded.display_name`,
        market: sql`excluded.market`,
        status: 'ACTIVE',
      },
    });
  await db
    .insert(agents)
    .values({
      id: SEED_AGENT.id,
      ownerUserId: SEED_USER.id,
      displayName: SEED_AGENT.displayName,
      status: 'ACTIVE',
      profileUri: `${input.publicBaseUrl}/agents/${SEED_AGENT.id}/profile`,
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        status: 'ACTIVE',
        profileUri: `${input.publicBaseUrl}/agents/${SEED_AGENT.id}/profile`,
      },
    });
  await db
    .insert(agentKeys)
    .values({
      id: SEED_IDS.agentKey,
      agentId: SEED_AGENT.id,
      thumbprint: input.keys.agent.thumbprint,
      publicJwk: input.keys.agent.publicJwk as unknown as Record<string, string>,
      status: 'ACTIVE',
    })
    .onConflictDoUpdate({
      target: agentKeys.id,
      set: {
        thumbprint: input.keys.agent.thumbprint,
        publicJwk: input.keys.agent.publicJwk as unknown as Record<string, string>,
        status: 'ACTIVE',
      },
    });
  await db
    .insert(signingKeys)
    .values([
      {
        id: SEED_IDS.trustedSurfaceKey,
        role: 'trusted_surface',
        kid: input.keys.trustedSurface.kid,
        publicJwk: input.keys.trustedSurface.publicJwk as unknown as Record<string, string>,
      },
      {
        id: SEED_IDS.merchantKey,
        role: 'merchant',
        kid: input.keys.merchant.kid,
        publicJwk: input.keys.merchant.publicJwk as unknown as Record<string, string>,
      },
    ])
    .onConflictDoUpdate({
      target: signingKeys.id,
      set: { kid: sql`excluded.kid`, publicJwk: sql`excluded.public_jwk`, status: 'ACTIVE' },
    });
  await db
    .insert(paymentMethods)
    .values({ ...SEED_PAYMENT_METHOD, userId: SEED_USER.id })
    .onConflictDoNothing();
  await db
    .insert(offers)
    .values(
      SEED_OFFERS.map((offer) => ({
        ...offer,
        departureAt: new Date(offer.departureAt),
        arrivalAt: new Date(offer.arrivalAt),
        expiresAt: new Date(SEED_OFFER_EXPIRY),
        status: 'AVAILABLE',
        source: 'seed',
      })),
    )
    .onConflictDoNothing();
}

const ALL_TABLES = [
  'audit_events',
  'audit_chain_heads',
  'disputes',
  'webhook_events',
  'payments',
  'approval_requests',
  'reservations',
  'executions',
  'idempotency_records',
  'nonces',
  'checkouts',
  'offers',
  'mandate_runtime',
  'mandate_versions',
  'mandates',
  'payment_methods',
  'signing_keys',
  'agent_keys',
  'agents',
  'merchants',
  'webauthn_credentials',
  'human_sessions',
  'users',
];

/** Wipe every application table and restore the deterministic seed in one transaction. */
export async function resetDemo(db: Database, input: SeedInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        `TRUNCATE TABLE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
      ),
    );
    await seedDemo(tx, input);
  });
}
