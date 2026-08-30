import type { PurchaseAttemptResponse } from '@authera/contracts';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
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
  type FlightPurchasingTask,
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

const task: FlightPurchasingTask = {
  kind: 'flight',
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
  readonly productSearches: string[] = [];
  readonly purchases: RequestPurchaseToolInput[] = [];

  constructor(
    private readonly result: FlightSearchResult = { offers },
    private readonly purchaseResult: PurchaseAttemptResponse = allowedPurchase,
  ) {}

  async searchFlights(input: SearchFlightsInput): Promise<FlightSearchResult> {
    this.searches.push(structuredClone(input));
    return structuredClone(this.result);
  }

  async searchProducts(input: { query: string }): Promise<FlightSearchResult> {
    this.productSearches.push(input.query);
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

  it('compares offers across markets and explains the pick in plain language', async () => {
    const crossMarket: AgentOffer[] = [
      {
        ...offer(ID.offer145, ID.checkout145, 14_500, '2026-09-03T10:00:00.000Z'),
        merchantId: '00000000-0000-4000-8000-000000000011',
        merchantName: 'Alpha Market',
        market: 'AR',
      },
      offer(ID.offer300, ID.checkout300, 30_000, '2026-09-04T10:00:00.000Z'),
      {
        ...offer(ID.offer130, ID.checkout130, 13_000, '2026-09-05T10:00:00.000Z'),
        merchantId: '00000000-0000-4000-8000-000000000012',
        merchantName: 'Beta Market',
        market: 'CO',
      },
    ];
    const gateway = new RecordingGateway({ offers: crossMarket });

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(execution.result).toMatchObject({
      outcome: 'PURCHASE_REQUESTED',
      selectedOfferId: ID.offer130,
      marketsSearched: ['CO', 'AR', 'VE'],
    });
    expect(execution.result.selectionReason).toContain('3 offers across 3 markets');
    expect(execution.result.selectionReason).toContain('Beta Market (CO) at USD 130.00');
    expect(execution.result.selectionReason).toContain('Alpha Market (AR)');
    expect(execution.trace.map((e) => e.event)).toContain('OFFER_SELECTED');
    // The justification never reaches the gateway: identifiers only.
    expect(gateway.purchases).toEqual([
      { mandateId: ID.mandate, offerId: ID.offer130, checkoutId: ID.checkout130 },
    ]);
  });

  it('explains why nothing qualified, naming the cheapest market it saw', async () => {
    const gateway = new RecordingGateway({ offers: [offers[0]!] });

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(execution.result.outcome).toBe('NO_MATCH');
    expect(execution.result.selectionReason).toContain('Test Market (VE) at USD 300.00');
    expect(execution.result.selectionReason).toContain('above the USD 150.00 limit');
  });

  it('does not call the purchase gateway when no authoritative offer qualifies', async () => {
    const gateway = new RecordingGateway({ offers: [offers[0]!] });

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(execution.result.outcome).toBe('NO_MATCH');
    expect(gateway.purchases).toEqual([]);
  });

  it('recommends the cheapest authoritative flight inside the adaptive soft band', async () => {
    const nearMiss = offer(ID.offer145, ID.checkout145, 16_000, '2026-09-03T10:00:00.000Z');
    const gateway = new RecordingGateway({ offers: [nearMiss, offers[0]!] });

    const execution = await runScriptedPurchasingAgent(task, gateway);

    expect(execution.result).toMatchObject({
      outcome: 'RECOMMENDATION',
      recommendation: {
        mandateId: ID.mandate,
        offerId: ID.offer145,
        totalMinor: 16_000,
        budgetMinor: 15_000,
        overageMinor: 1_000,
        overagePercent: 6.7,
        tolerancePercent: 15,
      },
    });
    expect(execution.result.selectionReason).toContain('No purchase was requested');
    expect(execution.trace.map((event) => event.event)).toContain('RECOMMENDATION_FOUND');
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
          {
            mandateId: ID.mandate,
            offerId: ID.offer130,
            checkoutId: ID.checkout130,
            reason: 'Test Market (VE) at USD 130.00 is the lowest total within the limit.',
          },
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
      marketsSearched: ['VE'],
      selectionReason: 'Test Market (VE) at USD 130.00 is the lowest total within the limit.',
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

  it('replaces model prose with a grounded recommendation from the returned offers', async () => {
    const nearMiss = offer(ID.offer145, ID.checkout145, 16_000, '2026-09-03T10:00:00.000Z');
    const gateway = new RecordingGateway({ offers: [nearMiss] });
    const model = new ScriptedModel([
      [functionCall('search_flights', searchInput, { callId: 'search-near-miss' })],
      [assistantMessage('I found a flight for USD 1.00.')],
    ]);

    const execution = await runOpenAiPurchasingAgent(task, gateway, {
      model: 'test-model',
      modelOverride: model,
      timeoutMs: 1_000,
    });

    expect(execution.result).toMatchObject({
      outcome: 'RECOMMENDATION',
      recommendation: { offerId: ID.offer145, totalMinor: 16_000, overagePercent: 6.7 },
    });
    expect(execution.result.selectionReason).toContain('USD 160.00');
    expect(execution.result.selectionReason).not.toContain('USD 1.00');
    expect(gateway.purchases).toEqual([]);
    model.assertComplete();
  });

  it('does not let the model send a recommended over-budget offer to the gateway', async () => {
    const nearMiss = offer(ID.offer145, ID.checkout145, 16_000, '2026-09-03T10:00:00.000Z');
    const gateway = new RecordingGateway({ offers: [nearMiss] });
    const model = new ScriptedModel([
      [functionCall('search_flights', searchInput, { callId: 'search-over-budget' })],
      [
        functionCall(
          'request_purchase',
          {
            mandateId: ID.mandate,
            offerId: ID.offer145,
            checkoutId: ID.checkout145,
            reason: 'Try the closest flight despite the hard limit.',
          },
          { callId: 'purchase-over-budget' },
        ),
      ],
    ]);

    const execution = await runOpenAiPurchasingAgent(task, gateway, {
      model: 'test-model',
      modelOverride: model,
      timeoutMs: 1_000,
    });

    expect(execution.result).toMatchObject({
      outcome: 'RECOMMENDATION',
      recommendation: { offerId: ID.offer145, totalMinor: 16_000 },
    });
    expect(gateway.purchases).toEqual([]);
    model.assertComplete();
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
      { path: '/api/flights', tag: 'authera:browse' },
      { path: '/ucp/v1/checkout-sessions', tag: 'authera:browse' },
      { path: '/api/purchase-attempts', tag: 'authera:payment' },
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
      tag: 'authera:browse',
      query: { to: '2026-09-30', origin: 'CCS' },
    });

    expect(calls).toEqual([
      {
        method: 'GET',
        path: '/api/flights?origin=CCS&to=2026-09-30',
        tag: 'authera:browse',
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
        tag: 'authera:payment',
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
        tag: 'authera:browse',
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
        tag: 'authera:browse',
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

    // The mismatching offer is dropped; the agent never sees an unverified candidate.
    await expect(
      new HttpPurchasingAgentGateway(transport).searchFlights(searchInput),
    ).resolves.toEqual({ offers: [] });
  });

  it('signs a closed checkout mandate from the prepared session, never from the model', async () => {
    const signed: unknown[] = [];
    const transport: SignedGatewayTransport = {
      request: vi.fn(async (request: SignedGatewayRequest) => {
        if (request.path === '/api/flights')
          return { ok: true, data: [flightOfferView(ID.offer130, 13_000)] };
        if (request.path === '/ucp/v1/checkout-sessions')
          return { ok: true, data: checkoutSession(ID.offer130, ID.checkout130, 13_000) };
        return { ok: true, data: allowedPurchase };
      }),
      signClosedCheckout: vi.fn(async (binding) => {
        signed.push(binding);
        return 'closed.jws.token';
      }),
    };
    const gateway = new HttpPurchasingAgentGateway(transport, () => ID.execution);
    await gateway.searchFlights(searchInput);

    await gateway.requestPurchase({
      mandateId: ID.mandate,
      offerId: ID.offer130,
      checkoutId: ID.checkout130,
    });

    expect(signed).toEqual([
      {
        executionId: ID.execution,
        mandateId: ID.mandate,
        offerId: ID.offer130,
        checkoutId: ID.checkout130,
        cartHash: checkoutSession(ID.offer130, ID.checkout130, 13_000).cartHash,
        total: { currency: 'USD', minor: 13_000 },
      },
    ]);
    const purchaseCall = (transport.request as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    )?.[0] as SignedGatewayRequest;
    expect(purchaseCall.body).toMatchObject({ closedCheckoutJws: 'closed.jws.token' });
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
        tag: 'authera:payment',
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
    kind: 'flight',
    merchantId: '00000000-0000-4000-8000-000000000010',
    merchantName: 'Test Market',
    market: 'VE',
    origin: 'CCS',
    destination: 'COR',
    departureAt,
    quantity: 1,
    totalMinor,
    currency: 'USD',
    displaySummary: `Test Market ${totalMinor}`,
  };
}

function flightOfferView(offerId: string, totalMinor: number) {
  return {
    id: offerId,
    kind: 'flight',
    merchantId: '00000000-0000-4000-8000-000000000010',
    merchantName: 'Test Market',
    market: 'VE',
    airline: 'Test Air',
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
    summary: `Test Market ${totalMinor}`,
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
      schema: 'authera.cart.v1',
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
