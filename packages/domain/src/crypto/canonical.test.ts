import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson, contentDigestHeader, hashCanonical, sha256Hex } from './canonical.js';

describe('canonical hashing', () => {
  it('is independent of key order and whitespace', () => {
    const a = { total: { minor: 13000, currency: 'USD' }, offerId: 'x', items: [{ b: 1, a: 2 }] };
    const b = { items: [{ a: 2, b: 1 }], offerId: 'x', total: { currency: 'USD', minor: 13000 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(hashCanonical(a)).toBe(hashCanonical(b));
    expect(hashCanonical(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when any hash-bound value changes', () => {
    const cart = { offerId: 'o1', total: { currency: 'USD', minor: 13000 } };
    expect(hashCanonical(cart)).not.toBe(
      hashCanonical({ ...cart, total: { currency: 'USD', minor: 13001 } }),
    );
    expect(hashCanonical(cart)).not.toBe(hashCanonical({ ...cart, offerId: 'o2' }));
  });

  it('rejects values that are not JSON-serializable', () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it('produces a known SHA-256 and Content-Digest', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(contentDigestHeader(new TextEncoder().encode('{"hello": "world"}'))).toBe(
      'sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:',
    );
  });

  it('property: reordering object keys never changes the hash', () => {
    const json = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 8 }),
      fc.oneof(fc.integer(), fc.string(), fc.boolean(), fc.constant(null)),
      { maxKeys: 8 },
    );
    fc.assert(
      fc.property(json, (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        return hashCanonical(obj) === hashCanonical(reversed);
      }),
    );
  });

  it('property: mutating a string value changes the hash', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        fc.pre(a !== b);
        return hashCanonical({ v: a }) !== hashCanonical({ v: b });
      }),
    );
  });
});
