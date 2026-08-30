import type { PurchaseReceipt } from '@authera/contracts';

/** Printable, dependency-free post-purchase documents. All provider data is HTML-escaped. */
export function paymentReceiptHtml(receipt: PurchaseReceipt): string {
  const { execution, offer, mandate, booking } = receipt;
  const payment = execution.payment;
  if (execution.state !== 'SUCCEEDED' || payment?.state !== 'SUCCEEDED') {
    throw new Error('completed payment required');
  }
  const rows: Array<[string, string]> = [
    ['Receipt number', `AUT-${execution.id.toUpperCase()}`],
    ['Purchased at', formatDate(execution.createdAt)],
    ['Merchant', offer?.merchantName ?? 'Unknown merchant'],
    ['Item', offer?.summary ?? 'Purchase'],
    ['Amount paid', formatMoney(payment.amount)],
    ['Payment method', mandate?.paymentMethodLabel ?? payment.provider],
    ['Payment provider', payment.provider.toUpperCase()],
    ['Payment reference', payment.providerPaymentId ?? 'Unavailable'],
    ['Booking reference', booking?.bookingReference ?? 'Not applicable'],
    ['Execution', execution.id],
    ['Evidence', execution.evidenceId],
  ];
  const checks = receipt.verification
    .map(
      (check) =>
        `<li><span class="check">${check.ok ? '✓' : '✕'}</span>${escapeHtml(check.label)}</li>`,
    )
    .join('');
  return documentShell(
    'Authera payment receipt',
    `<header><p class="eyebrow">Authera</p><h1>Payment receipt</h1><p class="muted">Purchase and authorization record</p></header>
     <section class="total"><span>Total paid</span><strong>${escapeHtml(formatMoney(payment.amount))}</strong></section>
     ${table(rows)}
     <section><h2>Verified at purchase</h2><ul class="checks">${checks}</ul></section>
     <footer>This is an Authera payment receipt, not a merchant tax invoice. Provider references and the evidence id let the merchant or auditor verify the transaction.</footer>`,
  );
}

export function bookingConfirmationHtml(receipt: PurchaseReceipt): string {
  const { execution, offer, booking } = receipt;
  if (execution.state !== 'SUCCEEDED' || offer?.kind !== 'flight' || booking?.state !== 'BOOKED') {
    throw new Error('confirmed flight booking required');
  }
  const tickets = booking.documents
    .map(
      (document) =>
        `<li>${escapeHtml(documentLabel(document.type))}${document.uniqueIdentifier ? ` · ${escapeHtml(document.uniqueIdentifier)}` : ''}</li>`,
    )
    .join('');
  const rows: Array<[string, string]> = [
    ['Booking reference', booking.bookingReference ?? 'Unavailable'],
    ['Duffel order', booking.providerOrderId ?? 'Unavailable'],
    ['Route', `${offer.origin ?? '—'} → ${offer.destination ?? '—'}`],
    ['Airline', offer.airline ?? offer.merchantName],
    ['Flight', offer.flightNumber ?? 'See airline itinerary'],
    ['Departure', formatDate(offer.departureAt)],
    ['Arrival', formatDate(offer.arrivalAt)],
    ['Cabin', titleCase(offer.cabin ?? 'economy')],
    ['Passengers', String(offer.passengerCount ?? 1)],
    ['Amount', formatMoney(offer.total)],
    ['Environment', booking.liveMode ? 'Live' : 'Duffel test mode'],
  ];
  return documentShell(
    'Duffel booking confirmation',
    `<header><p class="eyebrow">Authera · Duffel</p><h1>Booking confirmation</h1><p class="reference">${escapeHtml(booking.bookingReference ?? booking.providerOrderId ?? 'Confirmed')}</p></header>
     <section class="route"><strong>${escapeHtml(offer.origin ?? '—')}</strong><span>→</span><strong>${escapeHtml(offer.destination ?? '—')}</strong></section>
     ${table(rows)}
     <section><h2>Booking documents</h2>${tickets ? `<ul>${tickets}</ul>` : '<p>No ticket identifiers were returned.</p>'}</section>
     <aside><strong>Not a boarding pass.</strong> This document confirms the booking${booking.liveMode ? '' : ' in Duffel test mode'}. The airline issues a boarding pass only after check-in.</aside>
     <footer>Execution ${escapeHtml(execution.id)} · Evidence ${escapeHtml(execution.evidenceId)}</footer>`,
  );
}

function documentShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0;padding:32px}.page{max-width:760px;margin:auto;background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:40px;box-shadow:0 12px 36px #17203312}header{border-bottom:2px solid #265cff;padding-bottom:22px;margin-bottom:26px}.eyebrow{color:#265cff;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{font-size:30px;margin:5px 0}.muted,footer{color:#657087}.total{display:flex;justify-content:space-between;align-items:end;background:#f0f4ff;border-radius:9px;padding:18px 20px;margin:22px 0}.total strong{font-size:25px}.reference{font-size:25px;font-weight:700;letter-spacing:.12em;margin:10px 0 0}.route{display:flex;justify-content:center;gap:26px;font-size:30px;padding:18px;margin-bottom:20px;background:#f0f4ff;border-radius:9px}table{width:100%;border-collapse:collapse;margin:18px 0 28px}th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #e7eaf0;font-size:13px}th{width:34%;color:#657087;font-weight:500}td{overflow-wrap:anywhere}h2{font-size:16px}.checks{list-style:none;padding:0;columns:2}.checks li{padding:5px 0;font-size:13px}.check{display:inline-block;width:22px;color:#087e5b;font-weight:700}aside{border-left:4px solid #d48b00;background:#fff7e5;padding:14px 16px;margin:26px 0;font-size:13px}footer{border-top:1px solid #e7eaf0;margin-top:28px;padding-top:18px;font-size:11px;overflow-wrap:anywhere}@media print{body{padding:0;background:#fff}.page{border:0;box-shadow:none;max-width:none}button{display:none}}@media(max-width:600px){body{padding:12px}.page{padding:22px}.checks{columns:1}}
</style></head><body><main class="page">${body}</main></body></html>`;
}

function table(rows: Array<[string, string]>): string {
  return `<table><tbody>${rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}</tbody></table>`;
}

function formatMoney(money: { currency: string; minor: number }): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: money.currency }).format(
    money.minor / 100,
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Unavailable'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function documentLabel(value: string): string {
  return titleCase(value);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
}
