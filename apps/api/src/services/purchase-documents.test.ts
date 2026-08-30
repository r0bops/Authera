import { describe, expect, it } from 'vitest';
import type { PurchaseReceipt } from '@authera/contracts';
import { bookingConfirmationHtml, escapeHtml, paymentReceiptHtml } from './purchase-documents.js';

function completedReceipt(): PurchaseReceipt {
  return {
    execution: {
      id: '62428edf-983a-42b2-a928-ca0419146aa2',
      state: 'SUCCEEDED',
      decision: 'ALLOW',
      reasonCode: 'ALLOW_WITHIN_MANDATE',
      explanation: 'Allowed',
      mandateId: '00000000-0000-4000-8000-000000000001',
      mandateVersion: 1,
      offerId: '00000000-0000-4000-8000-000000000002',
      checkoutId: '00000000-0000-4000-8000-000000000003',
      agentId: '00000000-0000-4000-8000-000000000004',
      amount: { currency: 'USD', minor: 18_854 },
      checklist: [],
      approvalRequestId: null,
      payment: {
        id: '00000000-0000-4000-8000-000000000005',
        provider: 'stripe',
        state: 'SUCCEEDED',
        providerPaymentId: 'pi_test',
        providerTransactionId: 'ch_test',
        failureReason: null,
        amount: { currency: 'USD', minor: 18_854 },
        updatedAt: '2026-08-30T00:54:41.000Z',
      },
      booking: {
        id: '00000000-0000-4000-8000-000000000006',
        provider: 'duffel',
        state: 'BOOKED',
        providerOrderId: 'ord_test',
        bookingReference: 'ABC123',
        liveMode: false,
        documents: [{ type: 'electronic_ticket', uniqueIdentifier: 'ET-1' }],
        failureReason: null,
        createdAt: '2026-08-30T00:54:40.000Z',
        updatedAt: '2026-08-30T00:54:40.000Z',
      },
      reservationState: 'CONSUMED',
      evidenceId: 'ev_test',
      createdAt: '2026-08-30T00:54:39.000Z',
      updatedAt: '2026-08-30T00:54:41.000Z',
      timeline: [],
    },
    offer: {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'flight',
      merchantId: '00000000-0000-4000-8000-000000000007',
      merchantName: 'Duffel <Marketplace>',
      market: 'GB',
      airline: 'Duffel Airways',
      flightNumber: 'ZZ3864',
      origin: 'CCS',
      destination: 'COR',
      cabin: 'economy',
      departureAt: '2026-09-08T05:25:00.000Z',
      arrivalAt: '2026-09-08T11:00:00.000Z',
      passengerCount: 1,
      quantity: 1,
      total: { currency: 'USD', minor: 18_854 },
      status: 'AVAILABLE',
      expiresAt: '2026-08-30T01:00:00.000Z',
      source: 'duffel',
      providerOfferId: 'off_test',
      createdAt: '2026-08-30T00:50:00.000Z',
      summary: 'Duffel <Marketplace> · CCS→COR',
    },
    mandate: {
      id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      status: 'ACTIVE',
      summary: 'One flight within USD 1,000.00',
      maxPerPurchase: { currency: 'USD', minor: 100_000 },
      validUntil: '2026-09-30T23:59:59.000Z',
      agentDisplayName: 'Aria',
      paymentMethodLabel: 'Visa •••• 4242',
    },
    verification: [{ label: 'Payment confirmed', ok: true, detail: 'pi_test' }],
    booking: {
      id: '00000000-0000-4000-8000-000000000006',
      provider: 'duffel',
      state: 'BOOKED',
      providerOrderId: 'ord_test',
      bookingReference: 'ABC123',
      liveMode: false,
      documents: [{ type: 'electronic_ticket', uniqueIdentifier: 'ET-1' }],
      failureReason: null,
      createdAt: '2026-08-30T00:54:40.000Z',
      updatedAt: '2026-08-30T00:54:40.000Z',
    },
  };
}

describe('purchase documents', () => {
  it('renders an escaped payment receipt with provider and evidence references', () => {
    const html = paymentReceiptHtml(completedReceipt());
    expect(html).toContain('Payment receipt');
    expect(html).toContain('$188.54');
    expect(html).toContain('pi_test');
    expect(html).toContain('ev_test');
    expect(html).toContain('Duffel &lt;Marketplace&gt;');
    expect(html).not.toContain('Duffel <Marketplace>');
    expect(html).toContain('not a merchant tax invoice');
  });

  it('renders a test-mode booking confirmation and never calls it a boarding pass', () => {
    const html = bookingConfirmationHtml(completedReceipt());
    expect(html).toContain('ABC123');
    expect(html).toContain('ord_test');
    expect(html).toContain('Electronic Ticket · ET-1');
    expect(html).toContain('Duffel test mode');
    expect(html).toContain('Not a boarding pass');
  });

  it('refuses documents before the corresponding terminal states', () => {
    const receipt = completedReceipt();
    receipt.execution.state = 'PAYMENT_PENDING';
    expect(() => paymentReceiptHtml(receipt)).toThrow('completed payment required');
    expect(() => bookingConfirmationHtml(receipt)).toThrow('confirmed flight booking required');
  });

  it('escapes every HTML-sensitive character', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Marta'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Marta&#39;&lt;/a&gt;',
    );
  });
});
