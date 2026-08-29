import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  MandatePolicyV1Schema,
  type MandatePolicyV1,
  type MandateState,
} from '@agentcerta/contracts';
import type { Database, DbExecutor } from '../client.js';
import { mandateRuntime, mandateVersions, mandates } from '../schema.js';
import { appendAuditEvent } from './audit.js';

export type MandateRow = typeof mandates.$inferSelect;
export type MandateVersionRow = typeof mandateVersions.$inferSelect;
export type MandateRuntimeRow = typeof mandateRuntime.$inferSelect;

export class MandateStateError extends Error {
  constructor(
    readonly mandateId: string,
    readonly status: string,
    message: string,
  ) {
    super(message);
    this.name = 'MandateStateError';
  }
}

export interface SignedPolicy {
  policy: MandatePolicyV1;
  policyHash: string;
  jws: string;
  signingKid: string;
}

export interface CreateMandateInput extends SignedPolicy {
  actorId: string;
}

export interface MandateAggregate {
  mandate: MandateRow;
  version: MandateVersionRow;
  runtime: MandateRuntimeRow;
  policy: MandatePolicyV1;
  versions: MandateVersionRow[];
}

function runtimeValuesFromPolicy(policy: MandatePolicyV1) {
  return {
    validFrom: new Date(policy.validFrom),
    validUntil: new Date(policy.validUntil),
    currency: policy.limits.currency,
    maxPerPurchaseMinor: policy.limits.maxPerPurchaseMinor,
    maxTotalMinor: policy.limits.maxTotalMinor,
    maxFulfillments: policy.limits.maxFulfillments,
  };
}

/** Validate, store, and activate a signed mandate atomically (spec Phase 3 acceptance). */
export async function createMandate(
  db: Database,
  input: CreateMandateInput,
): Promise<MandateAggregate> {
  const policy = MandatePolicyV1Schema.parse(input.policy);
  if (policy.version !== 1)
    throw new MandateStateError(policy.mandateId, 'DRAFT', 'new mandates start at version 1');
  return db.transaction(async (tx) => {
    const [mandate] = await tx
      .insert(mandates)
      .values({
        id: policy.mandateId,
        userId: policy.humanId,
        agentId: policy.agentId,
        currentVersion: 1,
      })
      .returning();
    const [version] = await tx
      .insert(mandateVersions)
      .values({
        id: randomUUID(),
        mandateId: policy.mandateId,
        version: 1,
        policy: policy as unknown as Record<string, unknown>,
        policyHash: input.policyHash,
        jws: input.jws,
        signingKid: input.signingKid,
      })
      .returning();
    const [runtime] = await tx
      .insert(mandateRuntime)
      .values({
        id: randomUUID(),
        mandateId: policy.mandateId,
        version: 1,
        status: 'ACTIVE',
        ...runtimeValuesFromPolicy(policy),
      })
      .returning();
    if (!mandate || !version || !runtime) throw new Error('mandate insert returned no rows');

    await appendAuditEvent(tx, {
      eventType: 'MANDATE_CREATED',
      actorType: 'HUMAN',
      actorId: input.actorId,
      mandateId: policy.mandateId,
      mandateVersion: 1,
      payload: { policyHash: input.policyHash, signingKid: input.signingKid },
    });
    await appendAuditEvent(tx, {
      eventType: 'MANDATE_ACTIVATED',
      actorType: 'HUMAN',
      actorId: input.actorId,
      mandateId: policy.mandateId,
      mandateVersion: 1,
      detail: `valid until ${policy.validUntil}`,
      payload: {
        validFrom: policy.validFrom,
        validUntil: policy.validUntil,
        limits: policy.limits,
      },
    });
    return { mandate, version, runtime, policy, versions: [version] };
  });
}

export interface ReviseMandateInput extends SignedPolicy {
  actorId: string;
}

/**
 * Replace the active version: the old runtime row becomes SUPERSEDED and a new version +
 * runtime become ACTIVE in the same transaction. Historical signed evidence is never mutated.
 */
export async function reviseMandate(
  db: Database,
  input: ReviseMandateInput,
): Promise<MandateAggregate> {
  const policy = MandatePolicyV1Schema.parse(input.policy);
  return db.transaction(async (tx) => {
    const [mandate] = await tx
      .select()
      .from(mandates)
      .where(eq(mandates.id, policy.mandateId))
      .for('update');
    if (!mandate) throw new MandateStateError(policy.mandateId, 'MISSING', 'mandate not found');
    if (policy.version !== mandate.currentVersion + 1) {
      throw new MandateStateError(
        policy.mandateId,
        'VERSION',
        `expected version ${mandate.currentVersion + 1}`,
      );
    }
    const [current] = await tx
      .select()
      .from(mandateRuntime)
      .where(
        and(
          eq(mandateRuntime.mandateId, policy.mandateId),
          eq(mandateRuntime.version, mandate.currentVersion),
        ),
      )
      .for('update');
    if (!current || current.status !== 'ACTIVE') {
      throw new MandateStateError(
        policy.mandateId,
        current?.status ?? 'MISSING',
        'only an ACTIVE mandate can be revised',
      );
    }
    await tx
      .update(mandateRuntime)
      .set({ status: 'SUPERSEDED', updatedAt: sql`now()` })
      .where(eq(mandateRuntime.id, current.id));
    const [version] = await tx
      .insert(mandateVersions)
      .values({
        id: randomUUID(),
        mandateId: policy.mandateId,
        version: policy.version,
        policy: policy as unknown as Record<string, unknown>,
        policyHash: input.policyHash,
        jws: input.jws,
        signingKid: input.signingKid,
      })
      .returning();
    const [runtime] = await tx
      .insert(mandateRuntime)
      .values({
        id: randomUUID(),
        mandateId: policy.mandateId,
        version: policy.version,
        status: 'ACTIVE',
        ...runtimeValuesFromPolicy(policy),
      })
      .returning();
    const [updated] = await tx
      .update(mandates)
      .set({ currentVersion: policy.version })
      .where(eq(mandates.id, policy.mandateId))
      .returning();
    if (!version || !runtime || !updated) throw new Error('revision insert returned no rows');
    await appendAuditEvent(tx, {
      eventType: 'MANDATE_REVISED',
      actorType: 'HUMAN',
      actorId: input.actorId,
      mandateId: policy.mandateId,
      mandateVersion: policy.version,
      detail: `version ${mandate.currentVersion} superseded by ${policy.version}`,
      payload: { supersededVersion: mandate.currentVersion, policyHash: input.policyHash },
    });
    const versions = await tx
      .select()
      .from(mandateVersions)
      .where(eq(mandateVersions.mandateId, policy.mandateId))
      .orderBy(desc(mandateVersions.version));
    return { mandate: updated, version, runtime, policy, versions };
  });
}

export interface RevokeMandateInput {
  mandateId: string;
  reason?: string;
  actorId: string;
}

export interface RevokeResult {
  status: MandateState;
  revokedAt: Date | null;
  /** true when this call performed the revocation; false when it was already terminal. */
  changed: boolean;
}

/**
 * Revocation updates the same `mandate_runtime` row the reservation predicate reads, so
 * PostgreSQL row locking orders the race (spec §10). Idempotent: repeating returns the state.
 */
export async function revokeMandate(
  db: Database,
  input: RevokeMandateInput,
): Promise<RevokeResult> {
  return db.transaction(async (tx) => {
    const [mandate] = await tx.select().from(mandates).where(eq(mandates.id, input.mandateId));
    if (!mandate) throw new MandateStateError(input.mandateId, 'MISSING', 'mandate not found');
    const [updated] = await tx
      .update(mandateRuntime)
      .set({
        status: 'REVOKED',
        revokedAt: sql`now()`,
        revokeReason: input.reason ?? null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mandateRuntime.mandateId, input.mandateId),
          eq(mandateRuntime.version, mandate.currentVersion),
          eq(mandateRuntime.status, 'ACTIVE'),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await tx
        .select()
        .from(mandateRuntime)
        .where(
          and(
            eq(mandateRuntime.mandateId, input.mandateId),
            eq(mandateRuntime.version, mandate.currentVersion),
          ),
        );
      return {
        status: (current?.status ?? 'REVOKED') as MandateState,
        revokedAt: current?.revokedAt ?? null,
        changed: false,
      };
    }
    await appendAuditEvent(tx, {
      eventType: 'MANDATE_REVOKED',
      actorType: 'HUMAN',
      actorId: input.actorId,
      mandateId: input.mandateId,
      mandateVersion: mandate.currentVersion,
      detail: input.reason ? `reason: ${input.reason}` : undefined,
      payload: {
        reason: input.reason ?? null,
        revokedAt: updated.revokedAt?.toISOString() ?? null,
      },
    });
    return { status: 'REVOKED', revokedAt: updated.revokedAt, changed: true };
  });
}

export async function getMandate(
  db: DbExecutor,
  mandateId: string,
): Promise<MandateAggregate | undefined> {
  const [mandate] = await db.select().from(mandates).where(eq(mandates.id, mandateId));
  if (!mandate) return undefined;
  const versions = await db
    .select()
    .from(mandateVersions)
    .where(eq(mandateVersions.mandateId, mandateId))
    .orderBy(desc(mandateVersions.version));
  const version = versions.find((v) => v.version === mandate.currentVersion);
  const [runtime] = await db
    .select()
    .from(mandateRuntime)
    .where(
      and(
        eq(mandateRuntime.mandateId, mandateId),
        eq(mandateRuntime.version, mandate.currentVersion),
      ),
    );
  if (!version || !runtime) return undefined;
  return {
    mandate,
    version,
    runtime,
    policy: MandatePolicyV1Schema.parse(version.policy),
    versions,
  };
}

export async function getMandateVersion(
  db: DbExecutor,
  mandateId: string,
  version: number,
): Promise<
  { version: MandateVersionRow; runtime: MandateRuntimeRow; policy: MandatePolicyV1 } | undefined
> {
  const [row] = await db
    .select()
    .from(mandateVersions)
    .where(and(eq(mandateVersions.mandateId, mandateId), eq(mandateVersions.version, version)));
  const [runtime] = await db
    .select()
    .from(mandateRuntime)
    .where(and(eq(mandateRuntime.mandateId, mandateId), eq(mandateRuntime.version, version)));
  if (!row || !runtime) return undefined;
  return { version: row, runtime, policy: MandatePolicyV1Schema.parse(row.policy) };
}

export async function listMandatesForUser(
  db: DbExecutor,
  userId: string,
): Promise<MandateAggregate[]> {
  const rows = await db
    .select()
    .from(mandates)
    .where(eq(mandates.userId, userId))
    .orderBy(desc(mandates.createdAt));
  const result: MandateAggregate[] = [];
  for (const row of rows) {
    const aggregate = await getMandate(db, row.id);
    if (aggregate) result.push(aggregate);
  }
  return result;
}
