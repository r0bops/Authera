import { z } from 'zod';

/** Integer minor units with an explicit ISO currency (CLAUDE_IMPLEMENTATION_SPEC.md §8). */
export const CurrencySchema = z.enum(['USD', 'MXN', 'COP', 'BRL', 'ARS']);
export type Currency = z.infer<typeof CurrencySchema>;

export const MinorUnitsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const MoneySchema = z.strictObject({
  currency: CurrencySchema,
  minor: MinorUnitsSchema,
});
export type Money = z.infer<typeof MoneySchema>;
