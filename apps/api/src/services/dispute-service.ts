import type { DisputeReason, DisputeView, EvidenceBundle } from '@authera/contracts';
import {
  createDispute,
  getDispute,
  listDisputesForUser,
  resolveDispute,
  type Database,
  type UserRow,
} from '@authera/db';
import { resolveDisputeFromEvidence } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';
import { requireExecutionAccess } from './access-control.js';
import { toDisputeView, type EvidenceService } from './evidence-service.js';

/**
 * Disputes (spec §15): the customer states a reason; the deterministic resolver reads the
 * evidence bundle and decides. An LLM may summarize, never decide. Unresolvable cases escalate.
 */
export class DisputeService {
  constructor(
    private readonly deps: {
      db: Database;
      clock: Clock;
      logger: Logger;
      evidence: EvidenceService;
    },
  ) {}

  async open(
    user: UserRow,
    input: { executionId: string; reason: DisputeReason; description?: string },
  ): Promise<DisputeView> {
    const { db } = this.deps;
    const execution = await requireExecutionAccess(db, user, input.executionId);
    const created = await db.transaction((tx) =>
      createDispute(tx, {
        executionId: input.executionId,
        userId: user.id,
        reason: input.reason,
        description: input.description ?? null,
        mandateId: execution.mandateId,
      }),
    );
    const bundle = await this.deps.evidence.bundle(input.executionId, 'auditor');
    const resolution = resolveDisputeFromEvidence(this.evidenceFacts(bundle, input.reason));
    const resolved = await db.transaction((tx) =>
      resolveDispute(tx, {
        disputeId: created.id,
        state: resolution.outcome === 'UNRESOLVED' ? 'ESCALATED' : 'RESOLVED',
        resolution,
        evidenceBundleId: bundle.evidenceId,
        mandateId: execution.mandateId,
        summary: `${resolution.outcome}: ${resolution.headline}`,
      }),
    );
    this.deps.logger.info(
      { disputeId: created.id, executionId: input.executionId, outcome: resolution.outcome },
      'dispute resolved from evidence',
    );
    return toDisputeView(resolved);
  }

  async get(user: UserRow, id: string): Promise<DisputeView> {
    const row = await getDispute(this.deps.db, id);
    if (!row || row.userId !== user.id) throw ApiProblem.notFound('dispute');
    return toDisputeView(row);
  }

  async list(user: UserRow): Promise<DisputeView[]> {
    return (await listDisputesForUser(this.deps.db, user.id)).map(toDisputeView);
  }

  evidenceFacts(bundle: EvidenceBundle, reason: DisputeReason) {
    return {
      executionId: bundle.executionId,
      executionState: bundle.execution.state,
      decision: bundle.execution.decision,
      reasonCode: bundle.execution.reasonCode,
      checks: bundle.policyChecks,
      mandate:
        bundle.mandate && bundle.human
          ? {
              id: bundle.human.authorization.mandateId,
              version: bundle.human.authorization.version,
              status: bundle.mandate.status,
              createdAt: bundle.human.authorization.issuedAt,
              revokedAt: bundle.mandate.revokedAt,
            }
          : null,
      mandateSignatureValid: bundle.policyChecks.some(
        (c) => c.code === 'MANDATE_SIGNATURE' && c.passed,
      ),
      checkoutBound: bundle.checkout ? bundle.checkout.bound : null,
      approval: bundle.approval
        ? {
            state: bundle.approval.state,
            checkoutHash: bundle.approval.checkoutHash,
            decidedAt: bundle.approval.decidedAt,
          }
        : null,
      reservation: bundle.reservation
        ? { state: bundle.reservation.state, createdAt: bundle.reservation.createdAt }
        : null,
      payment: bundle.payment
        ? {
            state: bundle.payment.state,
            providerPaymentId: bundle.payment.providerPaymentId,
            updatedAt: bundle.payment.updatedAt,
          }
        : null,
      chainValid: bundle.audit.chain.valid,
      reason,
    };
  }
}
