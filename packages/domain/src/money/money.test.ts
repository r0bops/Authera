import { describe, expect, it } from 'vitest';
import { addMinor, addMoney, assertMoney, formatMoney, money, MoneyError } from './index.js';

describe('money', () => {
  it('formats minor units as major.cents', () => {
    expect(formatMoney(money('USD', 15_000))).toBe('USD 150.00');
    expect(formatMoney(money('USD', 15_001))).toBe('USD 150.01');
    expect(formatMoney(money('USD', 5))).toBe('USD 0.05');
  });

  it('rejects negatives, floats, NaN, and unsafe integers', () => {
    expect(() => money('USD', -1)).toThrow(MoneyError);
    expect(() => money('USD', 1.5)).toThrow(MoneyError);
    expect(() => money('USD', Number.NaN)).toThrow(MoneyError);
    expect(() => money('USD', Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => assertMoney({ currency: 'EUR', minor: 1 })).toThrow(MoneyError);
    expect(() => assertMoney({ currency: 'USD', minor: 1, extra: true })).toThrow(MoneyError);
  });

  it('adds safely and refuses overflow or mixed currencies', () => {
    expect(addMoney(money('USD', 1), money('USD', 2))).toEqual({ currency: 'USD', minor: 3 });
    expect(() => addMinor(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
    expect(() => addMinor(-1, 1)).toThrow(MoneyError);
  });
});
