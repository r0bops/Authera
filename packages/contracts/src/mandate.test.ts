import { describe, expect, it } from 'vitest';
import { effectiveFlightDateWindow, FlightIntentSchema } from './mandate.js';

describe('effectiveFlightDateWindow', () => {
  it('expands both sides of the preferred window across month boundaries', () => {
    const intent = FlightIntentSchema.parse({
      type: 'flight',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      departureDateFrom: '2028-03-01',
      departureDateTo: '2028-03-10',
      dateFlexibilityDays: 2,
      passengerCount: 1,
    });

    expect(effectiveFlightDateWindow(intent)).toEqual({
      from: '2028-02-28',
      to: '2028-03-12',
    });
  });

  it('keeps older mandates without a tolerance on their exact dates', () => {
    const intent = FlightIntentSchema.parse({
      type: 'flight',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      departureDateFrom: '2026-09-01',
      departureDateTo: '2026-09-30',
      passengerCount: 1,
    });

    expect(effectiveFlightDateWindow(intent)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});
