import { Agent, Runner, setDefaultOpenAIKey, tool, type Model } from '@openai/agents';
import type { z } from 'zod';
import type { PurchasingAgentGateway } from './gateway.js';
import {
  AgentRunResultSchema,
  PurchasingTaskSchema,
  RequestPurchaseToolInputSchema,
  SearchFlightsInputSchema,
  type AgentRunResult,
  type PurchasingTask,
} from './schemas.js';
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
  const authoritativeCheckouts = new Map<string, string>();
  let selectedOfferId: string | undefined;
  let purchase: AgentRunResult['purchase'];

  if (!options.modelOverride) {
    if (!options.apiKey) throw new OpenAiPurchasingAgentError('OpenAI API key is required', false);
    setDefaultOpenAIKey(options.apiKey);
  }

  trace.add('RUN_STARTED', { requestedMode: 'openai', model: options.model });

  const searchFlights = tool({
    name: 'search_flights',
    description: 'Search authoritative merchant flight offers for one route and date range.',
    parameters: SearchFlightsInputSchema,
    strict: true,
    execute: async (input) => {
      if (!searchMatchesTask(input, task)) {
        throw new Error('Search input does not match the assigned purchasing task');
      }
      const result = await gateway.searchFlights(input, {
        signal: combinedSignal(options.signal, timeoutMs),
      });
      consideredOfferIds = result.offers.map((offer) => offer.offerId);
      authoritativeCheckouts.clear();
      for (const offer of result.offers)
        authoritativeCheckouts.set(offer.offerId, offer.checkoutId);
      trace.add('SEARCH_COMPLETED', {
        offerCount: result.offers.length,
        offerIds: consideredOfferIds,
      });
      return boundedToolResult(result, maxToolResultBytes);
    },
  });

  const requestPurchase = tool({
    name: 'request_purchase',
    description:
      'Request a purchase through the deterministic mandate gateway. Accepts identifiers only.',
    parameters: RequestPurchaseToolInputSchema,
    strict: true,
    execute: async (input) => {
      if (
        input.mandateId !== task.mandateId ||
        authoritativeCheckouts.get(input.offerId) !== input.checkoutId
      ) {
        throw new Error('Purchase identifiers were not authorized by this run search result');
      }
      purchaseInvoked = true;
      selectedOfferId = input.offerId;
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
      'You discover flights and may request one purchase, but you never authorize payments.',
      'Call search_flights first using the exact route and date range in the task.',
      'Choose only an authoritative returned offer at or below the task maximum amount.',
      'Then call request_purchase with only mandateId, offerId, and checkoutId.',
      'Never invent prices, checkout IDs, payment data, policy verdicts, or authorization state.',
      'If no qualifying offer exists, finish without calling request_purchase.',
    ].join(' '),
    model: options.modelOverride ?? options.model,
    tools: [searchFlights, requestPurchase],
    toolUseBehavior: { stopAtToolNames: ['request_purchase'] },
  });

  const runner = new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    workflowName: 'Authera purchasing agent',
  });

  try {
    await runner.run(agent, promptFor(task), {
      maxTurns,
      signal: combinedSignal(options.signal, timeoutMs),
      toolExecution: { maxFunctionToolConcurrency: 1 },
      toolNameCollisionPolicy: 'error',
      toolNotFoundBehavior: 'raise_error',
    });
  } catch (error) {
    trace.add('RUN_FAILED', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    throw new OpenAiPurchasingAgentError('OpenAI purchasing agent failed', purchaseInvoked, {
      cause: error,
    });
  }

  return {
    result: AgentRunResultSchema.parse({
      requestedMode: 'openai',
      executedMode: 'openai',
      fallbackUsed: false,
      outcome: purchase ? 'PURCHASE_REQUESTED' : 'NO_MATCH',
      consideredOfferIds,
      selectedOfferId,
      purchase,
    }),
    trace: trace.snapshot(),
  };
}

function promptFor(task: PurchasingTask): string {
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
  task: PurchasingTask,
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
