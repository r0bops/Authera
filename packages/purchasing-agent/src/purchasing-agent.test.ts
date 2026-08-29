import type { PurchaseAttemptResponse } from '@agentcerta/contracts';
import { ScriptedModel, functionCall } from '@openai/agents/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentHttpClientTransport,
  HttpPurchasingAgentGateway,
  OpenAiPurchasingAgentError,
  PurchasingAgentService,
  RequestPurchaseToolInputSchema,
  SignedDemoAttemptService,
  boundedToolResult,
  redactTraceData,
  runOpenAiPurchasingAgent,
  runScriptedPurchasingAgent,
  type AgentOffer,
  type FlightSearchResult,
  type PurchasingAgentGateway,
  type PurchasingTask,
  type RequestPurchaseToolInput,
  type SearchFlightsInput,
  type SignedGatewayRequest,
  type SignedGatewayTransport,
} from './index.js';

const ID = {
  mandate: '00000000-0000-4000-8000-000000000001',
  offer130: '00000000-0000-4000-8000-000000000002',
  offer145: '00000000-0000-4000-8000-000000000003',
  offer300: '00000000-0000-4000-8000-000000000004',
  checkout130: '00000000-0000-4000-8000-000000000005',
  checkout145: '00000000-0000-4000-8000-000000000006',
  checkout300: '00000000-0000-4000-8000-000000000007',
  execution: '00000000-0000-4000-8000-000000000008',
} as const;

const task: PurchasingTask = {
  mandateId: ID.mandate,
  origin: 'CCS',
  destination: 'COR',
  departureDateFrom: '2026-08-30',
  departureDateTo: '2026-09-30',
  maxAmountMinor: 15_000,
  currency: 'USD',
};

const searchInput: SearchFlightsInput = {
  origin: task.origin,
  destination: task.destination,
  departureDateFrom: task.departureDateFrom,
  departureDateTo: task.departureDateTo,
};

const offers: AgentOffer[] = [
  offer(ID.offer300, ID.checkout300, 30_000, '2026-09-04T10:00:00.000Z'),
  offer(ID.offer145, ID.checkout145, 14_500, '2026-09-03T10:00:00.000Z'),
  offer(ID.offer130, ID.checkout130, 13_000, '2026-09-05T10:00:00.000Z'),
];

const allowedPurchase: PurchaseAttemptResponse = {
  executionId: ID.execution,
  decision: 'ALLOW',
  reasonCode: 'ALLOW_WITHIN_MANDATE',
  state: 'RESERVED',
  evidenceId: 'evidence-1',
};

class RecordingGateway implements PurchasingAgentGateway {
  readonly searches: SearchFlightsInput[] = [];
  readonly purchases: RequestPurchaseToolInput[] = [];

  constructor(
    private readonly result: FlightSearchResult = { offers },
    private readonly purchaseResult: PurchaseAttemptResponse = allowedPurchase,
  ) {}

  async searchFlights(input: SearchFlightsInput): Promise<FlightSearchResult> {
    this.searches.push(structuredClone(input));
    return structuredClone(this.result);
  }

  async requestPurchase(input: RequestPurchaseToolInput): Promise<PurchaseAttemptResponse> {
    this.purchases.push(structuredClone(input));
    return structuredClone(this.purchaseResult);
  }
}

describe('scripted purchasing agent', () => {
  it('deterministically requests the cheapest authoritative offer within the human limit', async () => {
    const gateway = new RecordingGateway();

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(gateway.searches).toEqual([searchInput]);
    expect(gateway.purchases).toEqual([
      { mandateId: ID.mandate, offerId: ID.offer130, checkoutId: ID.checkout130 },
    ]);
    expect(execution.result).toMatchObject({
      executedMode: 'scripted',
      outcome: 'PURCHASE_REQUESTED',
      selectedOfferId: ID.offer130,
      purchase: allowedPurchase,
    });
  });

  it('does not call the purchase gateway when no authoritative offer qualifies', async () => {
    const gateway = new RecordingGateway({ offers: [offers[0]!] });

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(execution.result.outcome).toBe('NO_MATCH');
    expect(gateway.purchases).toEqual([]);
  });

  it('rejects valid-shaped identifiers that were not returned by the authoritative search', async () => {
    const gateway = new RecordingGateway();
    const inventedOffer = '00000000-0000-4000-8000-000000000099';
    const inventedCheckout = '00000000-0000-4000-8000-000000000098';
    const model = new ScriptedModel([
      [functionCall('search_flights', searchInput, { callId: 'search-invented' })],
      [
        functionCall(
          'request_purchase',
          { mandateId: ID.mandate, offerId: inventedOffer, checkoutId: inventedCheckout },
          { callId: 'purchase-invented' },
        ),
      ],
    ]);

    const execution = await runOpenAiPurchasingAgent(task, gateway, {
      model: 'test-model',
      modelOverride: model,
      timeoutMs: 1_000,
    });

    expect(execution.result.outcome).toBe('NO_MATCH');
    expect(gateway.searches).toEqual([searchInput]);
    expect(gateway.purchases).toEqual([]);
  });
});

describe('OpenAI purchasing agent', () => {
  it('uses the same gateway contract and exactly the two strict tools', async () => {
    const gateway = new RecordingGateway();
    const model = new ScriptedModel([
      [functionCall('search_flights', searchInput, { callId: 'search-1' })],
      [
        functionCall(
          'request_purchase',
          { mandateId: ID.mandate, offerId: ID.offer130, checkoutId: ID.checkout130 },
          { callId: 'purchase-1' },
        ),
      ],
    ]);

    const execution = await runOpenAiPurchasingAgent(task, gateway, {
      model: 'test-model',
      modelOverride: model,
      timeoutMs: 1_000,
    });

    expect(gateway.searches).toEqual([searchInput]);
    expect(gateway.purchases).toEqual([
      { mandateId: ID.mandate, offerId: ID.offer130, checkoutId: ID.checkout130 },
    ]);
    expect(execution.result).toMatchObject({
      executedMode: 'openai',
      outcome: 'PURCHASE_REQUESTED',
      selectedOfferId: ID.offer130,
    });
    expect(model.calls).toHaveLength(2);
    model.assertComplete();
  });

  it('rejects model-injected price and payment data before it reaches the gateway', async () => {
    expect(
      RequestPurchaseToolInputSchema.safeParse({
        mandateId: ID.mandate,
        offerId: ID.offer130,
        checkoutId: ID.checkout130,
        priceMinor: 1,
        paymentToken: 'raw-card',
      }).success,
    ).toBe(false);

    const gateway = new RecordingGateway();
    const model = new ScriptedModel([
      [
        functionCall(
          'request_purchase',
          {
            mandateId: ID.mandate,
            offerId: ID.offer130,
            checkoutId: ID.checkout130,
            priceMinor: 1,
            paymentToken: 'raw-card',
          },
          { callId: 'hostile-purchase' },
        ),
      ],
    ]);

    const execution = await runOpenAiPurchasingAgent(task, gateway, {
      model: 'test-model',
      modelOverride: model,
      timeoutMs: 1_000,
    });

    expect(execution.result.outcome).toBe('NO_MATCH');
    expect(gateway.purchases).toEqual([]);
  });
});

describe('mode selection and offline fallback', () => {
  it('runs demo attempts through the same signed browse and payment API', async () => {
    const calls: Array<{ path: string; tag: string; body?: unknown }> = [];
    const demo = new SignedDemoAttemptService(
      {
        call: async (input) => {
          calls.push({
            path: input.path,
            tag: input.tag,
            ...(input.body === undefined ? {} : { body: input.body }),
          });
          if (input.path.startsWith('/api/flights?')) {
            return {
              status: 200,
              body: { ok: true, data: [flightOfferView(ID.offer130, 13_000)] },
            };
          }
          if (input.path === '/ucp/v1/checkout-sessions') {
            return {
              status: 201,
              body: { ok: true, data: checkoutSession(ID.offer130, ID.checkout130, 13_000) },
            };
          }
          return { status: 200, body: { ok: true, data: allowedPurchase } };
        },
      },
      { mode: 'scripted' },
      () => ID.execution,
    );

    await expect(demo.attempt(task)).resolves.toMatchObject({
      result: { outcome: 'PURCHASE_REQUESTED', executedMode: 'scripted' },
    });
    expect(calls.map(({ path, tag }) => ({ path: path.split('?')[0], tag }))).toEqual([
      { path: '/api/flights', tag: 'agentcerta:browse' },
      { path: '/ucp/v1/checkout-sessions', tag: 'agentcerta:browse' },
      { path: '/api/purchase-attempts', tag: 'agentcerta:payment' },
    ]);
    expect(calls[2]?.body).toEqual({
      executionId: ID.execution,
      mandateId: ID.mandate,
      offerId: ID.offer130,
      checkoutId: ID.checkout130,
    });
  });

  it('falls back to scripted mode when OpenAI fails before purchase', async () => {
    const gateway = new RecordingGateway();
    const service = new PurchasingAgentService(gateway, {
      mode: 'openai',
      apiKey: 'sk-test',
      model: 'test-model',
      openAiRun: async () => {
        throw new OpenAiPurchasingAgentError('offline', false);
      },
    });

    const execution = await service.run(task);

    expect(execution.result).toMatchObject({
      requestedMode: 'openai',
      executedMode: 'scripted',
      fallbackUsed: true,
      outcome: 'PURCHASE_REQUESTED',
    });
    expect(execution.trace.some((event) => event.event === 'OPENAI_FALLBACK')).toBe(true);
    expect(gateway.purchases).toHaveLength(1);
  });

  it('never falls back after a purchase tool may have reached the gateway', async () => {
    const gateway = new RecordingGateway();
    const service = new PurchasingAgentService(gateway, {
      mode: 'openai',
      apiKey: 'sk-test',
      model: 'test-model',
      openAiRun: async () => {
        throw new OpenAiPurchasingAgentError('unknown purchase result', true);
      },
    });

    await expect(service.run(task)).rejects.toMatchObject({ purchaseInvoked: true });
    expect(gateway.searches).toEqual([]);
    expect(gateway.purchases).toEqual([]);
  });
});

describe('signed gateway adapter and operational guardrails', () => {
  it('bridges query parameters and purpose tags to the RFC 9421 client', async () => {
    const calls: unknown[] = [];
    const transport = new AgentHttpClientTransport({
      call: async (input) => {
        calls.push(input);
        return { status: 200, body: { ok: true, data: [] } };
      },
    });

    await transport.request({
      method: 'GET',
      path: '/api/flights',
      tag: 'agentcerta:browse',
      query: { to: '2026-09-30', origin: 'CCS' },
    });

    expect(calls).toEqual([
      {
        method: 'GET',
        path: '/api/flights?origin=CCS&to=2026-09-30',
        tag: 'agentcerta:browse',
      },
    ]);
  });

  it('surfaces signed API failures without treating their bodies as success data', async () => {
    const transport = new AgentHttpClientTransport({
      call: async () => ({
        status: 403,
        body: { ok: false, error: { code: 'MANDATE_REVOKED' } },
      }),
    });

    await expect(
      transport.request({
        method: 'POST',
        path: '/api/purchase-attempts',
        tag: 'agentcerta:payment',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        status: 403,
        responseBody: { ok: false, error: { code: 'MANDATE_REVOKED' } },
      }),
    );
  });

  it('maps signed authoritative offers and prepared checkouts into agent candidates', async () => {
    const requests: SignedGatewayRequest[] = [];
    const transport: SignedGatewayTransport = {
      request: vi.fn(async (request: SignedGatewayRequest) => {
        requests.push(request);
        if (request.path === '/api/flights') {
          return { ok: true, data: [flightOfferView(ID.offer130, 13_000)] };
        }
        return { ok: true, data: checkoutSession(ID.offer130, ID.checkout130, 13_000) };
      }),
    };
    const gateway = new HttpPurchasingAgentGateway(transport, () => ID.execution);

    await expect(gateway.searchFlights(searchInput)).resolves.toEqual({
      offers: [offer(ID.offer130, ID.checkout130, 13_000, '2026-09-05T10:00:00.000Z')],
    });
    expect(requests).toEqual([
      {
        method: 'GET',
        path: '/api/flights',
        tag: 'agentcerta:browse',
        query: {
          origin: 'CCS',
          destination: 'COR',
          from: '2026-08-30',
          to: '2026-09-30',
        },
        signal: undefined,
      },
      {
        method: 'POST',
        path: '/ucp/v1/checkout-sessions',
        tag: 'agentcerta:browse',
        body: { offerId: ID.offer130 },
        signal: undefined,
      },
    ]);
  });

  it('fails closed when checkout preparation does not match its offer', async () => {
    const transport: SignedGatewayTransport = {
      request: vi.fn(async (request: SignedGatewayRequest) =>
        request.path === '/api/flights'
          ? { ok: true, data: [flightOfferView(ID.offer130, 13_000)] }
          : { ok: true, data: checkoutSession(ID.offer130, ID.checkout130, 1) },
      ),
    };

    await expect(
      new HttpPurchasingAgentGateway(transport).searchFlights(searchInput),
    ).rejects.toThrow('Prepared checkout does not match');
  });

  it('adds the execution ID locally and sends no price or payment data', async () => {
    const requests: SignedGatewayRequest[] = [];
    const transport: SignedGatewayTransport = {
      request: vi.fn(async (request: SignedGatewayRequest) => {
        requests.push(request);
        return { ok: true, data: allowedPurchase };
      }),
    };
    const gateway = new HttpPurchasingAgentGateway(transport, () => ID.execution);

    await gateway.requestPurchase({
      mandateId: ID.mandate,
      offerId: ID.offer130,
      checkoutId: ID.checkout130,
    });

    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/purchase-attempts',
        tag: 'agentcerta:payment',
        body: {
          executionId: ID.execution,
          mandateId: ID.mandate,
          offerId: ID.offer130,
          checkoutId: ID.checkout130,
        },
        signal: undefined,
      },
    ]);
  });

  it('redacts sensitive trace fields recursively', () => {
    expect(
      redactTraceData({
        offerId: ID.offer130,
        authorization: 'Bearer secret',
        nested: { paymentToken: 'tok_raw', decision: 'ALLOW' },
      }),
    ).toEqual({
      offerId: ID.offer130,
      authorization: '[REDACTED]',
      nested: { paymentToken: '[REDACTED]', decision: 'ALLOW' },
    });
  });

  it('returns valid bounded JSON for oversized tool results', () => {
    const result = boundedToolResult({ payload: 'x'.repeat(2_000) }, 256);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(256);
    expect(JSON.parse(result)).toMatchObject({ truncated: true });
  });
});

function offer(
  offerId: string,
  checkoutId: string,
  totalMinor: number,
  departureAt: string,
): AgentOffer {
  return {
    offerId,
    checkoutId,
    origin: 'CCS',
    destination: 'COR',
    departureAt,
    totalMinor,
    currency: 'USD',
    displaySummary: `VuelaYa ${totalMinor}`,
  };
}

function flightOfferView(offerId: string, totalMinor: number) {
  return {
    id: offerId,
    merchantId: '00000000-0000-4000-8000-000000000010',
    airline: 'VuelaYa',
    flightNumber: 'VY130',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-05T10:00:00.000Z',
    arrivalAt: '2026-09-05T15:00:00.000Z',
    passengerCount: 1,
    total: { minor: totalMinor, currency: 'USD' },
    status: 'AVAILABLE',
    expiresAt: '2026-09-04T10:00:00.000Z',
    source: 'demo',
    createdAt: '2026-08-29T10:00:00.000Z',
    summary: `VuelaYa ${totalMinor}`,
  };
}

function checkoutSession(offerId: string, checkoutId: string, totalMinor: number) {
  const offerView = flightOfferView(offerId, totalMinor);
  const total = { minor: totalMinor, currency: 'USD' };
  return {
    id: checkoutId,
    ucpVersion: '2026-04-08',
    merchantId: offerView.merchantId,
    offerId,
    status: 'OPEN',
    cart: {
      schema: 'agentcerta.cart.v1',
      merchantId: offerView.merchantId,
      offerId,
      lineItems: [{ offerId, description: offerView.summary, quantity: 1, unitPrice: total }],
      total,
    },
    cartHash: 'cart-hash',
    total,
    expiresAt: '2026-09-04T10:00:00.000Z',
    createdAt: '2026-08-29T10:00:00.000Z',
    updatedAt: '2026-08-29T10:00:00.000Z',
    offer: offerView,
  };
}
