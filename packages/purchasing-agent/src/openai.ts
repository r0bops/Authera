import { Agent, Runner, setDefaultOpenAIKey, tool, type Model } from '@openai/agents';
import type { z } from 'zod';
import type { PurchasingAgentGateway } from './gateway.js';
import {
  AgentRunResultSchema,
  marketsOf,
  PurchasingTaskSchema,
  RequestPurchaseToolCallSchema,
  SearchFlightsInputSchema,
  SearchProductsInputSchema,
  type AgentRunResult,
  type FlightPurchasingTask,
  type PurchasingTask,
} from './schemas.js';
import { findOverBudgetRecommendation, recommendationReason } from './recommendation.js';
import { boundedToolResult, RedactedTrace, type AgentTraceEvent } from './trace.js';

export class OpenAiPurchasingAgentError extends Error {
  constructor(
    message: string,
    readonly purchaseInvoked: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OpenAiPurchasingAgentError';
  }
}

export type OpenAiAgentOptions = Readonly<{
  apiKey?: string;
  model: string;
  modelOverride?: Model;
  maxTurns?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxToolResultBytes?: number;
  trace?: RedactedTrace;
}>;

export type OpenAiAgentExecution = Readonly<{
  result: AgentRunResult;
  trace: readonly AgentTraceEvent[];
}>;

export async function runOpenAiPurchasingAgent(
  taskInput: PurchasingTask,
  gateway: PurchasingAgentGateway,
  options: OpenAiAgentOptions,
): Promise<OpenAiAgentExecution> {
  const task = PurchasingTaskSchema.parse(taskInput);
  const trace = options.trace ?? new RedactedTrace();
  const maxTurns = options.maxTurns ?? 5;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxToolResultBytes = options.maxToolResultBytes ?? 12_000;
  let purchaseInvoked = false;
  let consideredOfferIds: string[] = [];
  let marketsSearched: string[] = [];
  let selectionReason: string | undefined;
  let authoritativeOffers: Awaited<ReturnType<typeof gateway.searchFlights>>['offers'] = [];
  const authoritativeCheckouts = new Map<string, string>();
  let selectedOfferId: string | undefined;
  let purchase: AgentRunResult['purchase'];

  if (!options.modelOverride) {
    if (!options.apiKey) throw new OpenAiPurchasingAgentError('OpenAI API key is required', false);
    setDefaultOpenAIKey(options.apiKey);
  }

  trace.add('RUN_STARTED', { requestedMode: 'openai', model: options.model });

  const recordSearch = (result: Awaited<ReturnType<typeof gateway.searchFlights>>) => {
    authoritativeOffers = [...result.offers];
    consideredOfferIds = result.offers.map((offer) => offer.offerId);
    marketsSearched = marketsOf(result.offers);
    authoritativeCheckouts.clear();
    for (const offer of result.offers) authoritativeCheckouts.set(offer.offerId, offer.checkoutId);
    trace.add('SEARCH_COMPLETED', {
      offerCount: result.offers.length,
      offerIds: consideredOfferIds,
      markets: marketsSearched,
      merchants: [...new Set(result.offers.map((offer) => offer.merchantName))],
    });
  };

  const searchProducts = tool({
    name: 'search_products',
    description:
      'Search authoritative product offers from every connected store for the exact product description in the task. Each offer names its store, title, quantity and total.',
    parameters: SearchProductsInputSchema,
    strict: true,
    execute: async (input) => {
      if (task.kind !== 'goods' || input.query !== task.query) {
        throw new Error('Search input does not match the assigned purchasing task');
      }
      const result = await gateway.searchProducts(input, {
        signal: combinedSignal(options.signal, timeoutMs),
      });
      recordSearch(result);
      return boundedToolResult(result, maxToolResultBytes);
    },
  });

  const searchFlights = tool({
    name: 'search_flights',
    description:
      'Search authoritative flight offers from every connected merchant and market for one route and date range. Each offer names its merchant and market.',
    parameters: SearchFlightsInputSchema,
    strict: true,
    execute: async (input) => {
      if (task.kind !== 'flight' || !searchMatchesTask(input, task)) {
        throw new Error('Search input does not match the assigned purchasing task');
      }
      const result = await gateway.searchFlights(input, {
        signal: combinedSignal(options.signal, timeoutMs),
      });
      recordSearch(result);
      return boundedToolResult(result, maxToolResultBytes);
    },
  });

  const requestPurchase = tool({
    name: 'request_purchase',
    description:
      'Request a purchase through the deterministic mandate gateway. Accepts identifiers plus a one-sentence reason comparing the chosen offer with the alternatives; the reason is recorded for the human and never changes the decision.',
    parameters: RequestPurchaseToolCallSchema,
    strict: true,
    execute: async ({ reason, ...input }) => {
      const candidate = authoritativeOffers.find((offer) => offer.offerId === input.offerId);
      if (
        input.mandateId !== task.mandateId ||
        !candidate ||
        authoritativeCheckouts.get(input.offerId) !== input.checkoutId
      ) {
        throw new Error('Purchase identifiers were not authorized by this run search result');
      }
      const withinTaskLimit =
        candidate.currency === task.currency &&
        candidate.totalMinor <= task.maxAmountMinor &&
        (task.kind !== 'goods' || candidate.quantity <= task.maxQuantity);
      if (!withinTaskLimit) {
        return boundedToolResult(
          {
            ok: false,
            error: {
              code: 'OFFER_OUTSIDE_TASK_LIMIT',
              message: 'This offer may be recommended but cannot be sent for purchase.',
            },
          },
          maxToolResultBytes,
        );
      }
      purchaseInvoked = true;
      selectedOfferId = input.offerId;
      selectionReason = reason;
      trace.add('OFFER_SELECTED', { offerId: input.offerId, reason });
      purchase = await gateway.requestPurchase(input, {
        signal: combinedSignal(options.signal, timeoutMs),
      });
      trace.add('PURCHASE_REQUESTED', {
        offerId: input.offerId,
        checkoutId: input.checkoutId,
        executionId: purchase.executionId,
        decision: purchase.decision,
      });
      return boundedToolResult(purchase, maxToolResultBytes);
    },
  });

  const agent = new Agent({
    name: 'Authera purchasing agent',
    instructions: [
      'You discover offers and may request one purchase, but you never authorize payments.',
      task.kind === 'goods'
        ? 'Call search_products first with the exact product description in the task; it returns offers from connected stores with title, quantity and total.'
        : 'Call search_flights first using the exact route and date range in the task; it returns offers from several merchants in different markets.',
      task.kind === 'goods'
        ? 'Compare every returned offer. Prefer the lowest total at or below the task maximum amount in the task currency whose quantity does not exceed the task maximum quantity; break ties by the closest match to the description.'
        : 'Compare every returned offer across merchants and markets. Prefer the lowest total that is at or below the task maximum amount in the task currency; break ties by the earliest departure.',
      'Choose only an authoritative returned offer. Then call request_purchase with mandateId, offerId, checkoutId, and a one-sentence reason that names what you chose (store/merchant, market, product or flight) and the best alternative you rejected.',
      'Never invent prices, checkout IDs, payment data, policy verdicts, or authorization state.',
      'If no qualifying offer exists, finish without calling request_purchase and reply with one sentence explaining why (cheapest offer, where it was, and the limit).',
    ].join(' '),
    model: options.modelOverride ?? options.model,
    tools: [task.kind === 'goods' ? searchProducts : searchFlights, requestPurchase],
    toolUseBehavior: { stopAtToolNames: ['request_purchase'] },
  });

  const runner = new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    workflowName: 'Authera purchasing agent',
  });

  let finalOutput: unknown;
  try {
    const run = await runner.run(agent, promptFor(task), {
      maxTurns,
      signal: combinedSignal(options.signal, timeoutMs),
      toolExecution: { maxFunctionToolConcurrency: 1 },
      toolNameCollisionPolicy: 'error',
      toolNotFoundBehavior: 'raise_error',
    });
    finalOutput = run.finalOutput;
  } catch (error) {
    trace.add('RUN_FAILED', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    throw new OpenAiPurchasingAgentError('OpenAI purchasing agent failed', purchaseInvoked, {
      cause: error,
    });
  }

  const recommendation = purchase
    ? undefined
    : findOverBudgetRecommendation(authoritativeOffers, task);
  if (recommendation) {
    trace.add('RECOMMENDATION_FOUND', {
      offerId: recommendation.offerId,
      overageMinor: recommendation.overageMinor,
      overagePercent: recommendation.overagePercent,
      tolerancePercent: recommendation.tolerancePercent,
    });
  }

  return {
    result: AgentRunResultSchema.parse({
      requestedMode: 'openai',
      executedMode: 'openai',
      fallbackUsed: false,
      outcome: purchase ? 'PURCHASE_REQUESTED' : recommendation ? 'RECOMMENDATION' : 'NO_MATCH',
      consideredOfferIds,
      marketsSearched,
      selectedOfferId,
      selectionReason: recommendation
        ? recommendationReason(recommendation)
        : (selectionReason ??
          (typeof finalOutput === 'string' && finalOutput.trim().length > 0
            ? finalOutput.trim().slice(0, 280)
            : undefined)),
      recommendation,
      purchase,
    }),
    trace: trace.snapshot(),
  };
}

function promptFor(task: PurchasingTask): string {
  if (task.kind === 'goods') {
    return JSON.stringify({
      mandateId: task.mandateId,
      product: task.query,
      maximumQuantity: task.maxQuantity,
      maximum: { amountMinor: task.maxAmountMinor, currency: task.currency },
    });
  }
  return JSON.stringify({
    mandateId: task.mandateId,
    route: { origin: task.origin, destination: task.destination },
    departureDateRange: {
      from: task.departureDateFrom,
      to: task.departureDateTo,
    },
    maximum: { amountMinor: task.maxAmountMinor, currency: task.currency },
  });
}

function searchMatchesTask(
  input: z.infer<typeof SearchFlightsInputSchema>,
  task: FlightPurchasingTask,
): boolean {
  return (
    input.origin === task.origin &&
    input.destination === task.destination &&
    input.departureDateFrom === task.departureDateFrom &&
    input.departureDateTo === task.departureDateTo
  );
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
