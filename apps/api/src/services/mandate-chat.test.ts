import { describe, expect, it } from 'vitest';
import type { MandateChatDraft, MandateChatRequest } from '@authera/contracts';
import { scriptedMandateChat } from './mandate-chat.js';

const emptyDraft: MandateChatDraft = {
  category: null,
  origin: null,
  destination: null,
  departureDateFrom: null,
  departureDateTo: null,
  dateFlexibilityDays: null,
  passengerCount: null,
  maxPerPurchaseMinor: null,
  currency: null,
  maxFulfillments: null,
  validUntil: null,
  escalation: null,
};

function request(content: string, draft: MandateChatDraft | null = null): MandateChatRequest {
  return { messages: [{ role: 'user', content }], draft };
}

describe('scripted mandate chat fallback', () => {
  it('turns the challenge sentence into a complete, reviewable flight draft', () => {
    const result = scriptedMandateChat(
      request(
        'Buy me one flight from Caracas to Córdoba next month under $150, valid until the end of the month. Ask me outside the rules.',
      ),
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(result).toMatchObject({
      complete: true,
      interpreter: 'scripted',
      missingFields: [],
      draft: {
        category: 'flight',
        origin: 'CCS',
        destination: 'COR',
        departureDateFrom: '2026-09-01',
        departureDateTo: '2026-09-30',
        passengerCount: 1,
        maxPerPurchaseMinor: 15_000,
        maxFulfillments: 1,
        validUntil: '2026-08-31T23:59:59.000Z',
        escalation: 'require_human',
      },
    });
  });

  it('asks one specific question when authority is still incomplete', () => {
    const result = scriptedMandateChat(
      request('I need a flight from Caracas to Madrid.'),
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(result.complete).toBe(false);
    expect(result.missingFields[0]).toBe('departureDates');
    expect(result.reply).toContain('departure date');
  });

  it('preserves the current draft and applies an explicit follow-up change', () => {
    const result = scriptedMandateChat(
      request('Make the maximum $170.', {
        ...emptyDraft,
        category: 'flight',
        origin: 'CCS',
        destination: 'COR',
      }),
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(result.draft.origin).toBe('CCS');
    expect(result.draft.destination).toBe('COR');
    expect(result.draft.maxPerPurchaseMinor).toBe(17_000);
    expect(result.missingFields).toContain('validUntil');
  });

  it('replaces a completed draft maximum expressed with a trailing dollar sign', () => {
    const result = scriptedMandateChat(
      request('I actually have a maximum of 250$', {
        ...emptyDraft,
        category: 'flight',
        origin: 'BOG',
        destination: 'PMV',
        departureDateFrom: '2026-08-31',
        departureDateTo: '2026-09-06',
        dateFlexibilityDays: 0,
        passengerCount: 1,
        maxPerPurchaseMinor: 30_000,
        currency: 'USD',
        maxFulfillments: 1,
        validUntil: '2026-09-07T23:59:59.000Z',
        escalation: 'require_human',
      }),
      new Date('2026-08-30T12:00:00.000Z'),
    );

    expect(result.complete).toBe(true);
    expect(result.draft.maxPerPurchaseMinor).toBe(25_000);
    expect(result.reply).toContain('updated the all-in maximum to USD 250.00');
  });

  it('keeps non-flight requests outside the mandate draft', () => {
    const result = scriptedMandateChat(
      request('Buy me a pair of running shoes under $120.'),
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(result.complete).toBe(false);
    expect(result.draft.category).toBeNull();
    expect(result.reply).toContain('flights only');
  });

  it.each([
    ['Tomorrow', '2026-08-30T23:59:59.000Z'],
    ['The next day', '2026-08-30T23:59:59.000Z'],
    ['08/30/26', '2026-08-30T23:59:59.000Z'],
    ['From tomorrow', '2026-08-30T23:59:59.000Z'],
    ['Today', '2026-08-29T23:59:59.000Z'],
    ['In the next 3 days', '2026-09-01T23:59:59.000Z'],
  ])('accepts “%s” as a natural authorization expiry follow-up', (answer, expected) => {
    const result = scriptedMandateChat(
      request(answer, {
        ...emptyDraft,
        category: 'flight',
        origin: 'CCS',
        destination: 'COR',
        departureDateFrom: '2026-09-10',
        departureDateTo: '2026-09-12',
        dateFlexibilityDays: 0,
        passengerCount: 1,
        maxPerPurchaseMinor: 15_000,
        currency: 'USD',
        maxFulfillments: 1,
        escalation: 'require_human',
      }),
      new Date('2026-08-29T12:00:00.000Z'),
    );

    expect(result.draft.validUntil).toBe(expected);
    expect(result.draft.departureDateFrom).toBe('2026-09-10');
    expect(result.draft.departureDateTo).toBe('2026-09-12');
    expect(result.missingFields).not.toContain('validUntil');
  });
});
