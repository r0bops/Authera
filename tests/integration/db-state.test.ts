import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MandatePolicyV1 } from '@authera/contracts';
import {
  appendAuditEvent,
  beginIdempotent,
  completeIdempotent,
  createCheckout,
  createExecution,
  createMandate,
  getMandate,
  getMandateVersion,
  getReservationByExecution,
  insertNonce,
  listAuditEvents,
  recordWebhookEvent,
  reserveUsage,
  resetDemo,
  reviseMandate,
  revokeMandate,
  SEED_IDS,
  SEED_OFFERS,
  seedDemo,
  settleExecution,
  verifyAuditChain,
} from '@authera/db';
import { hashCanonical } from '@authera/domain';
import { mandatePolicyFixture } from '@authera/test-support';
import { startTestPostgres, type TestPostgres } from './helpers/postgres.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

describe('PostgreSQL state and concurrency', () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await startTestPostgres();
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function policy(overrides: Partial<MandatePolicyV1> = {}): MandatePolicyV1 {
    return mandatePolicyFixture({
      mandateId: randomUUID(),
      humanId: SEED_IDS.marta,
      agentId: SEED_IDS.agent,
      agentKeyThumbprint: pg.keys.agent.thumbprint,
      allowedMerchantIds: [SEED_IDS.vuelaya],
      paymentMethodRef: SEED_IDS.paymentMethod,
      ...overrides,
    });
  }

  async function activeMandate(overrides: Partial<MandatePolicyV1> = {}) {
    const p = policy(overrides);
    return createMandate(pg.db, {
      policy: p,
      policyHash: hashCanonical(p),
      jws: 'jws.fixture',
      signingKid: pg.keys.trustedSurface.kid,
      actorId: SEED_IDS.marta,
    });
  }

  async function execution(mandateId: string) {
    const { execution: row } = await createExecution(pg.db, {
      id: randomUUID(),
      evidenceId: `ev-${randomUUID()}`,
      mandateId,
      mandateVersion: 1,
    });
    return row;
  }

  it('migrates on a clean database and seeds idempotently', async () => {
    await seedDemo(pg.db, pg.seed);
    const offers = await pg.db.query.offers.findMany();
    expect(offers).toHaveLength(SEED_OFFERS.length);
    const users = await pg.db.query.users.findMany();
    expect(users.map((u) => u.id)).toEqual([SEED_IDS.marta]);
  });

  it('creates and activates a mandate atomically with audit events', async () => {
    const created = await activeMandate();
    expect(created.runtime.status).toBe('ACTIVE');
    const loaded = await getMandate(pg.db, created.policy.mandateId);
    expect(loaded?.runtime.maxPerPurchaseMinor).toBe(15_000);
    const events = await listAuditEvents(pg.db, { mandateId: created.policy.mandateId });
    expect(events.map((e) => e.eventType)).toEqual(['MANDATE_CREATED', 'MANDATE_ACTIVATED']);
  });

  it('two concurrent one-use attempts yield exactly one reservation', async () => {
    const { policy: p } = await activeMandate();
    const [e1, e2] = await Promise.all([execution(p.mandateId), execution(p.mandateId)]);
    const results = await Promise.all(
      [e1, e2].map((e) =>
        pg.db.transaction((tx) =>
          reserveUsage(tx, {
            executionId: e.id,
            mandateId: p.mandateId,
            version: 1,
            amountMinor: 13_000,
            now: NOW,
          }),
        ),
      ),
    );
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0] && !failed[0].ok ? failed[0].reasonCode : undefined).toBe('USAGE_EXHAUSTED');
    const runtime = (await getMandate(pg.db, p.mandateId))?.runtime;
    expect(runtime?.reservedCount).toBe(1);
    expect(runtime?.reservedMinor).toBe(13_000);
  });

  it('revocation after a committed reservation lets it finish; the next attempt is revoked', async () => {
    const { policy: p } = await activeMandate({
      limits: {
        currency: 'USD',
        maxPerPurchaseMinor: 15_000,
        maxTotalMinor: 30_000,
        maxFulfillments: 2,
      },
    });
    const first = await execution(p.mandateId);
    const reserved = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: first.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    expect(reserved.ok).toBe(true);

    const revoked = await revokeMandate(pg.db, {
      mandateId: p.mandateId,
      reason: 'test',
      actorId: SEED_IDS.marta,
    });
    expect(revoked).toMatchObject({ status: 'REVOKED', changed: true });
    expect(
      (await revokeMandate(pg.db, { mandateId: p.mandateId, actorId: SEED_IDS.marta })).changed,
    ).toBe(false);

    const settled = await settleExecution(pg.db, {
      executionId: first.id,
      outcome: 'succeeded',
      payment: { provider: 'mock', providerPaymentId: 'pay_1' },
    });
    expect(settled).toMatchObject({
      applied: true,
      reservationState: 'CONSUMED',
      executionState: 'SUCCEEDED',
      paymentState: 'SUCCEEDED',
    });

    const second = await execution(p.mandateId);
    const blocked = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: second.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    expect(blocked).toEqual({ ok: false, reasonCode: 'MANDATE_REVOKED' });
  });

  it('revocation before reservation makes the reservation predicate fail', async () => {
    const { policy: p } = await activeMandate();
    await revokeMandate(pg.db, { mandateId: p.mandateId, actorId: SEED_IDS.marta });
    const e = await execution(p.mandateId);
    const result = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    expect(result).toEqual({ ok: false, reasonCode: 'MANDATE_REVOKED' });
  });

  it('reservation predicate respects the supplied clock and total cap', async () => {
    const { policy: p } = await activeMandate();
    const e = await execution(p.mandateId);
    const expired = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );
    expect(expired).toEqual({ ok: false, reasonCode: 'MANDATE_EXPIRED' });
    const tooMuch = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 15_001,
        now: NOW,
      }),
    );
    expect(tooMuch).toEqual({ ok: false, reasonCode: 'AMOUNT_EXCEEDED' });
  });

  it('duplicate nonce accepts exactly one request', async () => {
    const nonce = randomUUID();
    const attempts = await Promise.all(
      [1, 2].map(() =>
        insertNonce(pg.db, {
          agentKeyId: SEED_IDS.agentKey,
          nonce,
          requestDigest: 'sha-256=:abc:',
          expiresAt: new Date(NOW.getTime() + 60_000),
        }),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it('duplicate idempotency key returns the first response and rejects a different payload', async () => {
    const key = randomUUID();
    const first = await beginIdempotent(pg.db, { scope: 'test', key, requestHash: 'h1' });
    expect(first.kind).toBe('new');
    if (first.kind !== 'new') return;
    const concurrent = await beginIdempotent(pg.db, { scope: 'test', key, requestHash: 'h1' });
    expect(concurrent.kind).toBe('in_progress');
    await completeIdempotent(pg.db, first.recordId, {
      status: 201,
      body: { ok: true, data: { n: 1 } },
    });
    const replay = await beginIdempotent(pg.db, { scope: 'test', key, requestHash: 'h1' });
    expect(replay).toEqual({ kind: 'replay', status: 201, body: { ok: true, data: { n: 1 } } });
    expect((await beginIdempotent(pg.db, { scope: 'test', key, requestHash: 'h2' })).kind).toBe(
      'mismatch',
    );
    expect((await beginIdempotent(pg.db, { scope: 'other', key, requestHash: 'h1' })).kind).toBe(
      'new',
    );
  });

  it('payment failure releases the reservation exactly once', async () => {
    const { policy: p } = await activeMandate();
    const e = await execution(p.mandateId);
    await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    const first = await settleExecution(pg.db, {
      executionId: e.id,
      outcome: 'failed',
      payment: { provider: 'mock', failureReason: 'card_declined' },
    });
    expect(first).toMatchObject({
      applied: true,
      reservationState: 'RELEASED',
      executionState: 'FAILED',
      paymentState: 'FAILED',
    });
    const again = await settleExecution(pg.db, {
      executionId: e.id,
      outcome: 'failed',
      payment: { provider: 'mock' },
    });
    expect(again.applied).toBe(false);
    const flipped = await settleExecution(pg.db, {
      executionId: e.id,
      outcome: 'succeeded',
      payment: { provider: 'mock' },
    });
    expect(flipped.applied).toBe(false);
    const runtime = (await getMandate(pg.db, p.mandateId))?.runtime;
    expect(runtime).toMatchObject({
      reservedMinor: 0,
      reservedCount: 0,
      consumedMinor: 0,
      consumedCount: 0,
    });
    expect((await getReservationByExecution(pg.db, e.id))?.state).toBe('RELEASED');
    const events = await listAuditEvents(pg.db, { executionId: e.id });
    expect(events.map((ev) => ev.eventType)).toEqual([
      'USAGE_RESERVED',
      'USAGE_RELEASED',
      'PAYMENT_FAILED',
    ]);
  });

  it('duplicate webhooks are detected and settle only once', async () => {
    const { policy: p } = await activeMandate();
    const e = await execution(p.mandateId);
    await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: p.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    const eventId = `evt_${randomUUID()}`;
    const first = await recordWebhookEvent(pg.db, {
      provider: 'mock',
      providerEventId: eventId,
      executionId: e.id,
      payload: { type: 'succeeded' },
    });
    const second = await recordWebhookEvent(pg.db, {
      provider: 'mock',
      providerEventId: eventId,
      executionId: e.id,
      payload: { type: 'succeeded' },
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    const s1 = await settleExecution(pg.db, {
      executionId: e.id,
      outcome: 'succeeded',
      payment: { provider: 'mock', lastEventId: eventId },
      actorType: 'PROVIDER',
    });
    const s2 = await settleExecution(pg.db, {
      executionId: e.id,
      outcome: 'succeeded',
      payment: { provider: 'mock', lastEventId: eventId },
      actorType: 'PROVIDER',
    });
    expect(s1.applied).toBe(true);
    expect(s2.applied).toBe(false);
    const runtime = (await getMandate(pg.db, p.mandateId))?.runtime;
    expect(runtime).toMatchObject({
      reservedMinor: 0,
      reservedCount: 0,
      consumedMinor: 13_000,
      consumedCount: 1,
    });
  });

  it('scopes webhook event identity to the provider', async () => {
    const providerEventId = `evt_${randomUUID()}`;
    const mock = await recordWebhookEvent(pg.db, {
      provider: 'mock',
      providerEventId,
      payload: { provider: 'mock' },
    });
    const yuno = await recordWebhookEvent(pg.db, {
      provider: 'yuno',
      providerEventId,
      payload: { provider: 'yuno' },
    });
    const duplicateMock = await recordWebhookEvent(pg.db, {
      provider: 'mock',
      providerEventId,
      payload: { provider: 'mock', duplicate: true },
    });

    expect(mock.duplicate).toBe(false);
    expect(yuno.duplicate).toBe(false);
    expect(duplicateMock).toMatchObject({ duplicate: true, event: { id: mock.event.id } });
  });

  it('revision supersedes the old version without changing its historical evidence', async () => {
    const created = await activeMandate();
    const v1 = await getMandateVersion(pg.db, created.policy.mandateId, 1);
    const next = {
      ...created.policy,
      version: 2,
      limits: { ...created.policy.limits, maxPerPurchaseMinor: 20_000, maxTotalMinor: 20_000 },
    };
    const revised = await reviseMandate(pg.db, {
      policy: next,
      policyHash: hashCanonical(next),
      jws: 'jws.v2',
      signingKid: pg.keys.trustedSurface.kid,
      actorId: SEED_IDS.marta,
    });
    expect(revised.runtime.status).toBe('ACTIVE');
    expect(revised.mandate.currentVersion).toBe(2);
    const v1After = await getMandateVersion(pg.db, created.policy.mandateId, 1);
    expect(v1After?.version).toEqual(v1?.version);
    expect(v1After?.runtime.status).toBe('SUPERSEDED');
    const e = await execution(created.policy.mandateId);
    const stale = await pg.db.transaction((tx) =>
      reserveUsage(tx, {
        executionId: e.id,
        mandateId: created.policy.mandateId,
        version: 1,
        amountMinor: 13_000,
        now: NOW,
      }),
    );
    expect(stale).toEqual({ ok: false, reasonCode: 'MANDATE_SUPERSEDED' });
  });

  it('audit sequence and hash chain stay valid under concurrent appends', async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        pg.db.transaction((tx) =>
          appendAuditEvent(tx, {
            eventType: 'POLICY_EVALUATED',
            actorType: 'SYSTEM',
            payload: { i },
          }),
        ),
      ),
    );
    const verification = await verifyAuditChain(pg.db);
    expect(verification.valid).toBe(true);
    const events = await listAuditEvents(pg.db, { limit: 10_000 });
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  });

  it('demo reset restores the deterministic seed and an empty ledger', async () => {
    await resetDemo(pg.db, pg.seed);
    expect(await pg.db.query.mandates.findMany()).toHaveLength(0);
    expect(await pg.db.query.auditEvents.findMany()).toHaveLength(0);
    expect(await pg.db.query.offers.findMany()).toHaveLength(SEED_OFFERS.length);
    const checkout = await createCheckout(pg.db, {
      id: randomUUID(),
      offerId: SEED_OFFERS[0]!.id,
      merchantId: SEED_IDS.vuelaya,
      cart: {
        schema: 'authera.cart.v1',
        merchantId: SEED_IDS.vuelaya,
        offerId: SEED_OFFERS[0]!.id,
        lineItems: [
          {
            offerId: SEED_OFFERS[0]!.id,
            description: 'VY201',
            quantity: 1,
            unitPrice: { currency: 'USD', minor: 18_400 },
          },
        ],
        total: { currency: 'USD', minor: 18_400 },
      },
      cartHash: 'sha256:x',
      amountMinor: 18_400,
      currency: 'USD',
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(checkout.status).toBe('OPEN');
  });
});
