import type {
  ChatPendingRevision,
  ChatRevisionChange,
  MandateChatDraft,
  MandatePolicyV1,
  ReviseMandateRequest,
} from '@authera/contracts';

/**
 * A signed plan can be changed, but only through a re-signed version the person confirms.
 * These helpers are pure: the chat proposes, code decides what a proposal may touch, and the
 * mandate service signs. Route, category and currency are pinned — a different trip is a new plan.
 */

/** The draft that exactly mirrors a signed flight policy (goods plans are not chat-managed). */
export function draftFromPolicy(policy: MandatePolicyV1): MandateChatDraft | null {
  if (policy.intent.type !== 'flight') return null;
  return {
    category: 'flight',
    origin: policy.intent.origin,
    destination: policy.intent.destination,
    departureDateFrom: policy.intent.departureDateFrom,
    departureDateTo: policy.intent.departureDateTo,
    dateFlexibilityDays: policy.intent.dateFlexibilityDays ?? 0,
    departureTimeFrom: policy.intent.departureTimeFrom ?? null,
    departureTimeTo: policy.intent.departureTimeTo ?? null,
    passengerCount: policy.intent.passengerCount,
    maxPerPurchaseMinor: policy.limits.maxPerPurchaseMinor,
    currency: policy.limits.currency,
    maxFulfillments: policy.limits.maxFulfillments,
    validUntil: policy.validUntil,
    escalation: policy.escalation,
  };
}

/** Keep what a signed plan may never change; fall back to the stored value for anything unset. */
export function pinSignedDraft(
  stored: MandateChatDraft,
  proposed: MandateChatDraft,
): MandateChatDraft {
  return {
    ...proposed,
    category: stored.category,
    origin: stored.origin,
    destination: stored.destination,
    currency: stored.currency,
    departureDateFrom: proposed.departureDateFrom ?? stored.departureDateFrom,
    departureDateTo: proposed.departureDateTo ?? stored.departureDateTo,
    dateFlexibilityDays: proposed.dateFlexibilityDays ?? stored.dateFlexibilityDays,
    passengerCount: proposed.passengerCount ?? stored.passengerCount,
    departureTimeFrom: proposed.departureTimeFrom ?? stored.departureTimeFrom,
    departureTimeTo: proposed.departureTimeTo ?? stored.departureTimeTo,
    maxPerPurchaseMinor: proposed.maxPerPurchaseMinor ?? stored.maxPerPurchaseMinor,
    maxFulfillments: proposed.maxFulfillments ?? stored.maxFulfillments,
    validUntil: proposed.validUntil ?? stored.validUntil,
    escalation: proposed.escalation ?? stored.escalation,
  };
}

/**
 * What the person has asked to change, compared with the policy that is actually signed.
 * Returns null when the draft and the policy agree, or when the draft is not usable.
 */
export function pendingRevisionFor(
  draft: MandateChatDraft | null,
  policy: MandatePolicyV1,
): ChatPendingRevision | null {
  const current = draftFromPolicy(policy);
  if (!draft || !current || policy.intent.type !== 'flight') return null;
  if (
    !draft.departureDateFrom ||
    !draft.departureDateTo ||
    !draft.passengerCount ||
    !draft.maxPerPurchaseMinor ||
    !draft.maxFulfillments ||
    !draft.validUntil ||
    !draft.escalation
  ) {
    return null;
  }
  const changes: ChatRevisionChange[] = [];
  const request: ReviseMandateRequest = {};
  const currency = policy.limits.currency;

  const limitsChanged =
    draft.maxPerPurchaseMinor !== current.maxPerPurchaseMinor ||
    draft.maxFulfillments !== current.maxFulfillments;
  if (draft.maxPerPurchaseMinor !== current.maxPerPurchaseMinor) {
    changes.push({
      field: 'maximumPrice',
      from: money(current.maxPerPurchaseMinor!, currency),
      to: money(draft.maxPerPurchaseMinor, currency),
    });
  }
  if (draft.maxFulfillments !== current.maxFulfillments) {
    changes.push({
      field: 'purchaseCount',
      from: uses(current.maxFulfillments!),
      to: uses(draft.maxFulfillments),
    });
  }
  if (limitsChanged) {
    const ceiling = policy.limits.approvalCeilingMinor;
    request.limits = {
      currency,
      maxPerPurchaseMinor: draft.maxPerPurchaseMinor,
      maxTotalMinor: draft.maxPerPurchaseMinor * draft.maxFulfillments,
      maxFulfillments: draft.maxFulfillments,
      // a ceiling the plan already carries never drops below the new limit
      ...(ceiling !== undefined
        ? { approvalCeilingMinor: Math.max(ceiling, draft.maxPerPurchaseMinor) }
        : {}),
    };
  }
  if (draft.validUntil !== current.validUntil) {
    changes.push({
      field: 'validUntil',
      from: day(current.validUntil!),
      to: day(draft.validUntil),
    });
    request.validUntil = draft.validUntil;
  }
  if (draft.escalation !== current.escalation) {
    changes.push({
      field: 'outsideRules',
      from: outside(current.escalation!),
      to: outside(draft.escalation),
    });
    request.escalation = draft.escalation;
  }
  const flexibility = draft.dateFlexibilityDays ?? 0;
  const timeChanged =
    (draft.departureTimeFrom ?? null) !== (current.departureTimeFrom ?? null) ||
    (draft.departureTimeTo ?? null) !== (current.departureTimeTo ?? null);
  const intentChanged =
    draft.departureDateFrom !== current.departureDateFrom ||
    draft.departureDateTo !== current.departureDateTo ||
    flexibility !== (current.dateFlexibilityDays ?? 0) ||
    draft.passengerCount !== current.passengerCount ||
    timeChanged;
  if (
    draft.departureDateFrom !== current.departureDateFrom ||
    draft.departureDateTo !== current.departureDateTo
  ) {
    changes.push({
      field: 'departureDates',
      from: `${current.departureDateFrom} → ${current.departureDateTo}`,
      to: `${draft.departureDateFrom} → ${draft.departureDateTo}`,
    });
  }
  if (flexibility !== (current.dateFlexibilityDays ?? 0)) {
    changes.push({
      field: 'dateFlexibility',
      from: `${current.dateFlexibilityDays ?? 0} day(s)`,
      to: `${flexibility} day(s)`,
    });
  }
  if (timeChanged) {
    changes.push({
      field: 'departureTime',
      from: current.departureTimeFrom
        ? `${current.departureTimeFrom}–${current.departureTimeTo}`
        : 'any time',
      to: draft.departureTimeFrom
        ? `${draft.departureTimeFrom}–${draft.departureTimeTo}`
        : 'any time',
    });
  }
  if (draft.passengerCount !== current.passengerCount) {
    changes.push({
      field: 'passengerCount',
      from: String(current.passengerCount),
      to: String(draft.passengerCount),
    });
  }
  if (intentChanged) {
    request.intent = {
      ...policy.intent,
      departureDateFrom: draft.departureDateFrom,
      departureDateTo: draft.departureDateTo,
      dateFlexibilityDays: flexibility,
      passengerCount: draft.passengerCount,
      ...(draft.departureTimeFrom && draft.departureTimeTo
        ? { departureTimeFrom: draft.departureTimeFrom, departureTimeTo: draft.departureTimeTo }
        : { departureTimeFrom: undefined, departureTimeTo: undefined }),
    };
  }
  if (changes.length === 0) return null;
  return { changes, request };
}

/** "maximum price USD 300.00 → USD 250.00; validity 30 Sep → 15 Oct" */
export function describeRevision(changes: ChatRevisionChange[]): string {
  return changes.map((c) => `${LABELS[c.field]} ${c.from} → ${c.to}`).join('; ');
}

const LABELS: Record<ChatRevisionChange['field'], string> = {
  maximumPrice: 'maximum price',
  purchaseCount: 'purchases',
  validUntil: 'valid until',
  outsideRules: 'outside the rules',
  departureDates: 'departure dates',
  dateFlexibility: 'date flexibility',
  passengerCount: 'passengers',
  departureTime: 'departure time',
};

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function uses(count: number): string {
  return count === 1 ? '1 purchase' : `${count} purchases`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function outside(escalation: 'block' | 'require_human'): string {
  return escalation === 'block' ? 'block' : 'ask you first';
}
