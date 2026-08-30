import { expect, type APIRequestContext, type Page } from '@playwright/test';

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  requestId: string;
}

const CSRF = { 'X-Requested-With': 'Authera' };

/** Same-origin mutation with the CSRF header and a fresh Idempotency-Key, like the console does. */
export async function post<T>(
  request: APIRequestContext,
  path: string,
  body: unknown = {},
): Promise<{ status: number; body: Envelope<T> }> {
  const response = await request.post(path, {
    data: body,
    headers: {
      ...CSRF,
      'Idempotency-Key': crypto.randomUUID(),
      'content-type': 'application/json',
    },
  });
  return { status: response.status(), body: (await response.json()) as Envelope<T> };
}

export async function get<T>(request: APIRequestContext, path: string): Promise<Envelope<T>> {
  const response = await request.get(path);
  return (await response.json()) as Envelope<T>;
}

/** Establish the demo session cookie on the request context (GET /api/me auto-issues it). */
export async function signIn(
  request: APIRequestContext,
): Promise<{ paymentMethodId: string; agentId: string }> {
  const me = await get<{
    paymentMethods: Array<{ id: string }>;
    agents: Array<{ id: string }>;
    demoMode: boolean;
  }>(request, '/api/me');
  expect(me.ok, 'demo session issued').toBe(true);
  expect(me.data?.demoMode, 'DEMO_MODE must be on for the trial-by-fire suite').toBe(true);
  return { paymentMethodId: me.data!.paymentMethods[0]!.id, agentId: me.data!.agents[0]!.id };
}

export async function resetDemo(request: APIRequestContext): Promise<void> {
  const result = await post(request, '/api/demo/reset');
  expect(result.status).toBe(200);
}

export interface MandateInput {
  paymentMethodId: string;
  maxPerPurchaseMinor?: number;
  maxFulfillments?: number;
  validUntil?: string;
  escalation?: 'block' | 'require_human';
}

const endOfMonth = () => {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59),
  ).toISOString();
};

function travelWindow(): { departureDateFrom: string; departureDateTo: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 3, 0));
  return {
    departureDateFrom: from.toISOString().slice(0, 10),
    departureDateTo: to.toISOString().slice(0, 10),
  };
}

export async function createMandate(
  request: APIRequestContext,
  input: MandateInput,
): Promise<{ id: string; status: string }> {
  const max = input.maxPerPurchaseMinor ?? 15_000;
  const uses = input.maxFulfillments ?? 1;
  const result = await post<{ id: string; status: string }>(request, '/api/mandates', {
    paymentMethodId: input.paymentMethodId,
    intent: {
      type: 'flight',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      ...travelWindow(),
      passengerCount: 1,
    },
    limits: {
      currency: 'USD',
      maxPerPurchaseMinor: max,
      maxTotalMinor: max * uses,
      maxFulfillments: uses,
    },
    validUntil: input.validUntil ?? endOfMonth(),
    escalation: input.escalation ?? 'block',
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.data!;
}

export async function injectOffer(
  request: APIRequestContext,
  amountMinor: number,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const departure = new Date();
  departure.setUTCDate(departure.getUTCDate() + 14);
  const result = await post<{ id: string }>(request, '/api/demo/offers', {
    amountMinor,
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    currency: 'USD',
    passengerCount: 1,
    airline: 'Injected Air',
    expiresInMinutes: 1440,
    departureAt: departure.toISOString(),
    ...overrides,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body.data!;
}

export interface DirectResult {
  status: number;
  response: Envelope<unknown>;
  purchase?: {
    executionId: string;
    decision: string;
    reasonCode: string;
    state: string;
    approvalRequestId?: string;
  };
  checkoutId?: string;
}

/** After an approval the agent retries by itself: wait for that execution to appear. */
export async function waitForExecution(
  request: APIRequestContext,
  mandateId: string,
  match: (e: {
    id: string;
    state: string;
    decision: string | null;
    reasonCode: string | null;
  }) => boolean,
  timeoutMs = 20_000,
): Promise<{ id: string; state: string; decision: string | null; reasonCode: string | null }> {
  const started = Date.now();
  for (;;) {
    const list = await get<
      Array<{ id: string; state: string; decision: string | null; reasonCode: string | null }>
    >(request, `/api/executions?mandateId=${mandateId}&limit=50`);
    const hit = (list.data ?? []).find(match);
    if (hit) return hit;
    if (Date.now() - started > timeoutMs) throw new Error('no matching execution appeared in time');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function directAttempt(
  request: APIRequestContext,
  input: { mandateId: string; offerId: string; checkoutId?: string; impersonate?: boolean },
): Promise<DirectResult> {
  const path = input.impersonate ? '/api/demo/attempts/impersonate' : '/api/demo/attempts/direct';
  const result = await post<DirectResult>(request, path, {
    mandateId: input.mandateId,
    offerId: input.offerId,
    ...(input.checkoutId ? { checkoutId: input.checkoutId } : {}),
    impersonate: Boolean(input.impersonate),
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data!;
}

export async function paymentCalls(request: APIRequestContext): Promise<number> {
  const state = await get<{ paymentCalls: number }>(request, '/api/demo/state');
  return state.data?.paymentCalls ?? -1;
}

/** Desktop layout guard: no horizontal page scroll at the current viewport. */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page must not scroll horizontally').toBeLessThanOrEqual(0);
}
