import type { PurchasingAgentGateway } from './gateway.js';
import {
  AgentRunResultSchema,
  marketsOf,
  PurchasingTaskSchema,
  type AgentOffer,
  type AgentRunResult,
  type FlightPurchasingTask,
  type PurchasingTask,
} from './schemas.js';
import { findOverBudgetRecommendation, recommendationReason } from './recommendation.js';
import { RedactedTrace, type AgentTraceEvent } from './trace.js';

export type AgentExecution = Readonly<{
  result: AgentRunResult;
  trace: readonly AgentTraceEvent[];
}>;

export type ScriptedRunOptions = Readonly<{
  signal?: AbortSignal;
  requestedMode?: 'scripted' | 'openai';
  fallbackUsed?: boolean;
  trace?: RedactedTrace;
}>;

export async function runScriptedPurchasingAgent(
  taskInput: PurchasingTask,
  gateway: PurchasingAgentGateway,
  options: ScriptedRunOptions = {},
): Promise<AgentExecution> {
  const task = PurchasingTaskSchema.parse(taskInput);
  const trace = options.trace ?? new RedactedTrace();
  trace.add('RUN_STARTED', { requestedMode: options.requestedMode ?? 'scripted' });

  const search =
    task.kind === 'goods'
      ? await gateway.searchProducts({ query: task.query }, { signal: options.signal })
      : await gateway.searchFlights(searchInput(task), { signal: options.signal });
  const offers = [...search.offers].sort(compareOffers);
  const marketsSearched = marketsOf(offers);
  trace.add('SEARCH_COMPLETED', {
    offerCount: offers.length,
    offerIds: offers.map((offer) => offer.offerId),
    markets: marketsSearched,
    merchants: [...new Set(offers.map((offer) => offer.merchantName))],
  });

  const qualifying = offers.filter(
    (offer) =>
      offer.currency === task.currency &&
      offer.totalMinor <= task.maxAmountMinor &&
      (task.kind !== 'goods' || offer.quantity <= task.maxQuantity),
  );
  const selected = qualifying[0];
  if (!selected) {
    const recommendation = findOverBudgetRecommendation(offers, task);
    const selectionReason = recommendation
      ? recommendationReason(recommendation)
      : noMatchReason(offers, task);
    trace.add(recommendation ? 'RECOMMENDATION_FOUND' : 'NO_MATCH', {
      maxAmountMinor: task.maxAmountMinor,
      currency: task.currency,
      reason: selectionReason,
      ...(recommendation
        ? {
            offerId: recommendation.offerId,
            overageMinor: recommendation.overageMinor,
            overagePercent: recommendation.overagePercent,
          }
        : {}),
    });
    return {
      result: AgentRunResultSchema.parse({
        requestedMode: options.requestedMode ?? 'scripted',
        executedMode: 'scripted',
        fallbackUsed: options.fallbackUsed ?? false,
        outcome: recommendation ? 'RECOMMENDATION' : 'NO_MATCH',
        consideredOfferIds: offers.map((offer) => offer.offerId),
        marketsSearched,
        selectionReason,
        recommendation,
      }),
      trace: trace.snapshot(),
    };
  }
  const selectionReason = selectedReason(selected, qualifying, offers, marketsSearched);
  trace.add('OFFER_SELECTED', {
    offerId: selected.offerId,
    merchant: selected.merchantName,
    market: selected.market,
    reason: selectionReason,
  });

  const purchase = await gateway.requestPurchase(
    { mandateId: task.mandateId, offerId: selected.offerId, checkoutId: selected.checkoutId },
    { signal: options.signal },
  );
  trace.add('PURCHASE_REQUESTED', {
    offerId: selected.offerId,
    checkoutId: selected.checkoutId,
    executionId: purchase.executionId,
    decision: purchase.decision,
  });

  return {
    result: AgentRunResultSchema.parse({
      requestedMode: options.requestedMode ?? 'scripted',
      executedMode: 'scripted',
      fallbackUsed: options.fallbackUsed ?? false,
      outcome: 'PURCHASE_REQUESTED',
      consideredOfferIds: offers.map((offer) => offer.offerId),
      marketsSearched,
      selectedOfferId: selected.offerId,
      selectionReason,
      purchase,
    }),
    trace: trace.snapshot(),
  };
}

function searchInput(task: FlightPurchasingTask) {
  const { origin, destination, departureDateFrom, departureDateTo } = task;
  return { origin, destination, departureDateFrom, departureDateTo };
}

/** How the reason names an option: merchant/market for flights, product title for goods. */
function label(offer: AgentOffer): string {
  return offer.kind === 'goods' && offer.title
    ? `${offer.title} at ${offer.merchantName} (${offer.market})`
    : `${offer.merchantName} (${offer.market})`;
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

function selectedReason(
  selected: AgentOffer,
  qualifying: readonly AgentOffer[],
  all: readonly AgentOffer[],
  markets: readonly string[],
): string {
  const runnerUp = qualifying[1];
  const scope = `Searched ${all.length} offer${all.length === 1 ? '' : 's'} across ${markets.length} market${markets.length === 1 ? '' : 's'} (${markets.join(', ')}); ${qualifying.length} within the limit.`;
  const pick = `Chose ${label(selected)} at ${money(selected.totalMinor, selected.currency)}, the lowest qualifying total`;
  const versus = runnerUp
    ? `, ${money(runnerUp.totalMinor - selected.totalMinor, selected.currency)} less than the next option, ${label(runnerUp)}.`
    : '.';
  return `${scope} ${pick}${versus}`;
}

function noMatchReason(all: readonly AgentOffer[], task: PurchasingTask): string {
  const markets = marketsOf(all);
  if (all.length === 0)
    return 'No merchant in any market returned an offer for this route and window.';
  const cheapest = all[0]!;
  return `Searched ${all.length} offer${all.length === 1 ? '' : 's'} across ${markets.length} market${markets.length === 1 ? '' : 's'} (${markets.join(', ')}); the cheapest was ${label(cheapest)} at ${money(cheapest.totalMinor, cheapest.currency)}, above the ${money(task.maxAmountMinor, task.currency)} limit. Did not request a purchase.`;
}

function compareOffers(left: AgentOffer, right: AgentOffer): number {
  return (
    left.totalMinor - right.totalMinor ||
    (left.departureAt ?? '').localeCompare(right.departureAt ?? '') ||
    left.offerId.localeCompare(right.offerId)
  );
}
