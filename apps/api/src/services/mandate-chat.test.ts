import { mandateChatSuggestions } from '@authera/contracts';
import { describe, expect, it } from 'vitest';
import type { MandateChatDraft, MandateChatRequest } from '@authera/contracts';
import {
  departureTimeWindow,
  explicitExpiryDate,
  scriptedMandateChat,
  travelConstraints,
} from './mandate-chat.js';

const emptyDraft: MandateChatDraft = {
  category: null,
  origin: null,
  destination: null,
  departureDateFrom: null,
  departureDateTo: null,
  dateFlexibilityDays: null,
  departureTimeFrom: null,
  departureTimeTo: null,
  maxDurationMinutes: null,
  maxStops: null,
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

describe('quick replies', () => {
  it('offers tap-to-answer suggestions for the next missing field only', () => {
    expect(mandateChatSuggestions(null)).toEqual([
      'A flight from Caracas',
      'A flight from Bogotá',
      'A flight from Buenos Aires',
    ]);
    const result = scriptedMandateChat(
      request('I need a flight from Caracas to Madrid.'),
      new Date('2026-08-29T12:00:00.000Z'),
    );
    expect(mandateChatSuggestions(result.draft)).toEqual([
      'Next month',
      'Next week',
      'Any date in the next 60 days',
    ]);
    expect(mandateChatSuggestions(result.draft, { signedPlan: true })).toHaveLength(3);
  });
});

describe('departure-time window grounding', () => {
  it('turns everyday phrases into an HH:mm window and ignores day-based phrases', () => {
    expect(departureTimeWindow('Only morning flights please')).toEqual({
      from: '05:00',
      to: '11:59',
    });
    expect(departureTimeWindow('after 6 pm works best')).toEqual({ from: '18:00', to: '23:59' });
    expect(departureTimeWindow('between 8 and 11 am')).toEqual({ from: '08:00', to: '11:00' });
    expect(departureTimeWindow('before 10:30')).toEqual({ from: '00:00', to: '10:30' });
    expect(departureTimeWindow('valid for the next 3 days')).toBeNull();
    expect(departureTimeWindow('tomorrow morning is fine for the answer')).toBeNull();
  });
});

describe('explicit expiry dates', () => {
  it('reads "valid until 30 September" and "hasta el 15 de octubre" as the end of that day', () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    expect(
      explicitExpiryDate('valid until 30 September, block anything above', now)?.toISOString(),
    ).toBe('2026-09-30T23:59:59.000Z');
    expect(explicitExpiryDate('vigente hasta el 15 de octubre', now)?.toISOString()).toBe(
      '2026-10-15T23:59:59.000Z',
    );
    expect(explicitExpiryDate('until Jan 5', now)?.toISOString()).toBe('2027-01-05T23:59:59.000Z');
    expect(explicitExpiryDate('valid for the next 3 days', now)).toBeNull();
  });
});

describe('stopover and duration grounding', () => {
  it('reads direct/nonstop, "one stop max" and "under N hours" in English and Spanish', () => {
    expect(travelConstraints('Direct flights only, under 8 hours please')).toEqual({
      maxStops: 0,
      maxDurationMinutes: 480,
    });
    expect(travelConstraints('one stop max is fine')).toEqual({ maxStops: 1 });
    expect(travelConstraints('sin escalas, máximo 6 horas')).toEqual({
      maxStops: 0,
      maxDurationMinutes: 360,
    });
    expect(travelConstraints('valid for 3 days')).toEqual({});
  });
});

describe('travel intent grounding', () => {
  it('treats "travel to" and a named place as a flight plan, and a country as no airport yet', () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const r1 = scriptedMandateChat(
      {
        messages: [
          {
            role: 'user',
            content: 'Hi I want to travel to Africa, which country do you recommend?',
          },
        ],
        draft: null,
      },
      now,
    );
    expect(r1.draft.category).toBe('flight');
    const r2 = scriptedMandateChat(
      { messages: [{ role: 'user', content: 'Yes, from Bogota to Morocco' }], draft: r1.draft },
      now,
    );
    expect(r2.draft.origin).toBe('BOG');
    expect(r2.draft.destination).toBeNull();
    const r3 = scriptedMandateChat(
      { messages: [{ role: 'user', content: 'Casablanca then' }], draft: r2.draft },
      now,
    );
    expect(r3.draft.destination).toBe('CMN');
  });
});

describe('scripted mandate chat fallback', () => {
  it('grounds accented city names (JS word boundaries are ASCII-only)', () => {
    const result = scriptedMandateChat(
      request(
        'Flight from Bogotá to Medellín next month, max $90, one purchase, valid until end of month, ask me first',
      ),
      new Date('2026-08-30T06:30:00.000Z'),
    );
    expect(result.draft.origin).toBe('BOG');
    expect(result.draft.destination).toBe('MDE');
    expect(result.complete).toBe(true);
    const mx = scriptedMandateChat(
      request('Un vuelo de Ciudad de México a Ciudad de Panamá'),
      new Date('2026-08-30T06:30:00.000Z'),
    );
    expect([mx.draft.origin, mx.draft.destination]).toEqual(['MEX', 'PTY']);
  });

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
        departureTimeFrom: null,
        departureTimeTo: null,
        maxDurationMinutes: null,
        maxStops: null,
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
        departureTimeFrom: null,
        departureTimeTo: null,
        maxDurationMinutes: null,
        maxStops: null,
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
