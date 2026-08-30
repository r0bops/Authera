import type { Decision, ReasonCode } from '@authera/contracts';

/**
 * The judges' vocabulary, not ours. Reason codes stay visible for auditors, but every screen a
 * judge reads leads with the words from the brief: amount exceeded, forbidden category, expired,
 * revoked, impersonated agent, human-in-the-loop.
 */
const REASON_LABELS: Record<ReasonCode, string> = {
  ALLOW_WITHIN_MANDATE: 'Within the mandate',
  ALLOW_CHECKOUT_APPROVAL: 'Human approved this exact cart',
  REQUIRE_HUMAN_AMOUNT: 'Amount exceeded — waiting for human approval',
  REQUIRE_HUMAN_CONDITION: 'Outside the rules — waiting for human approval',
  AGENT_UNKNOWN: 'Unknown agent',
  AGENT_REVOKED: 'Agent revoked',
  SIGNATURE_INVALID: 'Impersonated agent — signature invalid',
  REQUEST_EXPIRED: 'Signed request too old',
  REPLAY_DETECTED: 'Replayed request',
  MANDATE_INVALID: 'Mandate signature invalid',
  MANDATE_NOT_ACTIVE: 'Mandate not active',
  MANDATE_NOT_YET_VALID: 'Mandate not yet valid',
  MANDATE_EXPIRED: 'Mandate expired',
  MANDATE_REVOKED: 'Mandate revoked',
  MANDATE_SUPERSEDED: 'Mandate version superseded',
  AGENT_KEY_MISMATCH: 'Wrong agent for this mandate',
  MERCHANT_NOT_ALLOWED: 'Merchant not allowed',
  OFFER_NOT_AVAILABLE: 'Offer no longer available',
  INTENT_MISMATCH: 'Forbidden category or wrong trip',
  AMOUNT_EXCEEDED: 'Amount exceeded',
  CURRENCY_MISMATCH: 'Currency not allowed',
  USAGE_EXHAUSTED: 'Mandate already used up',
  CHECKOUT_EXPIRED: 'Checkout expired',
  CHECKOUT_HASH_MISMATCH: 'Cart changed after approval',
  CLOSED_CHECKOUT_INVALID: 'Agent did not sign this exact cart',
  APPROVAL_INVALID: 'Approval does not match this cart',
  RESERVATION_CONFLICT: 'Another attempt won the reservation',
  BOOKING_FAILED: 'Booking failed',
  PAYMENT_FAILED: 'Payment failed',
  INTERNAL_FAIL_CLOSED: 'Internal error — failed closed',
};

export function reasonLabel(code: ReasonCode | null | undefined): string | null {
  if (!code) return null;
  return REASON_LABELS[code] ?? humanize(code);
}

export function decisionLabel(decision: Decision | null | undefined): string {
  switch (decision) {
    case 'ALLOW':
      return 'Allowed';
    case 'REQUIRE_HUMAN':
      return 'Human-in-the-loop';
    case 'BLOCK':
      return 'Blocked';
    default:
      return 'Pending';
  }
}

/** Every deterministic policy check, in the words the merchant-verification requirement uses. */
const CHECK_LABELS: Record<string, string> = {
  INPUT_SCHEMA: 'Request well-formed',
  MANDATE_SCHEMA: 'Mandate well-formed',
  AGENT_ACTIVE: 'Legitimate agent',
  RUNTIME_ACTIVE: 'Mandate active (not revoked)',
  VALID_FROM: 'Mandate already valid',
  VALID_UNTIL: 'Mandate not expired',
  OFFER_AVAILABLE: 'Offer available',
  OFFER_MERCHANT: 'Merchant allowed',
  INTENT_KIND: 'Category allowed',
  INTENT_QUERY: 'Matches what was asked for',
  INTENT_QUANTITY: 'Quantity within the mandate',
  MANDATE_EXISTS: 'Mandate found',
  MANDATE_SIGNATURE: 'Human mandate signature valid',
  MANDATE_HASH: 'Mandate content unchanged',
  USAGE_RESERVATION: 'Usage reserved atomically',
  USAGE_COUNT: 'Purchases left on the mandate',
  APPROVAL_CEILING: 'Within what a human may approve',
  APPROVAL_TOLERANCE: 'Near miss within the progressive tolerance',
  APPROVAL_SCOPE: 'Approval matches this exact cart',
  DATE_WINDOW: 'Dates within the window',
  EVALUATOR_ERROR: 'Evaluator ran without error',
  CURRENCY: 'Currency allowed',
  AMOUNT_PER_PURCHASE: 'Within the per-purchase limit',
  AMOUNT_TOTAL: 'Within the total budget',
  CHECKOUT_OFFER: 'Cart matches the offer',
  CHECKOUT_TOTAL: 'Cart total matches the offer',
  CLOSED_CHECKOUT_PRESENT: 'Agent signed the cart',
  CLOSED_CHECKOUT_SIGNATURE: 'Agent signature valid',
  CLOSED_CHECKOUT_BINDING: 'Agent signature binds this exact cart',
  WITHIN_MANDATE: 'Purchase within the mandate',
};

export function checkLabel(code: string): string {
  return CHECK_LABELS[code] ?? humanize(code);
}

function humanize(code: string): string {
  const words = code.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}
