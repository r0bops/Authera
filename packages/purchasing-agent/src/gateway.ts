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
  type SearchProductsInput,
} from './schemas.js';

export type GatewayCallOptions = { signal?: AbortSignal };

export interface PurchasingAgentGateway {
  searchFlights(
    input: SearchFlightsInput,
    options?: GatewayCallOptions,
  ): Promise<FlightSearchResult>;
  searchProducts(
    input: SearchProductsInput,
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

/** What the agent signs for one purchase: exactly the transaction, nothing the model can edit. */
export interface ClosedCheckoutBinding {
  executionId: string;
  mandateId: string;
  offerId: string;
  checkoutId: string;
  cartHash: string;
  total: { currency: string; minor: number };
}

export interface SignedGatewayTransport {
  request(request: SignedGatewayRequest): Promise<unknown>;
  /** Signs the closed Checkout Mandate with the agent key (the key never enters this package). */
  signClosedCheckout?(binding: ClosedCheckoutBinding): Promise<string>;
}

export interface SignedAgentHttpClient {
  call(input: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    tag: string;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }>;
  signClosedCheckout?(binding: ClosedCheckoutBinding): Promise<string>;
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
  /** Present only when the underlying client can sign with the agent key. */
  readonly signClosedCheckout: ((binding: ClosedCheckoutBinding) => Promise<string>) | undefined;

  constructor(private readonly client: SignedAgentHttpClient) {
    const sign = client.signClosedCheckout?.bind(client);
    this.signClosedCheckout = sign ? (binding) => sign(binding) : undefined;
  }

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
  /** Checkout facts captured from the authoritative session, keyed by checkout id. */
  private readonly bindings = new Map<
    string,
    { offerId: string; cartHash: string; total: { currency: string; minor: number } }
  >();

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
    return this.prepareAll(response, options.signal);
  }

  async searchProducts(
    input: SearchProductsInput,
    options: GatewayCallOptions = {},
  ): Promise<FlightSearchResult> {
    const response = await this.transport.request({
      method: 'GET',
      path: '/api/products',
      tag: 'authera:browse',
      query: { q: input.query },
      signal: options.signal,
    });
    return this.prepareAll(response, options.signal);
  }

  private async prepareAll(response: unknown, signal?: AbortSignal): Promise<FlightSearchResult> {
    const offers = parseGatewayResponse(z.array(FlightOfferViewSchema).max(100), response);
    // A live offer can expire or re-price between search and checkout; that offer is dropped
    // (fail closed per offer) rather than aborting the whole search. A few at a time, so a
    // provider is never hit with the whole catalog at once.
    const prepared: FlightSearchResult['offers'] = [];
    let index = 0;
    const worker = async () => {
      while (index < offers.length) {
        const offer = offers[index++]!;
        try {
          prepared.push(await this.prepareCheckout(offer, signal));
        } catch {
          // dropped: the gateway would reject it anyway
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, offers.length) }, worker));
    prepared.sort((a, b) => a.totalMinor - b.totalMinor || a.offerId.localeCompare(b.offerId));
    return FlightSearchResultSchema.parse({ offers: prepared });
  }

  async requestPurchase(
    input: RequestPurchaseToolInput,
    options: GatewayCallOptions = {},
  ): Promise<PurchaseAttemptResponse> {
    const executionId = this.executionId();
    const binding = this.bindings.get(input.checkoutId);
    // The closed mandate is signed from what the server told us at checkout time, never from
    // anything the model produced; a checkout this run did not prepare cannot be signed.
    const closedCheckoutJws =
      binding && binding.offerId === input.offerId && this.transport.signClosedCheckout
        ? await this.transport.signClosedCheckout({
            executionId,
            mandateId: input.mandateId,
            offerId: input.offerId,
            checkoutId: input.checkoutId,
            cartHash: binding.cartHash,
            total: binding.total,
          })
        : undefined;
    const response = await this.transport.request({
      method: 'POST',
      path: '/api/purchase-attempts',
      tag: 'authera:payment',
      body: {
        executionId,
        ...input,
        ...(closedCheckoutJws ? { closedCheckoutJws } : {}),
      },
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
    this.bindings.set(checkout.id, {
      offerId: offer.id,
      cartHash: checkout.cartHash,
      total: { currency: checkout.total.currency, minor: checkout.total.minor },
    });
    return {
      offerId: offer.id,
      checkoutId: checkout.id,
      kind: offer.kind,
      merchantId: offer.merchantId,
      merchantName: offer.merchantName,
      market: offer.market,
      ...(offer.origin !== undefined ? { origin: offer.origin } : {}),
      ...(offer.destination !== undefined ? { destination: offer.destination } : {}),
      ...(offer.departureAt !== undefined ? { departureAt: offer.departureAt } : {}),
      ...(offer.title !== undefined ? { title: offer.title } : {}),
      quantity: offer.quantity,
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
