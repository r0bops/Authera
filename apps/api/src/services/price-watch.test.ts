import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../logger.js';
import { PriceWatcher, type WatchedMandate } from './price-watch.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function mandate(overrides: Partial<WatchedMandate> = {}): WatchedMandate {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    status: 'ACTIVE',
    policy: {
      validUntil: '2099-01-01T00:00:00.000Z',
      intent: {
        type: 'flight',
        origin: 'CCS',
        destination: 'COR',
        cabin: 'economy',
        departureDateFrom: '2026-09-10',
        departureDateTo: '2026-09-20',
        passengerCount: 1,
      },
    },
    ...overrides,
  };
}

function watcher(mandates: WatchedMandate[], nowMs: { value: number }, refreshMs = 300_000) {
  const checkout = {
    searchFlights: vi.fn(async () => [{ id: 'a' }, { id: 'b' }]),
  };
  const w = new PriceWatcher({
    checkout: checkout as never,
    listMandates: async () => mandates,
    clock: { now: () => new Date(nowMs.value) } as never,
    logger,
    refreshMs,
  });
  return { w, checkout };
}

describe('PriceWatcher', () => {
  it('searches the market for each active mandate using its intent, never a purchase', async () => {
    const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
    const goods = mandate({
      id: '00000000-0000-4000-8000-000000000002',
      policy: {
        validUntil: '2099-01-01T00:00:00.000Z',
        intent: { type: 'goods', query: 'wool runner', maxQuantity: 1 },
      },
    });
    const { w, checkout } = watcher([mandate(), goods], now);

    // the goods plan has no live market: it is left alone, never searched
    await expect(w.tick()).resolves.toEqual({ searched: 1, skipped: 0, failed: 0 });
    expect(checkout.searchFlights).toHaveBeenCalledWith(
      {
        origin: 'CCS',
        destination: 'COR',
        from: '2026-09-10',
        to: '2026-09-20',
        passengers: 1,
      },
      { strict: true },
    );
  });

  it('skips mandates searched within the refresh window and re-searches after it', async () => {
    const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
    const { w, checkout } = watcher([mandate()], now, 300_000);
    await w.tick();
    now.value += 60_000;
    await expect(w.tick()).resolves.toEqual({ searched: 0, skipped: 1, failed: 0 });
    now.value += 300_000;
    await expect(w.tick()).resolves.toEqual({ searched: 1, skipped: 0, failed: 0 });
    expect(checkout.searchFlights).toHaveBeenCalledTimes(2);
  });

  it('ignores revoked and expired mandates', async () => {
    const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
    const revoked = mandate({ id: '00000000-0000-4000-8000-000000000003', status: 'REVOKED' });
    const expired = mandate({
      id: '00000000-0000-4000-8000-000000000004',
      policy: { ...mandate().policy, validUntil: '2026-08-01T00:00:00.000Z' },
    });
    const { w, checkout } = watcher([revoked, expired], now);
    await expect(w.tick()).resolves.toEqual({ searched: 0, skipped: 0, failed: 0 });
    expect(checkout.searchFlights).not.toHaveBeenCalled();
  });

  it('keeps going when one market search fails and retries it next tick', async () => {
    const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
    const other = mandate({
      id: '00000000-0000-4000-8000-000000000005',
      policy: {
        validUntil: '2099-01-01T00:00:00.000Z',
        intent: {
          type: 'flight',
          origin: 'CCS',
          destination: 'BOG',
          cabin: 'economy',
          departureDateFrom: '2026-09-10',
          departureDateTo: '2026-09-20',
          passengerCount: 1,
        },
      },
    });
    const { w, checkout } = watcher([mandate(), other], now);
    checkout.searchFlights.mockRejectedValueOnce(new Error('market down'));
    await expect(w.tick()).resolves.toEqual({ searched: 1, skipped: 0, failed: 1 });
    // the failed intent backs off instead of being retried on the very next tick
    await expect(w.tick()).resolves.toEqual({ searched: 0, skipped: 2, failed: 0 });
    now.value += 21_000;
    await expect(w.tick()).resolves.toEqual({ searched: 1, skipped: 1, failed: 0 });
  });

  it('nudge() searches right away instead of waiting for the next tick', async () => {
    vi.useFakeTimers();
    try {
      const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
      const { w, checkout } = watcher([mandate()], now);
      w.nudge();
      expect(checkout.searchFlights).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(600);
      expect(checkout.searchFlights).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs one market search for mandates that share an intent', async () => {
    const now = { value: Date.parse('2026-08-30T10:00:00.000Z') };
    const twin = mandate({ id: '00000000-0000-4000-8000-000000000006' });
    const { w, checkout } = watcher([mandate(), twin], now);
    await expect(w.tick()).resolves.toEqual({ searched: 1, skipped: 0, failed: 0 });
    expect(checkout.searchFlights).toHaveBeenCalledTimes(1);
    // both mandates count as refreshed, so neither is searched again until the refresh window passes
    await expect(w.tick()).resolves.toEqual({ searched: 0, skipped: 1, failed: 0 });
  });
});
