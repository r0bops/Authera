import type {
  DisputeOutcome,
  DisputeReason,
  DisputeResolution,
  PolicyCheck,
  ReasonCode,
} from '@authera/contracts';

/** The facts the resolver needs — all derived from stored evidence, never from an LLM. */
export interface DisputeEvidence {
  executionId: string;
  executionState: string;
  decision: 'ALLOW' | 'BLOCK' | 'REQUIRE_HUMAN' | null;
  reasonCode: ReasonCode | null;
  checks: PolicyCheck[];
  mandate: {
    id: string;
    version: number;
    status: string;
    createdAt: string;
    revokedAt: string | null;
  } | null;
  mandateSignatureValid: boolean;
  checkoutBound: boolean | null;
  approval: { state: string; checkoutHash: string; decidedAt: string | null } | null;
  reservation: { state: string; createdAt: string } | null;
  payment: { state: string; providerPaymentId: string | null; updatedAt: string } | null;
  chainValid: boolean;
  reason: DisputeReason;
}

const passed = (checks: PolicyCheck[], code: string) =>
  checks.some((c) => c.code === code && c.passed);

/**
 * Deterministic dispute resolver (spec §15). Outcomes:
 * - CUSTOMER_SUPPORTED: no valid human mandate at execution time, or the cart did not match the
 *   signed mandate/approval.
 * - AUTHORIZED: valid mandate and in-scope checkout; a revocation only happened after the
 *   committed reservation (revocation is not retroactive).
 * - UNRESOLVED: evidence incomplete or the audit chain does not verify — escalate to a human.
 */
export function resolveDisputeFromEvidence(evidence: DisputeEvidence): DisputeResolution {
  const findings: DisputeResolution['findings'] = [];
  const refs: DisputeResolution['evidenceRefs'] = [
    { label: 'Execution', value: evidence.executionId },
  ];
  const timeline: DisputeResolution['timeline'] = [];

  findings.push({
    label: 'Audit chain verifies',
    ok: evidence.chainValid,
    detail: evidence.chainValid
      ? 'Every event hash links to its predecessor'
      : 'Chain verification failed — evidence cannot be trusted automatically',
  });

  if (!evidence.chainValid) {
    return finish(
      'UNRESOLVED',
      'Escalated to a human reviewer',
      'The audit chain for this execution does not verify, so the evidence cannot settle the dispute automatically.',
      findings,
      timeline,
      refs,
    );
  }

  const mandatePresent = evidence.mandate !== null;
  findings.push({
    label: 'Human mandate existed',
    ok: mandatePresent,
    detail: mandatePresent
      ? `Mandate ${evidence.mandate!.id} v${evidence.mandate!.version}`
      : 'No mandate is linked to this execution',
  });
  if (evidence.mandate) {
    refs.push({ label: 'Mandate', value: `${evidence.mandate.id} v${evidence.mandate.version}` });
    timeline.push({
      at: evidence.mandate.createdAt,
      label: 'Mandate created and signed',
      detail: null,
    });
  }
  findings.push({
    label: 'Mandate signature valid',
    ok: evidence.mandateSignatureValid,
    detail: evidence.mandateSignatureValid
      ? 'Trusted-surface signature and policy hash verified'
      : 'The mandate signature did not verify',
  });

  const signatureOk = passed(evidence.checks, 'AGENT_BOUND');
  findings.push({
    label: 'Agent bound to the mandate',
    ok: signatureOk,
    detail: signatureOk
      ? 'Request signed with the key the mandate authorizes'
      : 'The request was not signed by the mandate’s agent key',
  });

  const cartOk = evidence.checkoutBound === true && passed(evidence.checks, 'CHECKOUT_INTEGRITY');
  findings.push({
    label: 'Cart matched the authorized checkout',
    ok: evidence.checkoutBound === null ? null : cartOk,
    detail: cartOk
      ? 'Stored and recomputed cart hashes agree'
      : 'The cart changed after authorization or never bound',
  });

  if (evidence.approval) {
    findings.push({
      label: 'Checkout-scoped approval',
      ok: evidence.approval.state === 'CONSUMED' || evidence.approval.state === 'APPROVED',
      detail: `Approval ${evidence.approval.state.toLowerCase()} for checkout ${evidence.approval.checkoutHash.slice(0, 23)}…`,
    });
    if (evidence.approval.decidedAt)
      timeline.push({
        at: evidence.approval.decidedAt,
        label: 'Human approved this exact checkout',
        detail: null,
      });
  }

  if (evidence.reservation)
    timeline.push({
      at: evidence.reservation.createdAt,
      label: 'Mandate usage reserved',
      detail: `reservation ${evidence.reservation.state.toLowerCase()}`,
    });
  if (evidence.payment) {
    timeline.push({
      at: evidence.payment.updatedAt,
      label: `Payment ${evidence.payment.state.toLowerCase()}`,
      detail: evidence.payment.providerPaymentId,
    });
    if (evidence.payment.providerPaymentId)
      refs.push({ label: 'Provider payment', value: evidence.payment.providerPaymentId });
  }
  if (evidence.mandate?.revokedAt)
    timeline.push({ at: evidence.mandate.revokedAt, label: 'Mandate revoked', detail: null });

  const noMoneyMoved = evidence.payment === null || evidence.payment.state !== 'SUCCEEDED';
  if (noMoneyMoved) {
    findings.push({
      label: 'Payment completed',
      ok: false,
      detail: 'No successful payment is recorded for this execution',
    });
    return finish(
      'CUSTOMER_SUPPORTED',
      'No charge occurred',
      `The gateway ${evidence.decision === 'ALLOW' ? 'allowed the purchase but the payment did not succeed' : `did not authorize this purchase (${evidence.reasonCode ?? 'no decision'})`}. Nothing was charged, so the claim is upheld on the record.`,
      findings,
      timeline,
      refs,
    );
  }
  findings.push({
    label: 'Payment completed',
    ok: true,
    detail: evidence.payment?.providerPaymentId ?? 'succeeded',
  });

  if (!mandatePresent || !evidence.mandateSignatureValid || !signatureOk) {
    return finish(
      'CUSTOMER_SUPPORTED',
      'Customer claim supported',
      'A payment succeeded without a valid, signed human mandate bound to the requesting agent. The evidence does not show human authorization.',
      findings,
      timeline,
      refs,
    );
  }
  if (!cartOk) {
    return finish(
      'CUSTOMER_SUPPORTED',
      'Customer claim supported',
      'The cart paid for does not match the checkout the mandate or approval authorized.',
      findings,
      timeline,
      refs,
    );
  }

  const revokedAt = evidence.mandate?.revokedAt ? Date.parse(evidence.mandate.revokedAt) : null;
  const reservedAt = evidence.reservation ? Date.parse(evidence.reservation.createdAt) : null;
  if (revokedAt !== null && reservedAt !== null && revokedAt < reservedAt) {
    findings.push({
      label: 'Revocation preceded the purchase',
      ok: false,
      detail: 'The mandate was revoked before usage was reserved',
    });
    return finish(
      'CUSTOMER_SUPPORTED',
      'Customer claim supported',
      'The mandate was revoked before the purchase reserved its usage, so the purchase should have been blocked.',
      findings,
      timeline,
      refs,
    );
  }
  if (revokedAt !== null && reservedAt !== null) {
    findings.push({
      label: 'Revocation after the purchase',
      ok: true,
      detail: 'Revocation is not retroactive; the reservation had already committed',
    });
  }

  const within =
    evidence.reasonCode === 'ALLOW_WITHIN_MANDATE' ||
    evidence.reasonCode === 'ALLOW_CHECKOUT_APPROVAL';
  findings.push({
    label: 'Purchase within the mandate',
    ok: within,
    detail:
      evidence.reasonCode === 'ALLOW_CHECKOUT_APPROVAL'
        ? 'Outside the standing limits but explicitly approved by the account holder for this checkout'
        : within
          ? 'Every mandate condition matched at evaluation time'
          : `Gateway reason: ${evidence.reasonCode ?? 'unknown'}`,
  });
  if (!within) {
    return finish(
      'UNRESOLVED',
      'Escalated to a human reviewer',
      'A payment succeeded but the recorded decision is not an allow — the evidence is internally inconsistent.',
      findings,
      timeline,
      refs,
    );
  }

  const reasonNote =
    evidence.reason === 'REVOKED_BEFORE_PURCHASE' && revokedAt !== null
      ? ' You revoked the mandate after the payment had completed.'
      : '';
  return finish(
    'AUTHORIZED',
    'Purchase was authorized',
    `You created and signed the mandate, the agent that bought was the one you authorized, the cart matched the authorized checkout, and the amount was within what you allowed.${reasonNote}`,
    findings,
    timeline,
    refs,
  );
}

function finish(
  outcome: DisputeOutcome,
  headline: string,
  explanation: string,
  findings: DisputeResolution['findings'],
  timeline: DisputeResolution['timeline'],
  evidenceRefs: DisputeResolution['evidenceRefs'],
): DisputeResolution {
  const sorted = [...timeline].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  return { outcome, headline, explanation, findings, timeline: sorted, evidenceRefs };
}
