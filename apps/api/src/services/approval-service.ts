import type { ApprovalView, Money } from '@authera/contracts';
import {
  decideApproval,
  getApprovalRequest,
  getMandate,
  getMandateVersion,
  getOffer,
  listApprovalsForUser,
  listMerchants,
  type ApprovalRow,
  type Database,
  type UserRow,
} from '@authera/db';
import { describeMandatePolicy, describeReason } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';
import { toOfferView } from './checkout-service.js';

/**
 * Human escalation (spec §9 Approval state machine, §12 human API). An approval binds the exact
 * checkout hash; it is single-use and consumed by the gateway inside the reservation transaction.
 */
export class ApprovalService {
  constructor(
    private readonly deps: {
      db: Database;
      clock: Clock;
      logger: Logger;
      /** Fired after an APPROVED decision is stored, with the approval as the human now sees it. */
      onApproved?: (approval: ApprovalView) => void;
    },
  ) {}

  async list(user: UserRow): Promise<ApprovalView[]> {
    const rows = await listApprovalsForUser(this.deps.db, user.id);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async get(user: UserRow, id: string): Promise<ApprovalView> {
    const row = await this.owned(user, id);
    return this.toView(row);
  }

  async decide(
    user: UserRow,
    id: string,
    input: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ): Promise<ApprovalView> {
    const row = await this.owned(user, id);
    const now = this.deps.clock.now();
    if (row.state === 'PENDING' && row.expiresAt <= now) {
      throw ApiProblem.conflict(
        'APPROVAL_EXPIRED',
        'This request expired before a decision was made',
      );
    }
    if (row.state !== 'PENDING' && row.state !== input.decision) {
      throw ApiProblem.conflict(
        'APPROVAL_ALREADY_DECIDED',
        `This request is already ${row.state.toLowerCase()}`,
      );
    }
    const decided = await this.deps.db.transaction((tx) =>
      decideApproval(tx, {
        approvalId: id,
        decision: input.decision,
        actorId: user.id,
        evidence: {
          decidedBy: user.id,
          decidedAt: now.toISOString(),
          checkoutHash: row.checkoutHash,
          amountMinor: row.amountMinor,
          currency: row.currency,
          note: input.note ?? null,
          scope: 'this exact checkout only; standing limits unchanged',
        },
      }),
    );
    this.deps.logger.info(
      { approvalId: id, decision: input.decision, userId: user.id },
      'approval decided',
    );
    const view = await this.toView(decided);
    if (input.decision === 'APPROVED') this.deps.onApproved?.(view);
    return view;
  }

  private async owned(user: UserRow, id: string): Promise<ApprovalRow> {
    const row = await getApprovalRequest(this.deps.db, id);
    if (!row) throw ApiProblem.notFound('approval request');
    const mandate = await getMandate(this.deps.db, row.mandateId);
    if (!mandate || mandate.mandate.userId !== user.id)
      throw ApiProblem.notFound('approval request');
    return row;
  }

  async toView(row: ApprovalRow): Promise<ApprovalView> {
    const version = await getMandateVersion(this.deps.db, row.mandateId, row.mandateVersion);
    const offer = await getOffer(this.deps.db, row.offerId);
    const merchants = await listMerchants(this.deps.db);
    const requested: Money = {
      currency: row.currency as Money['currency'],
      minor: row.amountMinor,
    };
    const limit: Money = version
      ? {
          currency: version.policy.limits.currency,
          minor: version.policy.limits.maxPerPurchaseMinor,
        }
      : { currency: requested.currency, minor: 0 };
    return {
      id: row.id,
      state: row.state as ApprovalView['state'],
      executionId: row.executionId,
      mandateId: row.mandateId,
      mandateVersion: row.mandateVersion,
      checkoutId: row.checkoutId,
      checkoutHash: row.checkoutHash,
      reasonCode: row.reasonCode as ApprovalView['reasonCode'],
      explanation: describeReason(row.reasonCode as ApprovalView['reasonCode'], {
        amount: requested,
        limit,
      }),
      requested,
      limit,
      difference: {
        currency: requested.currency,
        minor: Math.max(0, requested.minor - limit.minor),
      },
      offer: offer ? toOfferView(offer) : null,
      mandateSummary: version
        ? describeMandatePolicy(version.policy, {
            merchantNames: merchants
              .filter((m) => version.policy.allowedMerchantIds.includes(m.id))
              .map((m) => m.displayName),
          })
        : '',
      expiresAt: row.expiresAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      consumedByExecutionId: row.consumedByExecutionId,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
