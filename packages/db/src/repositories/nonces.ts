import { randomUUID } from 'node:crypto';
import { lt } from 'drizzle-orm';
import { isUniqueViolation, type DbExecutor } from '../client.js';
import { nonces } from '../schema.js';

export interface InsertNonceInput {
  agentKeyId: string;
  nonce: string;
  requestDigest: string;
  expiresAt: Date;
}

/** Returns true when the nonce was new. A repeat (agent key, nonce) is a replay. */
export async function insertNonce(db: DbExecutor, input: InsertNonceInput): Promise<boolean> {
  try {
    await db.insert(nonces).values({ id: randomUUID(), ...input });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

export async function purgeExpiredNonces(db: DbExecutor, now: Date = new Date()): Promise<number> {
  const result = await db
    .delete(nonces)
    .where(lt(nonces.expiresAt, now))
    .returning({ id: nonces.id });
  return result.length;
}
