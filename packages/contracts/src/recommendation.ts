import { z } from 'zod';
import { CurrencySchema, MinorUnitsSchema } from './money.js';

/** Adaptive soft band for suggestions only. It never raises a mandate's purchase limit. */
export function recommendationToleranceBps(maxAmountMinor: number): number {
  if (maxAmountMinor < 30_000) return 1_500;
  if (maxAmountMinor <= 100_000) return 1_000;
  return 750;
}

export function recommendationTolerancePercent(maxAmountMinor: number): number {
  return recommendationToleranceBps(maxAmountMinor) / 100;
}

/** Highest price that should be proactively recommended for a given hard purchase limit. */
export function recommendationCeilingMinor(maxAmountMinor: number): number {
  const bps = recommendationToleranceBps(maxAmountMinor);
  return Math.floor((maxAmountMinor * (10_000 + bps)) / 10_000);
}

export function priceOveragePercent(totalMinor: number, maxAmountMinor: number): number {
  if (maxAmountMinor <= 0) return 0;
  return Math.round(((totalMinor - maxAmountMinor) / maxAmountMinor) * 1_000) / 10;
}

export const OverBudgetRecommendationSchema = z
  .strictObject({
    mandateId: z.uuid(),
    offerId: z.uuid(),
    merchantName: z.string().min(1),
    market: z.string().length(2),
    displaySummary: z.string().min(1).max(280),
    currency: CurrencySchema,
    totalMinor: MinorUnitsSchema,
    budgetMinor: MinorUnitsSchema.min(1),
    overageMinor: MinorUnitsSchema.min(1),
    overagePercent: z.number().positive(),
    tolerancePercent: z.union([z.literal(15), z.literal(10), z.literal(7.5)]),
  })
  .refine((value) => value.totalMinor - value.budgetMinor === value.overageMinor, {
    message: 'overageMinor must equal totalMinor minus budgetMinor',
    path: ['overageMinor'],
  })
  .refine(
    (value) =>
      value.overagePercent === priceOveragePercent(value.totalMinor, value.budgetMinor) &&
      value.tolerancePercent === recommendationTolerancePercent(value.budgetMinor) &&
      value.totalMinor <= recommendationCeilingMinor(value.budgetMinor),
    { message: 'recommendation must be within the adaptive soft band' },
  );
export type OverBudgetRecommendation = z.infer<typeof OverBudgetRecommendationSchema>;
