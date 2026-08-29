import { randomUUID } from 'node:crypto';
import type {
  CreateMandateRequest,
  MandatePolicyV1,
  MandateState,
  MandateView,
  ReviseMandateRequest,
} from '@authera/contracts';
import { MandatePolicyV1Schema } from '@authera/contracts';
import {
  createMandate,
  getAgentById,
  getMandate,
  getPaymentMethodById,
  listAgentKeys,
  listAuditEvents,
  listMandatesForUser,
  listMerchants,
  MandateStateError,
  reviseMandate,
  revokeMandate,
  type Database,
  type MandateAggregate,
  type UserRow,
} from '@authera/db';
import { describeMandatePolicy } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem, formatZodIssues } from '../http/problem.js';
import type { Logger } from '../logger.js';
import type { MandateSigner } from './mandate-signer.js';

export interface MandateServiceDependencies {
  db: Database;
  signer: MandateSigner;
  clock: Clock;
  logger: Logger;
}

export class MandateService {
  constructor(private readonly deps: MandateServiceDependencies) {}

  async create(user: UserRow, input: CreateMandateRequest): Promise<MandateView> {
    const { db, signer, clock } = this.deps;
    const now = clock.now();

    const agentId = input.agentId ?? (await this.defaultAgentId(user));
    const agent = await getAgentById(db, agentId);
    if (!agent || agent.ownerUserId !== user.id) throw ApiProblem.notFound('agent');
    if (agent.status !== 'ACTIVE')
      throw ApiProblem.conflict('AGENT_REVOKED', 'The agent is revoked');
    const keys = (await listAgentKeys(db, agent.id)).filter((k) => k.status === 'ACTIVE');
    const key = keys[0];
    if (!key) throw ApiProblem.conflict('AGENT_KEY_MISSING', 'The agent has no active signing key');

    const paymentMethod = await getPaymentMethodById(db, input.paymentMethodId);
    if (!paymentMethod || paymentMethod.userId !== user.id)
      throw ApiProblem.notFound('payment method');

    const merchants = await listMerchants(db);
    const allowedMerchantIds = input.allowedMerchantIds ?? merchants.map((m) => m.id);
    const unknown = allowedMerchantIds.filter((id) => !merchants.some((m) => m.id === id));
    if (unknown.length > 0)
      throw ApiProblem.validation([
        { path: 'allowedMerchantIds', message: `unknown merchant(s): ${unknown.join(', ')}` },
      ]);

    if (Date.parse(input.validUntil) <= now.getTime()) {
      throw ApiProblem.validation([{ path: 'validUntil', message: 'must be in the future' }]);
    }

    const candidate = {
      schema: 'authera.mandate.v1' as const,
      mandateId: randomUUID(),
      version: 1,
      humanId: user.id,
      agentId: agent.id,
      agentKeyThumbprint: key.thumbprint,
      allowedMerchantIds,
      // Opaque reference; the raw token never enters the policy or any view.
      paymentMethodRef: paymentMethod.id,
      intent: input.intent,
      limits: input.limits,
      validFrom: now.toISOString(),
      validUntil: input.validUntil,
      escalation: input.escalation,
    };
    const policy = parsePolicy(candidate);
    const signed = await signer.sign(policy, now);
    const aggregate = await createMandate(db, {
      policy,
      policyHash: signed.policyHash,
      jws: signed.jws,
      signingKid: signed.kid,
      actorId: user.id,
    });
    this.deps.logger.info({ mandateId: policy.mandateId, userId: user.id }, 'mandate created');
    return this.toView(aggregate);
  }

  async list(user: UserRow): Promise<MandateView[]> {
    const aggregates = await listMandatesForUser(this.deps.db, user.id);
    return Promise.all(aggregates.map((a) => this.toView(a)));
  }

  async get(user: UserRow, mandateId: string): Promise<MandateView> {
    return this.toView(await this.owned(user, mandateId));
  }

  async revoke(user: UserRow, mandateId: string, reason?: string): Promise<MandateView> {
    await this.owned(user, mandateId);
    const result = await revokeMandate(this.deps.db, { mandateId, reason, actorId: user.id });
    this.deps.logger.info(
      { mandateId, changed: result.changed, status: result.status },
      'mandate revoke requested',
    );
    return this.get(user, mandateId);
  }

  async revise(
    user: UserRow,
    mandateId: string,
    changes: ReviseMandateRequest,
  ): Promise<MandateView> {
    const current = await this.owned(user, mandateId);
    if (current.runtime.status !== 'ACTIVE') {
      throw ApiProblem.conflict(
        'MANDATE_NOT_ACTIVE',
        `Only an ACTIVE mandate can be revised (current: ${current.runtime.status})`,
      );
    }
    const now = this.deps.clock.now();
    const next = parsePolicy({
      ...current.policy,
      version: current.policy.version + 1,
      intent: changes.intent ?? current.policy.intent,
      limits: changes.limits ?? current.policy.limits,
      validUntil: changes.validUntil ?? current.policy.validUntil,
      escalation: changes.escalation ?? current.policy.escalation,
      validFrom: now.toISOString(),
    });
    if (Date.parse(next.validUntil) <= now.getTime()) {
      throw ApiProblem.validation([{ path: 'validUntil', message: 'must be in the future' }]);
    }
    const signed = await this.deps.signer.sign(next, now);
    try {
      const aggregate = await reviseMandate(this.deps.db, {
        policy: next,
        policyHash: signed.policyHash,
        jws: signed.jws,
        signingKid: signed.kid,
        actorId: user.id,
      });
      return this.toView(aggregate);
    } catch (error) {
      if (error instanceof MandateStateError)
        throw ApiProblem.conflict('MANDATE_NOT_ACTIVE', error.message);
      throw error;
    }
  }

  async owned(user: UserRow, mandateId: string): Promise<MandateAggregate> {
    const aggregate = await getMandate(this.deps.db, mandateId);
    if (!aggregate || aggregate.mandate.userId !== user.id) throw ApiProblem.notFound('mandate');
    return aggregate;
  }

  async toView(aggregate: MandateAggregate): Promise<MandateView> {
    const { db } = this.deps;
    const { mandate, version, runtime, policy } = aggregate;
    const agent = await getAgentById(db, mandate.agentId);
    const paymentMethod = await getPaymentMethodById(db, policy.paymentMethodRef);
    const merchants = (await listMerchants(db)).filter((m) =>
      policy.allowedMerchantIds.includes(m.id),
    );
    const timeline = await listAuditEvents(db, { mandateId: mandate.id });
    const effectiveStatus = effectiveRuntimeStatus(
      runtime.status as MandateState,
      runtime.validUntil,
      this.deps.clock.now(),
    );
    return {
      id: mandate.id,
      version: version.version,
      status: effectiveStatus,
      policy,
      policyHash: version.policyHash,
      jws: version.jws,
      signingKid: version.signingKid,
      summary: describeMandatePolicy(policy, {
        merchantNames: merchants.map((m) => m.displayName),
        paymentMethodLabel: paymentMethod
          ? `${paymentMethod.displayBrand} ending in ${paymentMethod.displayLast4}`
          : undefined,
      }),
      usage: {
        reservedMinor: runtime.reservedMinor,
        consumedMinor: runtime.consumedMinor,
        reservedCount: runtime.reservedCount,
        consumedCount: runtime.consumedCount,
        remainingMinor: Math.max(
          0,
          runtime.maxTotalMinor - runtime.consumedMinor - runtime.reservedMinor,
        ),
        remainingCount: Math.max(
          0,
          runtime.maxFulfillments - runtime.consumedCount - runtime.reservedCount,
        ),
      },
      revokedAt: runtime.revokedAt?.toISOString() ?? null,
      revokeReason: runtime.revokeReason,
      createdAt: mandate.createdAt.toISOString(),
      agent: {
        id: mandate.agentId,
        displayName: agent?.displayName ?? 'Purchasing agent',
        keyThumbprint: policy.agentKeyThumbprint,
      },
      paymentMethod: paymentMethod
        ? {
            id: paymentMethod.id,
            brand: paymentMethod.displayBrand,
            last4: paymentMethod.displayLast4,
          }
        : null,
      merchants: merchants.map((m) => ({ id: m.id, displayName: m.displayName, market: m.market })),
      versions: aggregate.versions.map((v) => ({
        version: v.version,
        status: v.version === mandate.currentVersion ? effectiveStatus : 'SUPERSEDED',
        policyHash: v.policyHash,
        signingKid: v.signingKid,
        createdAt: v.createdAt.toISOString(),
      })),
      timeline,
    };
  }

  private async defaultAgentId(user: UserRow): Promise<string> {
    const { listAgentsForUser } = await import('@authera/db');
    const agents = (await listAgentsForUser(this.deps.db, user.id)).filter(
      (a) => a.status === 'ACTIVE',
    );
    const first = agents[0];
    if (!first)
      throw ApiProblem.conflict(
        'AGENT_MISSING',
        'No active purchasing agent is registered for this user',
      );
    return first.id;
  }
}

function parsePolicy(candidate: unknown): MandatePolicyV1 {
  const parsed = MandatePolicyV1Schema.safeParse(candidate);
  if (!parsed.success) throw ApiProblem.validation(formatZodIssues(parsed.error.issues));
  return parsed.data;
}

/** ACTIVE past validUntil reads as EXPIRED without waiting for a sweeper. */
export function effectiveRuntimeStatus(
  status: MandateState,
  validUntil: Date,
  now: Date,
): MandateState {
  if (status === 'ACTIVE' && now >= validUntil) return 'EXPIRED';
  return status;
}
