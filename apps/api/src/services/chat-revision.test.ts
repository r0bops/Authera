import type { MandateChatDraft, MandatePolicyV1 } from '@authera/contracts';
import { describe, expect, it } from 'vitest';
import {
  describeRevision,
  draftFromPolicy,
  pendingRevisionFor,
  pinSignedDraft,
} from './chat-revision.js';

const policy: MandatePolicyV1 = {
  schema: 'authera.mandate.v1',
  mandateId: '00000000-0000-4000-8000-000000000001',
  version: 1,
  humanId: '00000000-0000-4000-8000-000000000002',
  agentId: '00000000-0000-4000-8000-000000000003',
  agentKeyThumbprint: 'thumb',
  allowedMerchantIds: ['00000000-0000-4000-8000-000000000004'],
  paymentMethodRef: '00000000-0000-4000-8000-000000000005',
  intent: {
    type: 'flight',
    origin: 'CCS',
    destination: 'COR',
    cabin: 'economy',
    departureDateFrom: '2026-09-10',
    departureDateTo: '2026-09-20',
    dateFlexibilityDays: 0,
    passengerCount: 1,
  },
  limits: { currency: 'USD', maxPerPurchaseMinor: 30000, maxTotalMinor: 30000, maxFulfillments: 1 },
  validFrom: '2026-08-30T00:00:00.000Z',
  validUntil: '2026-09-30T23:59:59.000Z',
  escalation: 'block',
};

describe('chat revision of a signed plan', () => {
  it('mirrors the signed policy exactly, so an unchanged draft has nothing pending', () => {
    const draft = draftFromPolicy(policy);
    expect(draft).not.toBeNull();
    expect(pendingRevisionFor(draft, policy)).toBeNull();
  });

  it('turns "my maximum is 250" into a limits-only revise request the person must confirm', () => {
    const draft: MandateChatDraft = { ...draftFromPolicy(policy)!, maxPerPurchaseMinor: 25000 };
    const pending = pendingRevisionFor(draft, policy);
    expect(pending).toEqual({
      changes: [{ field: 'maximumPrice', from: 'USD 300.00', to: 'USD 250.00' }],
      request: {
        limits: {
          currency: 'USD',
          maxPerPurchaseMinor: 25000,
          maxTotalMinor: 25000,
          maxFulfillments: 1,
        },
      },
    });
    expect(describeRevision(pending!.changes)).toBe('maximum price USD 300.00 → USD 250.00');
  });

  it('carries dates and validity into the intent and validUntil fields, nothing else', () => {
    const draft: MandateChatDraft = {
      ...draftFromPolicy(policy)!,
      departureDateTo: '2026-09-25',
      validUntil: '2026-10-15T23:59:59.000Z',
      escalation: 'require_human',
    };
    const pending = pendingRevisionFor(draft, policy)!;
    expect(pending.changes.map((c) => c.field)).toEqual([
      'validUntil',
      'outsideRules',
      'departureDates',
    ]);
    expect(pending.request).toEqual({
      validUntil: '2026-10-15T23:59:59.000Z',
      escalation: 'require_human',
      intent: { ...policy.intent, departureDateTo: '2026-09-25' },
    });
    expect(pending.request.limits).toBeUndefined();
  });

  it('pins route, category and currency: a different trip is a new plan, not a revision', () => {
    const stored = draftFromPolicy(policy)!;
    const proposed: MandateChatDraft = {
      ...stored,
      origin: 'BOG',
      destination: 'MAD',
      currency: 'MXN',
      maxPerPurchaseMinor: null,
      validUntil: null,
    };
    const pinned = pinSignedDraft(stored, proposed);
    expect(pinned.origin).toBe('CCS');
    expect(pinned.destination).toBe('COR');
    expect(pinned.currency).toBe('USD');
    // unset fields fall back to the signed values instead of erasing them
    expect(pinned.maxPerPurchaseMinor).toBe(30000);
    expect(pinned.validUntil).toBe(policy.validUntil);
    expect(pendingRevisionFor(pinned, policy)).toBeNull();
  });

  it('is not chat-managed for goods plans', () => {
    const goods: MandatePolicyV1 = {
      ...policy,
      intent: { type: 'goods', query: 'wool runner', maxQuantity: 1 },
    };
    expect(draftFromPolicy(goods)).toBeNull();
    expect(pendingRevisionFor(draftFromPolicy(policy), goods)).toBeNull();
  });
});
