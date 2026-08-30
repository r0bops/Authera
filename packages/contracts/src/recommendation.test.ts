import { describe, expect, it } from 'vitest';
import {
  priceOveragePercent,
  recommendationCeilingMinor,
  recommendationTolerancePercent,
} from './recommendation.js';

describe('adaptive price recommendation band', () => {
  it.each([
    { budget: 15_000, percent: 15, ceiling: 17_250 },
    { budget: 29_999, percent: 15, ceiling: 34_498 },
    { budget: 30_000, percent: 10, ceiling: 33_000 },
    { budget: 70_000, percent: 10, ceiling: 77_000 },
    { budget: 100_000, percent: 10, ceiling: 110_000 },
    { budget: 100_001, percent: 7.5, ceiling: 107_501 },
    { budget: 200_000, percent: 7.5, ceiling: 215_000 },
  ])('uses $percent% at a $budget minor-unit budget', ({ budget, percent, ceiling }) => {
    expect(recommendationTolerancePercent(budget)).toBe(percent);
    expect(recommendationCeilingMinor(budget)).toBe(ceiling);
  });

  it('reports the exact relative overage rounded to one decimal place', () => {
    expect(priceOveragePercent(16_000, 15_000)).toBe(6.7);
    expect(priceOveragePercent(75_000, 70_000)).toBe(7.1);
  });
});
