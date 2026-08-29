import { describe, expect, it } from 'vitest';
import { AUDIT_EVENT_TYPES, REASON_CODES } from '@authera/contracts';
import { describeAuditEvent, describeReason } from './summaries.js';

describe('summaries', () => {
  it('has a plain-language template for every reason code', () => {
    for (const code of REASON_CODES) {
      const text = describeReason(code);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('[object');
    }
  });

  it('weaves money and limits into the sentence when provided', () => {
    const text = describeReason('AMOUNT_EXCEEDED', {
      amount: { currency: 'USD', minor: 30_000 },
      limit: { currency: 'USD', minor: 15_000 },
    });
    expect(text).toBe('Blocked: USD 300.00 exceeds the mandate limit of USD 150.00.');
    expect(describeReason('MANDATE_REVOKED', { revokedAt: '2026-08-30T12:00:00.000Z' })).toContain(
      '2026-08-30T12:00:00.000Z',
    );
  });

  it('describes every audit event type', () => {
    for (const type of AUDIT_EVENT_TYPES) {
      expect(describeAuditEvent(type).length).toBeGreaterThan(5);
    }
    expect(describeAuditEvent('PAYMENT_SUCCEEDED', 'USD 130.00')).toBe(
      'Payment succeeded: USD 130.00',
    );
  });
});
