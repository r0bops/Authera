import type { PurchasingAgentGateway } from './gateway.js';
import {
  AgentRunResultSchema,
  PurchasingTaskSchema,
  type AgentOffer,
  type AgentRunResult,
  type PurchasingTask,
} from './schemas.js';
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

  const search = await gateway.searchFlights(searchInput(task), { signal: options.signal });
  const offers = [...search.offers].sort(compareOffers);
  trace.add('SEARCH_COMPLETED', {
    offerCount: offers.length,
    offerIds: offers.map((offer) => offer.offerId),
  });

  const selected = offers.find(
    (offer) => offer.currency === task.currency && offer.totalMinor <= task.maxAmountMinor,
  );
  if (!selected) {
    trace.add('NO_MATCH', { maxAmountMinor: task.maxAmountMinor, currency: task.currency });
    return {
      result: AgentRunResultSchema.parse({
        requestedMode: options.requestedMode ?? 'scripted',
        executedMode: 'scripted',
        fallbackUsed: options.fallbackUsed ?? false,
        outcome: 'NO_MATCH',
        consideredOfferIds: offers.map((offer) => offer.offerId),
      }),
      trace: trace.snapshot(),
    };
  }

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
      selectedOfferId: selected.offerId,
      purchase,
    }),
    trace: trace.snapshot(),
  };
}

function searchInput(task: PurchasingTask) {
  const { origin, destination, departureDateFrom, departureDateTo } = task;
  return { origin, destination, departureDateFrom, departureDateTo };
}

function compareOffers(left: AgentOffer, right: AgentOffer): number {
  return (
    left.totalMinor - right.totalMinor ||
    left.departureAt.localeCompare(right.departureAt) ||
    left.offerId.localeCompare(right.offerId)
  );
}
