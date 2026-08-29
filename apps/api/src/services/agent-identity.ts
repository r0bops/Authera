import {
  appendAuditEvent,
  getAgentById,
  getAgentKeyByThumbprint,
  insertNonce,
  listAgents,
  listAgentKeys,
  type AppendAuditEventInput,
  type Database,
} from '@authera/db';
import type { Ed25519PublicJwk } from '@authera/domain';

export interface ResolvedAgentKey {
  agentId: string;
  agentKeyId: string;
  thumbprint: string;
  publicJwk: Ed25519PublicJwk;
  keyStatus: 'ACTIVE' | 'REVOKED';
  agentStatus: 'ACTIVE' | 'REVOKED';
  validFrom: Date;
  validUntil: Date | null;
  profileUri: string;
  displayName: string;
}

/**
 * What the signature middleware needs from persistence. P0 uses pinned local discovery:
 * keys and profiles live in PostgreSQL (spec §11); remote profile fetching is P1.
 */
export interface AgentIdentityStore {
  findKey(thumbprint: string): Promise<ResolvedAgentKey | undefined>;
  /** true when the nonce is new for this key; false on replay. */
  claimNonce(input: {
    agentKeyId: string;
    nonce: string;
    requestDigest: string;
    expiresAt: Date;
  }): Promise<boolean>;
  audit(event: AppendAuditEventInput): Promise<void>;
}

export function databaseAgentIdentityStore(db: Database): AgentIdentityStore {
  return {
    async findKey(thumbprint) {
      const key = await getAgentKeyByThumbprint(db, thumbprint);
      if (!key) return undefined;
      const agent = await getAgentById(db, key.agentId);
      if (!agent) return undefined;
      return {
        agentId: agent.id,
        agentKeyId: key.id,
        thumbprint: key.thumbprint,
        publicJwk: key.publicJwk as unknown as Ed25519PublicJwk,
        keyStatus: key.status as 'ACTIVE' | 'REVOKED',
        agentStatus: agent.status as 'ACTIVE' | 'REVOKED',
        validFrom: key.validFrom,
        validUntil: key.validUntil,
        profileUri: agent.profileUri,
        displayName: agent.displayName,
      };
    },
    claimNonce: (input) => insertNonce(db, input),
    async audit(event) {
      await db.transaction((tx) => appendAuditEvent(tx, event));
    },
  };
}

export interface AgentDirectoryEntry {
  agentId: string;
  displayName: string;
  status: string;
  profileUri: string;
  keys: Ed25519PublicJwk[];
}

/** Public key directory data for `/.well-known/http-message-signatures-directory` and profiles. */
export async function agentDirectory(db: Database, now: Date): Promise<AgentDirectoryEntry[]> {
  const agentRows = await listAgents(db);
  return Promise.all(
    agentRows.map(async (agent) => ({
      agentId: agent.id,
      displayName: agent.displayName,
      status: agent.status,
      profileUri: agent.profileUri,
      keys: (await listAgentKeys(db, agent.id))
        .filter(
          (key) =>
            agent.status === 'ACTIVE' &&
            key.status === 'ACTIVE' &&
            key.validFrom <= now &&
            (!key.validUntil || key.validUntil > now),
        )
        .map((k) => k.publicJwk as unknown as Ed25519PublicJwk),
    })),
  );
}
