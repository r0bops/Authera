import {
  MANDATE_SCHEMA_ID,
  PolicyInputSchema,
  type Decision,
  type MandateState,
  type PolicyCheck,
  type PolicyInput,
  type PolicyVerdict,
  type ReasonCode,
  normalizeQuery,
} from '@authera/contracts';
import { equalMoney } from '../money/index.js';

/**
 * The deterministic Mandate Gateway policy evaluator (CLAUDE_IMPLEMENTATION_SPEC.md §8).
 *
 * - Pure: no I/O, no ambient clock (the caller supplies `now`), no randomness.
 * - Fail closed: invalid or unknown input never yields ALLOW.
 * - Returns the first terminal reason plus the complete ordered checklist so evidence can show
 *   exactly which check decided the outcome.
 *
 * Exceptions that a human may approve (amount above the per-purchase or total cap, departure
 * outside the date window) are collected rather than short-circuited, then resolved by the
 * mandate's escalation mode or a checkout-scoped approval. Everything else is a hard block.
 */
export function evaluatePolicy(rawInput: unknown): PolicyVerdict {
  const checks: PolicyCheck[] = [];
  const evaluatedAt = extractNow(rawInput);
  const finish = (decision: Decision, reasonCode: ReasonCode): PolicyVerdict => ({
    decision,
    reasonCode,
    evaluatedAt,
    checks,
  });
  const block = (reasonCode: ReasonCode) => finish('BLOCK', reasonCode);
  const check = (code: string, passed: boolean, expected?: unknown, actual?: unknown): boolean => {
    const entry: PolicyCheck = { code, passed };
    if (expected !== undefined) entry.expected = expected;
    if (actual !== undefined) entry.actual = actual;
    checks.push(entry);
    return passed;
  };

  try {
    // 0. The policy must be a schema we understand before anything else is trusted.
    const mandateRaw = getProperty(rawInput, 'mandate');
    const schemaId = getProperty(mandateRaw, 'schema');
    if (!check('MANDATE_SCHEMA', schemaId === MANDATE_SCHEMA_ID, MANDATE_SCHEMA_ID, schemaId)) {
      return block('MANDATE_INVALID');
    }

    // 1. Strict parse: unknown fields, unknown conditions, or malformed values fail closed.
    const parsed = PolicyInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      check(
        'INPUT_SCHEMA',
        false,
        'strict authera PolicyInput',
        parsed.error.issues.map(formatIssue),
      );
      return block('INTERNAL_FAIL_CLOSED');
    }
    check('INPUT_SCHEMA', true, 'strict authera PolicyInput', 'valid');
    const input: PolicyInput = parsed.data;
    const { agent, mandate, runtime, merchant, offer, checkout, checkoutScopedApproval } = input;
    const nowMs = Date.parse(input.now);

    // 2. Agent identity is separate from mandate authority.
    if (!check('AGENT_ACTIVE', agent.status === 'ACTIVE', 'ACTIVE', agent.status)) {
      return block('AGENT_REVOKED');
    }
    const bound =
      agent.id === mandate.agentId && agent.keyThumbprint === mandate.agentKeyThumbprint;
    if (
      !check(
        'AGENT_BOUND',
        bound,
        { agentId: mandate.agentId, keyThumbprint: mandate.agentKeyThumbprint },
        { agentId: agent.id, keyThumbprint: agent.keyThumbprint },
      )
    ) {
      return block('AGENT_KEY_MISMATCH');
    }

    // 3. Current runtime state from PostgreSQL decides revocation; the signed policy decides scope.
    if (!check('RUNTIME_ACTIVE', runtime.status === 'ACTIVE', 'ACTIVE', runtime.status)) {
      return block(runtimeReason(runtime.status));
    }
    if (
      !check('VALID_FROM', nowMs >= Date.parse(mandate.validFrom), mandate.validFrom, input.now)
    ) {
      return block('MANDATE_NOT_YET_VALID');
    }
    if (
      !check('VALID_UNTIL', nowMs < Date.parse(mandate.validUntil), mandate.validUntil, input.now)
    ) {
      return block('MANDATE_EXPIRED');
    }

    // 4. Merchant and offer.
    if (
      !check(
        'MERCHANT_ALLOWED',
        mandate.allowedMerchantIds.includes(merchant.id),
        mandate.allowedMerchantIds,
        merchant.id,
      )
    ) {
      return block('MERCHANT_NOT_ALLOWED');
    }
    if (!check('OFFER_MERCHANT', offer.merchantId === merchant.id, merchant.id, offer.merchantId)) {
      return block('MERCHANT_NOT_ALLOWED');
    }
    if (!check('OFFER_AVAILABLE', offer.status === 'AVAILABLE', 'AVAILABLE', offer.status)) {
      return block('OFFER_NOT_AVAILABLE');
    }

    // 5. Checkout binding and integrity.
    if (!check('CHECKOUT_OFFER', checkout.offerId === offer.id, offer.id, checkout.offerId)) {
      return block('CHECKOUT_HASH_MISMATCH');
    }
    if (
      !check(
        'CHECKOUT_INTEGRITY',
        checkout.hash === checkout.computedHash,
        checkout.hash,
        checkout.computedHash,
      )
    ) {
      return block('CHECKOUT_HASH_MISMATCH');
    }
    if (
      !check('CHECKOUT_TOTAL', equalMoney(checkout.total, offer.total), offer.total, checkout.total)
    ) {
      return block('CHECKOUT_HASH_MISMATCH');
    }
    if (
      !check(
        'CHECKOUT_EXPIRY',
        nowMs < Date.parse(checkout.expiresAt),
        checkout.expiresAt,
        input.now,
      )
    ) {
      return block('CHECKOUT_EXPIRED');
    }

    // 6. Currency before any amount comparison.
    const currencyOk =
      mandate.limits.currency === checkout.total.currency &&
      mandate.limits.currency === offer.total.currency;
    if (!check('CURRENCY', currencyOk, mandate.limits.currency, checkout.total.currency)) {
      return block('CURRENCY_MISMATCH');
    }

    // 7. Intent. The offer kind must match the mandate's intent type, then kind-specific
    //    hard constraints apply; only a flight's date window is approvable.
    const intent = mandate.intent;
    let dateOk = true;
    if (!check('INTENT_KIND', offer.kind === intent.type, intent.type, offer.kind)) {
      return block('INTENT_MISMATCH');
    }
    if (intent.type === 'flight') {
      const origin = normalizeCode(offer.origin ?? '');
      const destination = normalizeCode(offer.destination ?? '');
      const routeOk = origin === intent.origin && destination === intent.destination;
      if (
        !check(
          'INTENT_ROUTE',
          routeOk,
          `${intent.origin}->${intent.destination}`,
          `${origin}->${destination}`,
        )
      ) {
        return block('INTENT_MISMATCH');
      }
      if (
        !check(
          'INTENT_CABIN',
          normalizeCabin(offer.cabin ?? '') === intent.cabin,
          intent.cabin,
          offer.cabin ?? null,
        )
      ) {
        return block('INTENT_MISMATCH');
      }
      if (
        !check(
          'INTENT_PASSENGERS',
          offer.passengerCount === intent.passengerCount,
          intent.passengerCount,
          offer.passengerCount ?? null,
        )
      ) {
        return block('INTENT_MISMATCH');
      }
      const departureDate = (offer.departureAt ?? '').slice(0, 10);
      dateOk = departureDate >= intent.departureDateFrom && departureDate <= intent.departureDateTo;
      check(
        'INTENT_DATES',
        dateOk,
        { from: intent.departureDateFrom, to: intent.departureDateTo },
        departureDate,
      );
    } else {
      // Goods: the offer must have been discovered under this mandate's exact query (the
      // server records the query at discovery time; the agent cannot relabel an offer).
      const queryOk =
        offer.searchQuery !== undefined &&
        normalizeQuery(offer.searchQuery) === normalizeQuery(intent.query);
      if (!check('INTENT_QUERY', queryOk, intent.query, offer.searchQuery ?? null)) {
        return block('INTENT_MISMATCH');
      }
      if (
        !check(
          'INTENT_QUANTITY',
          offer.quantity <= intent.maxQuantity,
          intent.maxQuantity,
          offer.quantity,
        )
      ) {
        return block('INTENT_MISMATCH');
      }
    }

    // 8. Usage count is never approvable: a one-use mandate fulfils once.
    const nextCount = runtime.consumedCount + runtime.reservedCount + 1;
    if (
      !check(
        'USAGE_COUNT',
        nextCount <= mandate.limits.maxFulfillments,
        mandate.limits.maxFulfillments,
        nextCount,
      )
    ) {
      return block('USAGE_EXHAUSTED');
    }

    // 9. Amounts.
    const amount = checkout.total.minor;
    const perPurchaseOk = amount <= mandate.limits.maxPerPurchaseMinor;
    check('AMOUNT_PER_PURCHASE', perPurchaseOk, mandate.limits.maxPerPurchaseMinor, amount);
    const projectedTotal = runtime.consumedMinor + runtime.reservedMinor + amount;
    const totalOk = projectedTotal <= mandate.limits.maxTotalMinor;
    check('AMOUNT_TOTAL', totalOk, mandate.limits.maxTotalMinor, projectedTotal);

    const exceptions: Array<'AMOUNT_PER_PURCHASE' | 'AMOUNT_TOTAL' | 'DATE_WINDOW'> = [];
    if (!perPurchaseOk) exceptions.push('AMOUNT_PER_PURCHASE');
    if (!totalOk) exceptions.push('AMOUNT_TOTAL');
    if (!dateOk) exceptions.push('DATE_WINDOW');

    // 10. A checkout-scoped approval applies only to this exact checkout hash, while active.
    let approvalValid = false;
    if (checkoutScopedApproval) {
      approvalValid =
        checkoutScopedApproval.checkoutHash === checkout.hash &&
        checkoutScopedApproval.status === 'ACTIVE' &&
        nowMs < Date.parse(checkoutScopedApproval.expiresAt);
      check(
        'APPROVAL_SCOPE',
        approvalValid,
        { checkoutHash: checkout.hash, status: 'ACTIVE', expiresAfter: input.now },
        {
          checkoutHash: checkoutScopedApproval.checkoutHash,
          status: checkoutScopedApproval.status,
          expiresAt: checkoutScopedApproval.expiresAt,
        },
      );
    }

    if (exceptions.length === 0) {
      check('WITHIN_MANDATE', true, 'no exceptions', exceptions);
      return finish('ALLOW', 'ALLOW_WITHIN_MANDATE');
    }
    check('WITHIN_MANDATE', false, 'no exceptions', exceptions);

    if (checkoutScopedApproval) {
      return approvalValid ? finish('ALLOW', 'ALLOW_CHECKOUT_APPROVAL') : block('APPROVAL_INVALID');
    }
    if (mandate.escalation === 'require_human') {
      const amountException = exceptions.some((code) => code.startsWith('AMOUNT'));
      return finish(
        'REQUIRE_HUMAN',
        amountException ? 'REQUIRE_HUMAN_AMOUNT' : 'REQUIRE_HUMAN_CONDITION',
      );
    }
    return block(
      exceptions.some((code) => code.startsWith('AMOUNT')) ? 'AMOUNT_EXCEEDED' : 'INTENT_MISMATCH',
    );
  } catch (error) {
    check(
      'EVALUATOR_ERROR',
      false,
      'no exception',
      error instanceof Error ? error.message : 'unknown',
    );
    return block('INTERNAL_FAIL_CLOSED');
  }
}

function runtimeReason(status: MandateState): ReasonCode {
  switch (status) {
    case 'REVOKED':
      return 'MANDATE_REVOKED';
    case 'EXPIRED':
      return 'MANDATE_EXPIRED';
    case 'SUPERSEDED':
      return 'MANDATE_SUPERSEDED';
    case 'DRAFT':
      return 'MANDATE_NOT_ACTIVE';
    default:
      return 'INTERNAL_FAIL_CLOSED';
  }
}

/** IATA codes compare upper-case; cabins compare lower-case. Never trust label casing. */
function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCabin(value: string): string {
  return value.trim().toLowerCase();
}

function getProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function extractNow(rawInput: unknown): string {
  const now = getProperty(rawInput, 'now');
  if (typeof now === 'string' && !Number.isNaN(Date.parse(now))) return new Date(now).toISOString();
  return new Date().toISOString();
}

function formatIssue(issue: { path: PropertyKey[]; message: string }): string {
  return `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`;
}
