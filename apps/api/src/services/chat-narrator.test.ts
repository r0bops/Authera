import type { Offer } from '@authera/contracts';
import { describe, expect, it } from 'vitest';
import { narration } from './chat-narrator.js';

const offer: Offer = {
  id: '00000000-0000-4000-8000-000000000010',
  kind: 'flight',
  merchantId: '00000000-0000-4000-8000-000000000004',
  merchantName: 'Duffel Marketplace',
  market: 'GB',
  airline: 'Iberia',
  flightNumber: 'IB3177',
  origin: 'CCS',
  destination: 'COR',
  cabin: 'economy',
  departureAt: '2026-09-15T09:00:00.000Z',
  passengerCount: 1,
  quantity: 1,
  total: { currency: 'USD' as const, minor: 13000 },
  status: 'AVAILABLE',
  expiresAt: '2026-09-16T09:00:00.000Z',
  source: 'demo',
  createdAt: '2026-08-30T10:00:00.000Z',
};
const purchase = (
  decision: 'ALLOW' | 'REQUIRE_HUMAN' | 'BLOCK',
  reasonCode: string,
  state: string,
) =>
  ({
    executionId: '00000000-0000-4000-8000-000000000020',
    decision,
    reasonCode,
    state,
    evidenceId: 'ev',
  }) as never;

describe('Aria narrates outcomes', () => {
  it('says what was bought, with the money attached', () => {
    const text = narration(
      {
        mandateId: 'm',
        trigger: 'watch',
        purchase: purchase('ALLOW', 'ALLOW_WITHIN_MANDATE', 'SUCCEEDED'),
      },
      offer,
    );
    expect(text).toBe(
      'Done — I bought Iberia IB3177 CCS→COR on 2026-09-15 at 09:00 for USD 130.00, inside your rules. The receipt and booking are in Orders.',
    );
  });
  it('explains a near miss with the overage and hands the decision to the human', () => {
    const near = { ...offer, total: { currency: 'USD' as const, minor: 15500 } };
    const text = narration(
      {
        mandateId: 'm',
        trigger: 'watch',
        limit: { minor: 15000, currency: 'USD' },
        purchase: purchase('REQUIRE_HUMAN', 'REQUIRE_HUMAN_AMOUNT', 'REQUIRES_HUMAN'),
      },
      near,
    );
    expect(text).toContain("that's USD 5.00 over your USD 150.00");
    expect(text).toContain('approve it on the card below');
  });
  it('explains a block in plain words and says nothing was charged', () => {
    const text = narration(
      {
        mandateId: 'm',
        trigger: 'demo',
        purchase: purchase('BLOCK', 'CHECKOUT_HASH_MISMATCH', 'BLOCKED'),
      },
      offer,
    );
    expect(text).toContain('the cart changed after you looked at it');
    expect(text).toContain('Nothing was charged');
  });
  it('only reports "still watching" for the watcher, never for a judge-triggered run', () => {
    expect(
      narration(
        { mandateId: 'm', trigger: 'watch', outcome: 'NO_MATCH', consideredCount: 12 },
        null,
      ),
    ).toContain('Checked 12 fares');
    expect(
      narration(
        { mandateId: 'm', trigger: 'demo', outcome: 'NO_MATCH', consideredCount: 12 },
        null,
      ),
    ).toBeNull();
  });
});
