import { MoneySchema, type Currency, type Money } from '@agentcerta/contracts';

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Validate a money value: explicit currency, non-negative safe integer minor units. */
export function assertMoney(value: unknown): Money {
  const parsed = MoneySchema.safeParse(value);
  if (!parsed.success) {
    throw new MoneyError(
      `invalid money value: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return parsed.data;
}

export function money(currency: Currency, minor: number): Money {
  return assertMoney({ currency, minor });
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}

export function equalMoney(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.minor === b.minor;
}

/** a + b, rejecting currency mixing and unsafe integers. */
export function addMoney(a: Money, b: Money): Money {
  if (!sameCurrency(a, b)) throw new MoneyError(`cannot add ${a.currency} and ${b.currency}`);
  return money(a.currency, addMinor(a.minor, b.minor));
}

export function addMinor(a: number, b: number): number {
  assertMinor(a);
  assertMinor(b);
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) throw new MoneyError('minor unit overflow');
  return sum;
}

export function assertMinor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`minor units must be a non-negative safe integer, got ${String(value)}`);
  }
  return value;
}

/** "USD 150.00" — for templates and UI; never for arithmetic. */
export function formatMoney(value: Money): string {
  const major = Math.floor(value.minor / 100);
  const cents = value.minor % 100;
  return `${value.currency} ${major}.${cents.toString().padStart(2, '0')}`;
}
