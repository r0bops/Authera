import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import {
  agentKeys,
  agents,
  humanSessions,
  merchants,
  paymentMethods,
  signingKeys,
  users,
} from '../schema.js';

export type UserRow = typeof users.$inferSelect;
export type MerchantRow = typeof merchants.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type AgentKeyRow = typeof agentKeys.$inferSelect;
export type SigningKeyRow = typeof signingKeys.$inferSelect;
export type PaymentMethodRow = typeof paymentMethods.$inferSelect;
export type SessionRow = typeof humanSessions.$inferSelect;

export async function getUserById(db: DbExecutor, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function getMerchantById(
  db: DbExecutor,
  id: string,
): Promise<MerchantRow | undefined> {
  const [row] = await db.select().from(merchants).where(eq(merchants.id, id));
  return row;
}

export async function getMerchantBySlug(
  db: DbExecutor,
  slug: string,
): Promise<MerchantRow | undefined> {
  const [row] = await db.select().from(merchants).where(eq(merchants.slug, slug));
  return row;
}

export async function getAgentById(db: DbExecutor, id: string): Promise<AgentRow | undefined> {
  const [row] = await db.select().from(agents).where(eq(agents.id, id));
  return row;
}

export async function listAgentsForUser(db: DbExecutor, userId: string): Promise<AgentRow[]> {
  return db.select().from(agents).where(eq(agents.ownerUserId, userId));
}

export async function getAgentKeyByThumbprint(
  db: DbExecutor,
  thumbprint: string,
): Promise<AgentKeyRow | undefined> {
  const [row] = await db.select().from(agentKeys).where(eq(agentKeys.thumbprint, thumbprint));
  return row;
}

export async function getAgentKeyById(
  db: DbExecutor,
  id: string,
): Promise<AgentKeyRow | undefined> {
  const [row] = await db.select().from(agentKeys).where(eq(agentKeys.id, id));
  return row;
}

export async function listAgentKeys(db: DbExecutor, agentId: string): Promise<AgentKeyRow[]> {
  return db.select().from(agentKeys).where(eq(agentKeys.agentId, agentId));
}

export async function setAgentStatus(
  db: DbExecutor,
  agentId: string,
  status: 'ACTIVE' | 'REVOKED',
): Promise<void> {
  await db.update(agents).set({ status }).where(eq(agents.id, agentId));
}

export async function getSigningKeyByKid(
  db: DbExecutor,
  kid: string,
): Promise<SigningKeyRow | undefined> {
  const [row] = await db.select().from(signingKeys).where(eq(signingKeys.kid, kid));
  return row;
}

export async function listSigningKeys(db: DbExecutor, role: string): Promise<SigningKeyRow[]> {
  return db
    .select()
    .from(signingKeys)
    .where(and(eq(signingKeys.role, role), eq(signingKeys.status, 'ACTIVE')));
}

export async function getPaymentMethodById(
  db: DbExecutor,
  id: string,
): Promise<PaymentMethodRow | undefined> {
  const [row] = await db.select().from(paymentMethods).where(eq(paymentMethods.id, id));
  return row;
}

export async function listPaymentMethods(
  db: DbExecutor,
  userId: string,
): Promise<PaymentMethodRow[]> {
  return db.select().from(paymentMethods).where(eq(paymentMethods.userId, userId));
}

export async function createSession(
  db: DbExecutor,
  input: { id: string; userId: string; tokenHash: string; expiresAt: Date },
): Promise<SessionRow> {
  const [row] = await db.insert(humanSessions).values(input).returning();
  if (!row) throw new Error('session insert returned no row');
  return row;
}

export async function getSessionByTokenHash(
  db: DbExecutor,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const [row] = await db.select().from(humanSessions).where(eq(humanSessions.tokenHash, tokenHash));
  return row;
}

export async function revokeSession(db: DbExecutor, id: string): Promise<void> {
  await db.update(humanSessions).set({ revokedAt: new Date() }).where(eq(humanSessions.id, id));
}
