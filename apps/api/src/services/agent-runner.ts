import { randomUUID } from 'node:crypto';
import type {
  DemoAttemptResult,
  DemoDirectAttemptResult,
  PurchaseAttemptResponse,
} from '@authera/contracts';
import {
  CheckoutSessionSchema,
  PurchaseAttemptResponseSchema,
  effectiveFlightDateWindow,
} from '@authera/contracts';
import { getAgentById, getMandate, SEED_IDS, type Database } from '@authera/db';
import { ed25519FromSeed, seedFromSecret, type KeyMaterial, type KeyPair } from '@authera/domain';
import {
  AgentHttpClientTransport,
  HttpPurchasingAgentGateway,
  PurchasingAgentService,
  type PurchasingTask,
} from '@authera/purchasing-agent';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';
import { AGENT_TAGS } from '../middleware/agent-signature.js';
import { AgentHttpClient } from './agent-client.js';
import type { AgentOutcomeEvent } from './chat-narrator.js';

export interface CapturedRequest {
  executionId: string;
  path: string;
  keyid: string;
  nonce: string;
  at: string;
  request: Request;
}

export interface AgentRunnerDependencies {
  db: Database;
  keys: KeyMaterial;
  clock: Clock;
  config: AppConfig;
  logger: Logger;
  /** Told after every attempt that produced a gateway verdict (or an agent run without one). */
  onOutcome?: (event: AgentOutcomeEvent) => void;
  /** In-process transport: the same Hono app, so every demo call passes the signature middleware. */
  fetch: (request: Request) => Promise<Response>;
}

/**
 * Runs the purchasing agent (scripted or OpenAI, from `@authera/purchasing-agent`) and the
 * demo attempt variants (direct, impersonated, replayed, concurrent). All of them speak to the
 * gateway over signed HTTP; none can bypass verification or create a successful execution.
 */
export class AgentRunner {
  private readonly captured = new Map<string, CapturedRequest>();
  private readonly impostor: KeyPair;

  constructor(private readonly deps: AgentRunnerDependencies) {
    // An unregistered key that advertises the real agent's key id: a forged identity.
    this.impostor = ed25519FromSeed(
      seedFromSecret(deps.config.demo.resetSecret ?? 'authera-impostor', 'impostor'),
      'impostor',
    );
  }

  private async client(keyPair?: KeyPair): Promise<AgentHttpClient> {
    const agent = await getAgentById(this.deps.db, SEED_IDS.agent);
    if (!agent) throw ApiProblem.notFound('demo agent');
    return new AgentHttpClient({
      keyPair: keyPair ?? this.deps.keys.agent,
      profileUri: agent.profileUri,
      baseUrl: this.deps.config.publicBaseUrl,
      clock: this.deps.clock,
      fetch: this.deps.fetch,
    });
  }

  /** Let the agent discover offers and decide, then request purchase through the gateway. */
  async run(input: {
    mandateId: string;
    mode?: 'scripted' | 'openai';
    trigger?: 'watch' | 'demo';
  }): Promise<DemoAttemptResult> {
    const mandate = await getMandate(this.deps.db, input.mandateId);
    if (!mandate) throw ApiProblem.notFound('mandate');
    const policy = mandate.policy;
    const limits = {
      mandateId: policy.mandateId,
      maxAmountMinor: policy.limits.maxPerPurchaseMinor,
      currency: policy.limits.currency,
    };
    const task: PurchasingTask =
      policy.intent.type === 'goods'
        ? {
            kind: 'goods',
            query: policy.intent.query,
            maxQuantity: policy.intent.maxQuantity,
            ...limits,
          }
        : (() => {
            const dates = effectiveFlightDateWindow(policy.intent);
            return {
              kind: 'flight',
              origin: policy.intent.origin,
              destination: policy.intent.destination,
              departureDateFrom: dates.from,
              departureDateTo: dates.to,
              ...limits,
            };
          })();
    const mode = input.mode ?? this.deps.config.agent.mode;
    const client = await this.client();
    const gateway = new HttpPurchasingAgentGateway(new AgentHttpClientTransport(client), () =>
      randomUUID(),
    );
    const service = new PurchasingAgentService(
      gateway,
      mode === 'openai' && this.deps.config.agent.mode === 'openai'
        ? {
            mode: 'openai',
            apiKey: this.deps.config.agent.apiKey,
            model: this.deps.config.agent.model,
            fallbackToScripted: true,
            timeoutMs: 30_000,
          }
        : { mode: 'scripted', timeoutMs: 15_000 },
    );
    const execution = await service.run(task);
    this.deps.logger.info(
      {
        mandateId: input.mandateId,
        outcome: execution.result.outcome,
        mode: execution.result.executedMode,
      },
      'agent run finished',
    );
    this.deps.onOutcome?.({
      mandateId: input.mandateId,
      trigger: input.trigger ?? 'demo',
      outcome: execution.result.outcome,
      consideredCount: execution.result.consideredOfferIds.length,
      ...(execution.result.selectedOfferId ? { offerId: execution.result.selectedOfferId } : {}),
      ...(execution.result.purchase ? { purchase: execution.result.purchase } : {}),
      limit: { minor: policy.limits.maxPerPurchaseMinor, currency: policy.limits.currency },
    });
    return {
      mode: execution.result.executedMode,
      fallbackUsed: execution.result.fallbackUsed,
      outcome: execution.result.outcome,
      consideredOfferIds: execution.result.consideredOfferIds,
      marketsSearched: execution.result.marketsSearched,
      ...(execution.result.selectedOfferId
        ? { selectedOfferId: execution.result.selectedOfferId }
        : {}),
      ...(execution.result.selectionReason
        ? { selectionReason: execution.result.selectionReason }
        : {}),
      ...(execution.result.recommendation
        ? { recommendation: execution.result.recommendation }
        : {}),
      ...(execution.result.purchase ? { purchase: execution.result.purchase } : {}),
      trace: execution.trace.map((e) => ({ at: e.at, event: e.event, data: { ...e.data } })),
    };
  }

  /** One signed attempt for a chosen offer (creates a checkout unless one is supplied). */
  async direct(input: {
    mandateId: string;
    offerId: string;
    checkoutId?: string;
    impersonate?: boolean;
    executionId?: string;
    trigger?: 'watch' | 'demo';
  }): Promise<DemoDirectAttemptResult> {
    const client = await this.client(input.impersonate ? this.impostor : undefined);
    const checkoutClient = input.impersonate ? await this.client() : client;
    const sessionResponse = await checkoutClient.call<{
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string };
    }>(
      input.checkoutId
        ? {
            method: 'GET',
            path: `/ucp/v1/checkout-sessions/${input.checkoutId}`,
            tag: AGENT_TAGS.browse,
          }
        : {
            method: 'POST',
            path: '/ucp/v1/checkout-sessions',
            body: { offerId: input.offerId },
            tag: AGENT_TAGS.browse,
          },
    );
    if (!sessionResponse.body.ok)
      throw ApiProblem.conflict(
        sessionResponse.body.error?.code ?? 'CHECKOUT_FAILED',
        sessionResponse.body.error?.message ?? 'checkout lookup failed',
      );
    const session = CheckoutSessionSchema.parse(sessionResponse.body.data);
    const checkoutId = session.id;
    const executionId = input.executionId ?? randomUUID();
    // The closed Checkout Mandate is signed with whichever key sends the request: the real agent,
    // or the impostor (whose HTTP signature is rejected before the mandate is ever read).
    const closedCheckoutJws = await client.signClosedCheckout(
      {
        executionId,
        mandateId: input.mandateId,
        offerId: input.offerId,
        checkoutId,
        cartHash: session.cartHash,
        total: session.total,
      },
      input.impersonate
        ? { ...this.impostor, thumbprint: this.deps.keys.agent.thumbprint }
        : undefined,
    );
    const request = client.build({
      method: 'POST',
      path: '/api/purchase-attempts',
      body: {
        executionId,
        mandateId: input.mandateId,
        offerId: input.offerId,
        checkoutId,
        closedCheckoutJws,
      },
      tag: AGENT_TAGS.payment,
      // The impostor signs with its own key but advertises the real agent's key id.
      ...(input.impersonate
        ? { keyPair: { ...this.impostor, thumbprint: this.deps.keys.agent.thumbprint } }
        : {}),
    });
    const keyid = /keyid="([^"]+)"/.exec(request.headers.get('signature-input') ?? '')?.[1] ?? '';
    const nonce = /nonce="([^"]+)"/.exec(request.headers.get('signature-input') ?? '')?.[1] ?? '';
    this.remember({
      executionId,
      path: '/api/purchase-attempts',
      keyid,
      nonce,
      at: this.deps.clock.now().toISOString(),
      request: request.clone(),
    });
    const response = await this.deps.fetch(request);
    const body = (await response.json()) as { ok: boolean; data?: unknown };
    const purchase = body.ok ? PurchaseAttemptResponseSchema.safeParse(body.data) : undefined;
    if (purchase?.success && !input.impersonate) {
      const mandate = await getMandate(this.deps.db, input.mandateId);
      this.deps.onOutcome?.({
        mandateId: input.mandateId,
        trigger: input.trigger ?? 'demo',
        offerId: input.offerId,
        purchase: purchase.data,
        ...(mandate
          ? {
              limit: {
                minor: mandate.policy.limits.maxPerPurchaseMinor,
                currency: mandate.policy.limits.currency,
              },
            }
          : {}),
      });
    }
    return {
      status: response.status,
      response: body,
      ...(purchase?.success ? { purchase: purchase.data } : {}),
      checkoutId,
      signedRequest: { method: 'POST', path: '/api/purchase-attempts', keyid, nonce },
    };
  }

  /** Re-send a captured signed request byte-for-byte; the nonce store must reject it. */
  async replay(executionId: string): Promise<DemoDirectAttemptResult> {
    const captured = this.captured.get(executionId);
    if (!captured) throw ApiProblem.notFound('captured signed request');
    const response = await this.deps.fetch(captured.request.clone());
    const body = (await response.json()) as { ok: boolean; data?: unknown };
    const purchase = body.ok ? PurchaseAttemptResponseSchema.safeParse(body.data) : undefined;
    return {
      status: response.status,
      response: body,
      ...(purchase?.success ? { purchase: purchase.data } : {}),
      signedRequest: {
        method: 'POST',
        path: captured.path,
        keyid: captured.keyid,
        nonce: captured.nonce,
      },
    };
  }

  /** Race N distinct executions against the same checkout; the database admits at most the allowance. */
  async concurrent(input: {
    mandateId: string;
    offerId: string;
    attempts: number;
  }): Promise<DemoDirectAttemptResult[]> {
    // One checkout, N signed attempts fired at the same instant: the reservation row decides.
    const client = await this.client();
    const created = await client.call<{ ok: boolean; data?: unknown }>({
      method: 'POST',
      path: '/ucp/v1/checkout-sessions',
      body: { offerId: input.offerId },
      tag: AGENT_TAGS.browse,
    });
    if (!created.body.ok) throw ApiProblem.conflict('CHECKOUT_FAILED', 'checkout creation failed');
    const checkoutId = CheckoutSessionSchema.parse(created.body.data).id;
    return Promise.all(
      Array.from({ length: input.attempts }, () =>
        this.direct({ mandateId: input.mandateId, offerId: input.offerId, checkoutId }),
      ),
    );
  }

  capturedRequests(): Array<Omit<CapturedRequest, 'request'>> {
    return [...this.captured.values()].map(({ request: _request, ...rest }) => rest);
  }

  reset(): void {
    this.captured.clear();
  }

  private remember(entry: CapturedRequest): void {
    this.captured.set(entry.executionId, entry);
    if (this.captured.size > 50) {
      const oldest = this.captured.keys().next().value;
      if (oldest) this.captured.delete(oldest);
    }
  }

  static purchaseOf(result: DemoDirectAttemptResult): PurchaseAttemptResponse | undefined {
    return result.purchase;
  }
}
