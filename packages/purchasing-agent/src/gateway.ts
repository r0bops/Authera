import {
  CheckoutSessionSchema,
  FlightOfferViewSchema,
  PurchaseAttemptResponseSchema,
  type FlightOfferView,
  type PurchaseAttemptResponse,
} from '@authera/contracts';
import { z } from 'zod';
import {
  FlightSearchResultSchema,
  type FlightSearchResult,
  type RequestPurchaseToolInput,
  type SearchFlightsInput,
} from './schemas.js';

export type GatewayCallOptions = { signal?: AbortSignal };

export interface PurchasingAgentGateway {
  searchFlights(
    input: SearchFlightsInput,
    options?: GatewayCallOptions,
  ): Promise<FlightSearchResult>;
  requestPurchase(
    input: RequestPurchaseToolInput,
    options?: GatewayCallOptions,
  ): Promise<PurchaseAttemptResponse>;
}

export type SignedGatewayRequest = Readonly<{
  method: 'GET' | 'POST';
  path: string;
  tag: 'authera:browse' | 'authera:payment';
  query?: Readonly<Record<string, string>>;
  body?: unknown;
  signal?: AbortSignal;
}>;

export interface SignedGatewayTransport {
  request(request: SignedGatewayRequest): Promise<unknown>;
}

export interface SignedAgentHttpClient {
  call(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    tag: string;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }>;
}

export class SignedGatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly responseBody: unknown,
  ) {
    super(`Signed gateway request failed with HTTP ${status}`);
    this.name = 'SignedGatewayHttpError';
  }
}

export class AgentHttpClientTransport implements SignedGatewayTransport {
  constructor(private readonly client: SignedAgentHttpClient) {}

  async request(request: SignedGatewayRequest): Promise<unknown> {
    const response = await this.client.call({
      method: request.method,
      path: appendQuery(request.path, request.query),
      tag: request.tag,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new SignedGatewayHttpError(response.status, response.body);
    }
    return response.body;
  }
}

export type ExecutionIdFactory = () => string;

export class HttpPurchasingAgentGateway implements PurchasingAgentGateway {
  constructor(
    private readonly transport: SignedGatewayTransport,
    private readonly executionId: ExecutionIdFactory = () => crypto.randomUUID(),
  ) {}

  async searchFlights(
    input: SearchFlightsInput,
    options: GatewayCallOptions = {},
  ): Promise<FlightSearchResult> {
    const response = await this.transport.request({
      method: 'GET',
      path: '/api/flights',
      tag: 'authera:browse',
      query: {
        origin: input.origin,
        destination: input.destination,
        from: input.departureDateFrom,
        to: input.departureDateTo,
      },
      signal: options.signal,
    });
    const offers = parseGatewayResponse(z.array(FlightOfferViewSchema).max(100), response);
    // A live offer can expire or re-price between search and checkout; that offer is dropped
    // (fail closed per offer) rather than aborting the whole search.
    const settled = await Promise.allSettled(
      offers.map((offer) => this.prepareCheckout(offer, options.signal)),
    );
    const prepared = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    return FlightSearchResultSchema.parse({ offers: prepared });
  }

  async requestPurchase(
    input: RequestPurchaseToolInput,
    options: GatewayCallOptions = {},
  ): Promise<PurchaseAttemptResponse> {
    const response = await this.transport.request({
      method: 'POST',
      path: '/api/purchase-attempts',
      tag: 'authera:payment',
      body: { executionId: this.executionId(), ...input },
      signal: options.signal,
    });
    return parseGatewayResponse(PurchaseAttemptResponseSchema, response);
  }

  private async prepareCheckout(
    offer: FlightOfferView,
    signal?: AbortSignal,
  ): Promise<FlightSearchResult['offers'][number]> {
    const response = await this.transport.request({
      method: 'POST',
      path: '/ucp/v1/checkout-sessions',
      tag: 'authera:browse',
      body: { offerId: offer.id },
      signal,
    });
    const checkout = parseGatewayResponse(CheckoutSessionSchema, response);
    if (
      checkout.offerId !== offer.id ||
      checkout.total.minor !== offer.total.minor ||
      checkout.total.currency !== offer.total.currency
    ) {
      throw new Error('Prepared checkout does not match the authoritative flight offer');
    }
    return {
      offerId: offer.id,
      checkoutId: checkout.id,
      merchantId: offer.merchantId,
      merchantName: offer.merchantName,
      market: offer.market,
      origin: offer.origin,
      destination: offer.destination,
      departureAt: offer.departureAt,
      totalMinor: offer.total.minor,
      currency: offer.total.currency,
      displaySummary: offer.summary,
    };
  }
}

function parseGatewayResponse<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  if (isSuccessEnvelope(value)) return schema.parse(value.data);
  return schema.parse(value);
}

function isSuccessEnvelope(value: unknown): value is { ok: true; data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === true &&
    'data' in value
  );
}

function appendQuery(path: string, query: SignedGatewayRequest['query']): string {
  if (!query || Object.keys(query).length === 0) return path;
  const search = new URLSearchParams(
    Object.entries(query).sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${path}?${search.toString()}`;
}
