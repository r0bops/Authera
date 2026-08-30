import { describe, expect, it } from 'vitest';
import { regionCalibratedMinor, regionClassFor } from './price-model.js';

describe('region-calibrated sandbox prices', () => {
  it('classifies routes by the airports’ regions', () => {
    expect(regionClassFor('BOG', 'MDE')).toBe('domestic-short');
    expect(regionClassFor('EZE', 'COR')).toBe('domestic-medium');
    expect(regionClassFor('CCS', 'BOG')).toBe('regional');
    expect(regionClassFor('CCS', 'COR')).toBe('regional-long');
    expect(regionClassFor('BOG', 'MIA')).toBe('north-america');
    expect(regionClassFor('EZE', 'MAD')).toBe('transatlantic');
    expect(regionClassFor('EZE', 'NRT')).toBe('asia');
    expect(regionClassFor('XXX', 'COR')).toBe('regional');
  });

  it('is deterministic per offer and stays inside the class band', () => {
    const a = regionCalibratedMinor({
      providerOfferId: 'off_1',
      origin: 'CCS',
      destination: 'COR',
      stops: 1,
    });
    expect(
      regionCalibratedMinor({
        providerOfferId: 'off_1',
        origin: 'CCS',
        destination: 'COR',
        stops: 1,
      }),
    ).toBe(a);
    expect(a % 100).toBe(0);
    expect(a).toBeGreaterThanOrEqual(480 * 0.8 * 0.9 * 100 - 100);
    expect(a).toBeLessThanOrEqual(480 * 1.6 * 100 + 100);
    expect(
      regionCalibratedMinor({
        providerOfferId: 'off_2',
        origin: 'CCS',
        destination: 'COR',
        stops: 1,
      }),
    ).not.toBe(a);
  });
});
