import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Checkout, CheckoutCart, Offer, PurchaseAttemptResponse } from '@authera/contracts';
import { hashCanonical, loadKeyMaterial } from '@authera/domain';
import { FIXTURE_IDS, mandatePolicyFixture } from '@authera/test-support';
import { fixedClock } from '../clock.js';
import type { ApiProblem } from '../http/problem.js';
import { createLogger } from '../logger.js';
import { MemoryGatewayStore } from '../testing/memory-gateway-store.js';
import { MandateGateway, type AgentContext, type ReservedExecution } from './gateway.js';
import { MandateSigner } from './mandate-signer.js';

const keys = loadKeyMaterial({ demoSecret: 'gateway-test' });
const otherKeys = loadKeyMaterial({ demoSecret: 'gateway-other' });
const NOW = new Date('2026-08-30T12:00:00.000Z');
const logger = createLogger({ level: 'silent' });

const OFFER_130 = '55555555-5555-4555-8555-000000000130';
const OFFER_300 = '55555555-5555-4555-8555-000000000300';
const OFFER_BOG = '55555555-5555-4555-8555-000000000900';

function offer(id: string, minor: number, overrides: Partial<Offer> = {}): Offer {
  return {
    id,
    kind: 'flight',
    quantity: 1,
    merchantId: FIXTURE_IDS.merchantId,
    merchantName: 'Test Market',
    market: 'VE',
    airline: 'Test Air',
    flightNumber: 'VY201',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureAt: '2026-09-12T08:05:00.000Z',
    arrivalAt: '2026-09-12T13:40:00.000Z',
    passengerCount: 1,
    total: { currency: 'USD', minor },
    status: 'AVAILABLE',
    expiresAt: '2026-12-31T23:59:59.000Z',
    source: 'demo',
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function checkoutFor(o: Offer): Checkout {
  const cart: CheckoutCart = {
    schema: 'authera.cart.v1',
    merchantId: o.merchantId,
    offerId: o.id,
    lineItems: [
      {
        offerId: o.id,
        description: o.kind === 'goods' ? (o.title ?? 'Product') : (o.flightNumber ?? 'Flight'),
        quantity: 1,
        unitPrice: o.total,
      },
    ],
    total: o.total,
  };
  return {
    id: randomUUID(),
    offerId: o.id,
    merchantId: o.merchantId,
    cart,
    cartHash: hashCanonical(cart),
    total: o.total,
    status: 'OPEN',
    expiresAt: '2026-08-30T14:00:00.000Z',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function agentContext(thumbprint = keys.agent.thumbprint): AgentContext {
  return {
    agentId: FIXTURE_IDS.agentId,
    agentKeyId: 'key-1',
    keyThumbprint: thumbprint,
    profileUri: 'http://localhost:3000/agents/x/profile',
    nonce: randomUUID(),
    requestDigest: `sha-256=:${randomUUID()}:`,
  };
}

describe('MandateGateway', () => {
  let store: MemoryGatewayStore;
  let gateway: MandateGateway;
  let reservedCalls: ReservedExecution[];
  const clock = fixedClock(NOW);

  async function seedMandate(
    overrides: Parameters<typeof mandatePolicyFixture>[0] = {},
    signer = new MandateSigner(keys.trustedSurface),
  ) {
    const policy = mandatePolicyFixture({
      agentKeyThumbprint: keys.agent.thumbprint,
      ...overrides,
    });
    const signed = await signer.sign(policy, NOW);
    store.mandates.set(policy.mandateId, {
      policy,
      jws: signed.jws,
      policyHash: signed.policyHash,
      signingKid: signed.kid,
      status: 'ACTIVE',
      reservedMinor: 0,
      consumedMinor: 0,
      reservedCount: 0,
      consumedCount: 0,
    });
    return policy;
  }

  async function attempt(
    offerId: string,
    overrides: Partial<{
      checkout: Checkout;
      agent: AgentContext;
      mandateId: string;
      executionId: string;
    }> = {},
  ): Promise<PurchaseAttemptResponse> {
    const o = store.offers.get(offerId)!;
    const checkout = overrides.checkout ?? checkoutFor(o);
    store.checkouts.set(checkout.id, checkout);
    return gateway.attempt(overrides.agent ?? agentContext(), {
      executionId: overrides.executionId ?? randomUUID(),
      mandateId: overrides.mandateId ?? FIXTURE_IDS.mandateId,
      offerId,
      checkoutId: checkout.id,
    });
  }

  beforeEach(() => {
    store = new MemoryGatewayStore();
    reservedCalls = [];
    gateway = new MandateGateway({
      store,
      clock,
      logger,
      onReserved: async (reserved) => {
        reservedCalls.push(reserved);
        return {};
      },
    });
    store.signingKeys.set(keys.trustedSurface.kid, keys.trustedSurface.publicJwk);
    store.merchants.set(FIXTURE_IDS.merchantId, { id: FIXTURE_IDS.merchantId, status: 'ACTIVE' });
    store.agents.set(FIXTURE_IDS.agentId, { id: FIXTURE_IDS.agentId, status: 'ACTIVE' });
    store.offers.set(OFFER_130, offer(OFFER_130, 13_000));
    store.offers.set(OFFER_300, offer(OFFER_300, 30_000));
    store.offers.set(
      OFFER_BOG,
      offer(OFFER_BOG, 12_000, { destination: 'BOG', flightNumber: 'VY301' }),
    );
  });

  it('allows USD 130 under a USD 150 mandate, reserves once, and hands off to payment', async () => {
    await seedMandate();
    const response = await attempt(OFFER_130);
    expect(response).toMatchObject({
      decision: 'ALLOW',
      reasonCode: 'ALLOW_WITHIN_MANDATE',
      state: 'RESERVED',
    });
    expect(response.evidenceId).toBe(`ev_${response.executionId}`);
    expect(store.reservations.size).toBe(1);
    expect(reservedCalls).toHaveLength(1);
    expect(reservedCalls[0]).toMatchObject({
      amountMinor: 13_000,
      currency: 'USD',
      paymentMethodRef: 'pm_fixture_4242',
    });
    expect(store.mandates.get(FIXTURE_IDS.mandateId)).toMatchObject({
      reservedMinor: 13_000,
      reservedCount: 1,
    });
    expect(store.events.map((e) => e.eventType)).toEqual(['POLICY_EVALUATED', 'USAGE_RESERVED']);
  });

  it('blocks USD 300 without reserving or calling payment', async () => {
    await seedMandate();
    const response = await attempt(OFFER_300);
    expect(response).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'AMOUNT_EXCEEDED',
      state: 'BLOCKED',
    });
    expect(store.reservations.size).toBe(0);
    expect(reservedCalls).toHaveLength(0);
    const record = store.executions.get(response.executionId)!;
    expect(
      record.patches
        .flatMap((p) => p.checklist ?? [])
        .some((c) => c.code === 'AMOUNT_PER_PURCHASE' && !c.passed),
    ).toBe(true);
  });

  it('escalates USD 300 when the mandate requires a human, creating an approval request', async () => {
    await seedMandate({ escalation: 'require_human' });
    const response = await attempt(OFFER_300);
    expect(response).toMatchObject({
      decision: 'REQUIRE_HUMAN',
      reasonCode: 'REQUIRE_HUMAN_AMOUNT',
      state: 'REQUIRES_HUMAN',
    });
    expect(response.approvalRequestId).toBe('approval-1');
    expect(reservedCalls).toHaveLength(0);
    expect(store.reservations.size).toBe(0);
  });

  it('allows an approved exact checkout once and consumes the approval; a mutated cart is blocked', async () => {
    await seedMandate({ escalation: 'require_human' });
    const o = store.offers.get(OFFER_300)!;
    const checkout = checkoutFor(o);
    store.checkouts.set(checkout.id, checkout);
    const paused = await attempt(OFFER_300, { checkout });
    expect(paused.decision).toBe('REQUIRE_HUMAN');
    store.approvals.get(paused.approvalRequestId!)!.state = 'APPROVED';

    const allowed = await attempt(OFFER_300, { checkout });
    expect(allowed).toMatchObject({
      decision: 'ALLOW',
      reasonCode: 'ALLOW_CHECKOUT_APPROVAL',
      state: 'RESERVED',
    });
    expect(store.approvals.get(paused.approvalRequestId!)!.state).toBe('CONSUMED');

    // A second use of the consumed approval must not allow again.
    store.mandates.get(FIXTURE_IDS.mandateId)!.reservedCount = 0;
    store.mandates.get(FIXTURE_IDS.mandateId)!.reservedMinor = 0;
    const again = await attempt(OFFER_300, { checkout });
    expect(again.decision).not.toBe('ALLOW');

    // Mutated cart: stored hash no longer matches the canonical cart.
    const mutated: Checkout = {
      ...checkout,
      id: randomUUID(),
      cart: { ...checkout.cart, total: { currency: 'USD', minor: 30_001 } },
    };
    store.approvals.set('approval-x', {
      id: 'approval-x',
      checkoutHash: mutated.cartHash,
      expiresAt: new Date('2026-08-30T14:00:00.000Z'),
      state: 'APPROVED',
      mandateId: FIXTURE_IDS.mandateId,
      executionId: 'e',
    });
    const blocked = await attempt(OFFER_300, { checkout: mutated });
    expect(blocked).toMatchObject({ decision: 'BLOCK', reasonCode: 'CHECKOUT_HASH_MISMATCH' });
  });

  it('blocks the wrong route, an expired mandate, a revoked mandate, and a wrong agent key', async () => {
    await seedMandate();
    expect(await attempt(OFFER_BOG)).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'INTENT_MISMATCH',
    });

    store.mandates.get(FIXTURE_IDS.mandateId)!.status = 'REVOKED';
    expect(await attempt(OFFER_130)).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'MANDATE_REVOKED',
    });
    store.mandates.get(FIXTURE_IDS.mandateId)!.status = 'ACTIVE';

    expect(
      await attempt(OFFER_130, { agent: agentContext(otherKeys.agent.thumbprint) }),
    ).toMatchObject({ decision: 'BLOCK', reasonCode: 'AGENT_KEY_MISMATCH' });

    const expiredGateway = new MandateGateway({
      store,
      clock: fixedClock('2026-09-05T00:00:00.000Z'),
      logger,
    });
    const o = store.offers.get(OFFER_130)!;
    const checkout = checkoutFor(o);
    checkout.expiresAt = '2026-09-06T00:00:00.000Z';
    store.checkouts.set(checkout.id, checkout);
    const expired = await expiredGateway.attempt(agentContext(), {
      executionId: randomUUID(),
      mandateId: FIXTURE_IDS.mandateId,
      offerId: OFFER_130,
      checkoutId: checkout.id,
    });
    expect(expired).toMatchObject({ decision: 'BLOCK', reasonCode: 'MANDATE_EXPIRED' });
    expect(reservedCalls).toHaveLength(0);
  });

  it('blocks a mandate signed by another trusted surface or with no signing key', async () => {
    await seedMandate({}, new MandateSigner(otherKeys.trustedSurface));
    expect(await attempt(OFFER_130)).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'MANDATE_INVALID',
    });
    expect(
      await attempt(OFFER_130, { mandateId: '00000000-0000-4000-8000-000000000000' }),
    ).toMatchObject({ decision: 'BLOCK', reasonCode: 'MANDATE_INVALID' });
  });

  it('exhausts a one-use mandate: the second allow attempt is blocked and loses a race safely', async () => {
    await seedMandate();
    expect((await attempt(OFFER_130)).decision).toBe('ALLOW');
    expect(await attempt(OFFER_130)).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'USAGE_EXHAUSTED',
    });

    store.mandates.get(FIXTURE_IDS.mandateId)!.reservedCount = 0;
    store.mandates.get(FIXTURE_IDS.mandateId)!.reservedMinor = 0;
    store.forceReserveFailure = 'RESERVATION_CONFLICT';
    const raced = await attempt(OFFER_130);
    expect(raced).toMatchObject({
      decision: 'BLOCK',
      reasonCode: 'RESERVATION_CONFLICT',
      state: 'BLOCKED',
    });
    expect(reservedCalls).toHaveLength(1);
  });

  it('treats the execution id as an idempotency key and rejects reuse with a different request', async () => {
    await seedMandate();
    const executionId = randomUUID();
    const agent = agentContext();
    const first = await attempt(OFFER_130, { executionId, agent });
    const replay = await attempt(OFFER_130, { executionId, agent });
    expect(replay).toEqual(first);
    expect(store.reservations.size).toBe(1);
    await expect(attempt(OFFER_130, { executionId, agent: agentContext() })).rejects.toMatchObject({
      code: 'EXECUTION_ID_REUSED',
    } satisfies Partial<ApiProblem>);
  });

  it('rejects a request carrying anything but identifiers', async () => {
    await seedMandate();
    await expect(
      gateway.attempt(agentContext(), {
        executionId: randomUUID(),
        mandateId: FIXTURE_IDS.mandateId,
        offerId: OFFER_130,
        checkoutId: randomUUID(),
        price: 1,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(store.executions.size).toBe(0);
  });
});
