import type { AuditEventType, Money, ReasonCode } from '@authera/contracts';
import { formatMoney } from '../money/index.js';

/** Optional context that makes a reason sentence concrete. All fields are optional. */
export interface ReasonContext {
  amount?: Money;
  limit?: Money;
  merchantName?: string;
  validUntil?: string;
  revokedAt?: string;
  route?: string;
  expectedRoute?: string;
}

const money = (value: Money | undefined) => (value ? formatMoney(value) : 'the requested amount');

const REASON_TEMPLATES: Record<ReasonCode, (ctx: ReasonContext) => string> = {
  ALLOW_WITHIN_MANDATE: (ctx) =>
    `Approved automatically: ${money(ctx.amount)} is within the mandate${ctx.limit ? ` (limit ${formatMoney(ctx.limit)})` : ''} and every condition matched.`,
  ALLOW_CHECKOUT_APPROVAL: (ctx) =>
    `Approved by the account holder for this exact checkout of ${money(ctx.amount)}; the mandate limits were not changed.`,
  REQUIRE_HUMAN_AMOUNT: (ctx) =>
    `Paused for human approval: ${money(ctx.amount)} exceeds the mandate limit${ctx.limit ? ` of ${formatMoney(ctx.limit)}` : ''}. Nothing was charged.`,
  REQUIRE_HUMAN_CONDITION: () =>
    'Paused for human approval: the offer is outside a mandate condition (for example the travel dates). Nothing was charged.',
  AGENT_UNKNOWN: () => 'Blocked: the request was not signed by a recognized purchasing agent.',
  AGENT_REVOKED: () => "Blocked: the purchasing agent's credentials have been revoked.",
  SIGNATURE_INVALID: () => 'Blocked: the request signature did not verify.',
  REQUEST_EXPIRED: () => 'Blocked: the signed request was outside its validity window.',
  REPLAY_DETECTED: () => 'Blocked: this signed request was already used once.',
  MANDATE_INVALID: () => 'Blocked: the mandate document is not a valid Authera mandate.',
  MANDATE_NOT_ACTIVE: () => 'Blocked: the mandate has not been activated.',
  MANDATE_NOT_YET_VALID: () => 'Blocked: the mandate is not valid yet.',
  MANDATE_EXPIRED: (ctx) =>
    `Blocked: the mandate expired${ctx.validUntil ? ` on ${ctx.validUntil}` : ''}.`,
  MANDATE_REVOKED: (ctx) =>
    `Blocked: the account holder revoked the mandate${ctx.revokedAt ? ` at ${ctx.revokedAt}` : ''}.`,
  MANDATE_SUPERSEDED: () => 'Blocked: this mandate version was replaced by a newer one.',
  AGENT_KEY_MISMATCH: () =>
    'Blocked: the request was signed by a key the mandate does not authorize.',
  MERCHANT_NOT_ALLOWED: (ctx) =>
    `Blocked: the mandate does not allow purchases from ${ctx.merchantName ?? 'this merchant'}.`,
  OFFER_NOT_AVAILABLE: () => 'Blocked: the offer is no longer available.',
  INTENT_MISMATCH: (ctx) =>
    `Blocked: the offer does not match the mandate${ctx.expectedRoute && ctx.route ? ` (expected ${ctx.expectedRoute}, got ${ctx.route})` : ''}.`,
  AMOUNT_EXCEEDED: (ctx) =>
    `Blocked: ${money(ctx.amount)} exceeds the mandate limit${ctx.limit ? ` of ${formatMoney(ctx.limit)}` : ''}.`,
  CURRENCY_MISMATCH: () => "Blocked: the offer currency differs from the mandate's currency.",
  USAGE_EXHAUSTED: () => 'Blocked: the mandate has no remaining purchases.',
  CHECKOUT_EXPIRED: () => 'Blocked: the checkout expired before the purchase completed.',
  CHECKOUT_HASH_MISMATCH: () => 'Blocked: the cart changed after it was authorized.',
  CLOSED_CHECKOUT_INVALID: () =>
    'Blocked: the agent did not sign exactly this checkout (missing, tampered or mismatched closed mandate).',
  APPROVAL_INVALID: () => 'Blocked: the human approval does not cover this exact checkout.',
  RESERVATION_CONFLICT: () => 'Blocked: another purchase used the mandate allowance first.',
  BOOKING_FAILED: () =>
    'The flight could not be booked; the payment authorization was cancelled and the mandate allowance was released.',
  PAYMENT_FAILED: () => 'Payment failed at the processor; the mandate allowance was released.',
  INTERNAL_FAIL_CLOSED: () =>
    'Blocked: the request could not be evaluated safely, so it was denied by default.',
};

export function describeReason(code: ReasonCode, ctx: ReasonContext = {}): string {
  return REASON_TEMPLATES[code](ctx);
}

const EVENT_TEMPLATES: Record<AuditEventType, string> = {
  MANDATE_CREATED: 'Mandate created',
  MANDATE_ACTIVATED: 'Mandate activated and signed',
  MANDATE_REVISED: 'Mandate revised; previous version superseded',
  MANDATE_REVOKED: 'Mandate revoked by the account holder',
  AGENT_REQUEST_RECEIVED: 'Signed agent request received',
  AGENT_SIGNATURE_VERIFIED: 'Agent signature verified',
  AGENT_SIGNATURE_REJECTED: 'Agent signature rejected',
  NONCE_ACCEPTED: 'Request nonce accepted',
  REPLAY_REJECTED: 'Replayed request rejected',
  POLICY_EVALUATED: 'Mandate policy evaluated',
  APPROVAL_REQUESTED: 'Human approval requested',
  APPROVAL_APPROVED: 'Human approved the exact checkout',
  APPROVAL_REJECTED: 'Human rejected the request',
  USAGE_RESERVED: 'Mandate usage reserved',
  USAGE_CONSUMED: 'Mandate usage consumed',
  USAGE_RELEASED: 'Mandate usage released',
  PAYMENT_REQUESTED: 'Payment requested from the processor',
  PAYMENT_PENDING: 'Payment pending at the processor',
  PAYMENT_SUCCEEDED: 'Payment succeeded',
  PAYMENT_FAILED: 'Payment failed',
  BOOKING_REQUESTED: 'Flight booking requested from Duffel',
  BOOKING_PENDING: 'Flight booking outcome pending reconciliation',
  BOOKING_CONFIRMED: 'Flight booking confirmed',
  BOOKING_FAILED: 'Flight booking failed',
  WEBHOOK_RECEIVED: 'Provider webhook received',
  WEBHOOK_DUPLICATE: 'Duplicate provider webhook ignored',
  DISPUTE_OPENED: 'Dispute opened',
  DISPUTE_RESOLVED: 'Dispute resolved from evidence',
};

export function describeAuditEvent(type: AuditEventType, detail?: string): string {
  const base = EVENT_TEMPLATES[type];
  return detail ? `${base}: ${detail}` : base;
}

export interface MandateSummaryContext {
  merchantNames?: string[];
  paymentMethodLabel?: string;
}

/** Plain-language rendering of a signed policy for the human, merchant, and auditor views. */
export function describeMandatePolicy(
  policy: {
    intent:
      | {
          type: 'flight';
          origin: string;
          destination: string;
          cabin: string;
          passengerCount: number;
          departureDateFrom: string;
          departureDateTo: string;
          dateFlexibilityDays?: number;
        }
      | { type: 'goods'; query: string; maxQuantity: number };
    limits: {
      currency: Money['currency'];
      maxPerPurchaseMinor: number;
      maxTotalMinor: number;
      maxFulfillments: number;
    };
    validUntil: string;
    escalation: 'block' | 'require_human';
  },
  ctx: MandateSummaryContext = {},
): string {
  const { intent, limits } = policy;
  const merchants =
    ctx.merchantNames && ctx.merchantNames.length > 0
      ? ctx.merchantNames.join(' or ')
      : 'the allowed merchant';
  const perPurchase = formatMoney({ currency: limits.currency, minor: limits.maxPerPurchaseMinor });
  const total = formatMoney({ currency: limits.currency, minor: limits.maxTotalMinor });
  const uses =
    limits.maxFulfillments === 1
      ? 'a single purchase'
      : `up to ${limits.maxFulfillments} purchases`;
  const payment = ctx.paymentMethodLabel ? ` using ${ctx.paymentMethodLabel}` : '';
  const outside =
    policy.escalation === 'require_human'
      ? 'Anything outside these limits pauses for your approval.'
      : 'Anything outside these limits is blocked.';
  const tail = `at most ${perPurchase} per purchase and ${total} in total, ${uses}, until ${policy.validUntil}. ${outside}`;
  if (intent.type === 'goods') {
    const qty = intent.maxQuantity === 1 ? 'one unit' : `up to ${intent.maxQuantity} units`;
    return `Buy “${intent.query}” (${qty}) from ${merchants}${payment}: ${tail}`;
  }
  const passengers =
    intent.passengerCount === 1 ? 'one passenger' : `${intent.passengerCount} passengers`;
  const flexibility = intent.dateFlexibilityDays ?? 0;
  const dateRule =
    flexibility === 0
      ? 'on those exact dates'
      : `with up to ${flexibility} day${flexibility === 1 ? '' : 's'} before or after`;
  return (
    `Buy ${intent.cabin} flights from ${intent.origin} to ${intent.destination} for ${passengers}, departing between ${intent.departureDateFrom} and ${intent.departureDateTo}, ${dateRule}, from ${merchants}${payment}: ` +
    tail
  );
}
