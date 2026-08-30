import type { PurchaseReceipt } from '@authera/contracts';

/** Printable, dependency-free post-purchase documents. All provider data is HTML-escaped. */
export function paymentReceiptHtml(receipt: PurchaseReceipt): string {
  const { execution, offer, mandate, booking } = receipt;
  const payment = execution.payment;
  if (execution.state !== 'SUCCEEDED' || payment?.state !== 'SUCCEEDED') {
    throw new Error('completed payment required');
  }
  const transaction: Array<[string, string]> = [
    ['Receipt number', `AUT-${execution.id.toUpperCase()}`],
    ['Purchased at', formatDate(execution.createdAt)],
    ['Merchant', offer?.merchantName ?? 'Unknown merchant'],
    ['Item', offer?.summary ?? 'Purchase'],
    ['Amount paid', formatMoney(payment.amount)],
  ];
  const paymentRows: Array<[string, string]> = [
    ['Payment provider', payment.provider.toUpperCase()],
    ['Payment reference', payment.providerPaymentId ?? 'Unavailable'],
    ['Booking reference', booking?.bookingReference ?? 'Not applicable'],
  ];
  const methodLabel = mandate?.paymentMethodLabel ?? payment.provider;
  const methodRow = `<tr><th>Payment method</th><td><span class="method">${cardBrandMark(methodLabel)}${escapeHtml(methodLabel)}</span></td></tr>`;
  return documentShell(
    'Authera payment receipt',
    `<header class="brand">
       <p class="logo">${SHIELD_ICON}<span>Authera</span></p>
       <span class="pill">${CHECK_ICON}Purchase complete</span>
     </header>
     <h1>Payment receipt</h1>
     <p class="muted subtitle">Purchase and authorization record</p>
     <section class="total"><span>Total paid</span><strong>${escapeHtml(formatMoney(payment.amount))}</strong></section>
     <section class="card"><h2>${DOC_ICON}Transaction details</h2>${table(transaction)}</section>
     <section class="card"><h2>${CARD_ICON}Payment details</h2><table><tbody>${methodRow}${tableRows(paymentRows)}</tbody></table></section>
     <footer>This is an Authera payment receipt, not a merchant tax invoice. Evidence ${escapeHtml(execution.evidenceId)} lets the merchant or auditor verify this transaction.</footer>`,
  );
}

const SHIELD_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#265cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-5"/></svg>';
const CHECK_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="#16a34a" aria-hidden="true"><circle cx="12" cy="12" r="11"/><path d="M7 12.5l3 3 7-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const DOC_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#265cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>';
const CARD_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#265cff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></svg>';

/** Small brand mark ahead of the card label; only for brands we can render confidently. */
function cardBrandMark(label: string): string {
  const brand = label.trim().split(/\s+/)[0]?.toLowerCase();
  if (brand === 'visa') return '<span class="mark visa">VISA</span>';
  if (brand === 'mastercard') return '<span class="mark mc">MC</span>';
  if (brand === 'amex' || brand === 'american') return '<span class="mark amex">AMEX</span>';
  return '';
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
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f5f7fb}*{box-sizing:border-box}body{margin:0;padding:32px}.page{max-width:760px;margin:auto;background:#fff;border:1px solid #dfe4ec;border-radius:12px;padding:40px;box-shadow:0 12px 36px #17203312}header{border-bottom:2px solid #265cff;padding-bottom:22px;margin-bottom:26px}.eyebrow{color:#265cff;font-weight:700;text-transform:uppercase;letter-spacing:.12em;font-size:12px}h1{font-size:30px;margin:5px 0}.muted,footer{color:#657087}.total{display:flex;justify-content:space-between;align-items:end;background:#f0f4ff;border-radius:9px;padding:18px 20px;margin:22px 0}.total strong{font-size:25px}.reference{font-size:25px;font-weight:700;letter-spacing:.12em;margin:10px 0 0}.route{display:flex;justify-content:center;gap:26px;font-size:30px;padding:18px;margin-bottom:20px;background:#f0f4ff;border-radius:9px}table{width:100%;border-collapse:collapse;margin:18px 0 28px}th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid #e7eaf0;font-size:13px}th{width:34%;color:#657087;font-weight:500}td{overflow-wrap:anywhere}h2{font-size:16px}.checks{list-style:none;padding:0;columns:2}.checks li{padding:5px 0;font-size:13px}.check{display:inline-block;width:22px;color:#087e5b;font-weight:700}aside{border-left:4px solid #d48b00;background:#fff7e5;padding:14px 16px;margin:26px 0;font-size:13px}footer{border-top:1px solid #e7eaf0;margin-top:28px;padding-top:18px;font-size:11px;overflow-wrap:anywhere}.brand{display:flex;justify-content:space-between;align-items:center;border:0;padding:0;margin:0 0 30px}.logo{display:flex;align-items:center;gap:8px;margin:0;color:#265cff;font-weight:800;letter-spacing:.14em;text-transform:uppercase;font-size:17px}.pill{display:inline-flex;align-items:center;gap:8px;background:#effaf3;border:1px solid #bfe8cd;color:#15803d;font-weight:600;font-size:14px;padding:9px 16px;border-radius:9px}.subtitle{margin:0 0 22px;padding-bottom:22px;border-bottom:1px solid #e7eaf0;font-size:16px}h1{font-size:42px;letter-spacing:-.02em;margin:0 0 6px}.total{border-left:5px solid #265cff;align-items:center;padding:30px 30px;border-radius:12px;box-shadow:0 8px 24px #1720330d}.total span{font-weight:600;font-size:17px}.total strong{font-size:44px;color:#265cff;letter-spacing:-.02em}.card{border:1px solid #e7eaf0;border-radius:12px;padding:20px 26px 6px;margin:0 0 20px}.card h2{display:flex;align-items:center;gap:12px;margin:0 0 6px;font-size:17px}.card table{margin:0}.card tr:last-child th,.card tr:last-child td{border-bottom:0}.card th{color:#4a6fd6;font-weight:500;font-size:14px;padding:14px 0}.card td{font-size:14px;padding:14px 0}.method{display:inline-flex;align-items:center;gap:10px}.mark{display:inline-block;padding:4px 7px;border-radius:5px;font-size:11px;font-weight:800;letter-spacing:.04em;border:1px solid #dfe4ec;background:#f0f4ff}.mark.visa{color:#1a1f71}.mark.mc{color:#eb001b}.mark.amex{color:#006fcf}@media print{body{padding:0;background:#fff}.page{border:0;box-shadow:none;max-width:none}button{display:none}}@media(max-width:600px){body{padding:12px}.page{padding:22px}.checks{columns:1}}
</style></head><body><main class="page">${body}</main></body></html>`;
}

function table(rows: Array<[string, string]>): string {
  return `<table><tbody>${tableRows(rows)}</tbody></table>`;
}

function tableRows(rows: Array<[string, string]>): string {
  return rows
    .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
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
