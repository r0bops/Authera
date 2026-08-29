import {
  AgentHttpClientTransport,
  HttpPurchasingAgentGateway,
  type ExecutionIdFactory,
  type PurchasingAgentGateway,
  type SignedAgentHttpClient,
} from './gateway.js';
import {
  OpenAiPurchasingAgentError,
  runOpenAiPurchasingAgent,
  type OpenAiAgentExecution,
  type OpenAiAgentOptions,
} from './openai.js';
import type { PurchasingTask } from './schemas.js';
import { runScriptedPurchasingAgent, type AgentExecution } from './scripted.js';
import { RedactedTrace } from './trace.js';

export type OpenAiRun = (
  task: PurchasingTask,
  gateway: PurchasingAgentGateway,
  options: OpenAiAgentOptions,
) => Promise<OpenAiAgentExecution>;

export type PurchasingAgentServiceOptions =
  | Readonly<{ mode: 'scripted'; timeoutMs?: number }>
  | Readonly<{
      mode: 'openai';
      apiKey: string;
      model: string;
      maxTurns?: number;
      timeoutMs?: number;
      fallbackToScripted?: boolean;
      openAiRun?: OpenAiRun;
    }>;

export class PurchasingAgentService {
  constructor(
    private readonly gateway: PurchasingAgentGateway,
    private readonly options: PurchasingAgentServiceOptions,
  ) {}

  async run(task: PurchasingTask, signal?: AbortSignal): Promise<AgentExecution> {
    if (this.options.mode === 'scripted') {
      return runScriptedPurchasingAgent(task, this.gateway, {
        signal: boundedSignal(signal, this.options.timeoutMs ?? 10_000),
      });
    }

    const trace = new RedactedTrace();
    const openAiRun = this.options.openAiRun ?? runOpenAiPurchasingAgent;
    try {
      return await openAiRun(task, this.gateway, {
        apiKey: this.options.apiKey,
        model: this.options.model,
        maxTurns: this.options.maxTurns,
        timeoutMs: this.options.timeoutMs,
        signal,
        trace,
      });
    } catch (error) {
      const canFallback =
        this.options.fallbackToScripted !== false &&
        error instanceof OpenAiPurchasingAgentError &&
        !error.purchaseInvoked;
      if (!canFallback) throw error;

      trace.add('OPENAI_FALLBACK', { errorName: error.name });
      return runScriptedPurchasingAgent(task, this.gateway, {
        signal: boundedSignal(signal, this.options.timeoutMs ?? 10_000),
        requestedMode: 'openai',
        fallbackUsed: true,
        trace,
      });
    }
  }
}

/**
 * Demo entry point that deliberately goes back through signed HTTP instead of calling the
 * mandate gateway in-process. This keeps judge-triggered attempts equivalent to agent traffic.
 */
export class SignedDemoAttemptService {
  readonly #service: PurchasingAgentService;

  constructor(
    client: SignedAgentHttpClient,
    options: PurchasingAgentServiceOptions,
    executionId?: ExecutionIdFactory,
  ) {
    const gateway = new HttpPurchasingAgentGateway(
      new AgentHttpClientTransport(client),
      executionId,
    );
    this.#service = new PurchasingAgentService(gateway, options);
  }

  attempt(task: PurchasingTask, signal?: AbortSignal): Promise<AgentExecution> {
    return this.#service.run(task, signal);
  }
}

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
