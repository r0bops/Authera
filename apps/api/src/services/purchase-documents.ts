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

/**
 * The receipt a cardholder expects from a card payment, in the familiar processor layout: amount,
 * date, method, one summary line, the processor reference. In Stripe test mode the PaymentIntent
 * id is the real one; with the mock processor the document says so.
 */
export function stripeStyleReceiptHtml(
  receipt: PurchaseReceipt,
  payer: { name: string; email: string } = { name: 'Customer', email: '' },
): string {
  const { execution, offer, mandate } = receipt;
  const payment = execution.payment;
  if (execution.state !== 'SUCCEEDED' || payment?.state !== 'SUCCEEDED') {
    throw new Error('completed payment required');
  }
  const amount = formatMoney(payment.amount);
  const method = mandate?.paymentMethodLabel ?? 'Card';
  const isStripe = payment.provider === 'stripe';
  const reference = payment.providerPaymentId ?? 'Unavailable';
  const compact = execution.id.replace(/-/g, '').toUpperCase();
  const receiptNumber = `${compact.slice(0, 4)}-${compact.slice(4, 8)}`;
  const paidOn = formatDate(payment.updatedAt ?? execution.createdAt);
  const memo = mandate
    ? `Bought by ${mandate.agentDisplayName.split(' — ')[0]} under your mandate ${mandate.id.slice(0, 8)} v${mandate.version} (up to ${formatMoney(mandate.maxPerPurchase)} per purchase).`
    : 'Thanks for your business!';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt from Authera</title>
<style>
  :root{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#1a1f36;background:#f6f8fa}*{box-sizing:border-box}
  body{margin:0}.mail{max-width:640px;margin:0 auto;background:#fff}
  .pre{padding:26px 36px 18px}.pre h1{font-size:20px;margin:0 0 8px}.pre p{margin:0;color:#4f566b;font-size:15px}.pre b{color:#1a1f36}
  .band{background:#635bff;padding:44px 40px 48px}
  .brand{display:flex;align-items:center;gap:14px;color:#fff;font-size:20px;font-weight:600;margin-bottom:40px}
  .avatar{width:44px;height:44px;border-radius:50%;background:#fff;color:#635bff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:22px}
  .card{background:#fff;border-radius:14px;padding:32px 36px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
  .card + .card{margin-top:26px}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .lead{color:#4f566b;font-size:17px;margin:0 0 6px}.amount{font-size:44px;font-weight:600;margin:0 0 6px;letter-spacing:-.02em}.paid{color:#4f566b;font-size:16px;margin:0 0 22px}
  .doc{width:88px;height:96px;border:1px solid #e3e8ee;border-radius:8px;background:#fafbfc;box-shadow:0 2px 6px rgba(0,0,0,.05);position:relative;flex:none}
  .doc i{position:absolute;left:14px;height:6px;border-radius:3px;background:#dbe0e6}.doc i.a{top:18px;width:14px;height:14px;border-radius:50%}.doc i.b{top:22px;left:34px;width:28px}.doc i.c{top:44px;width:48px}.doc i.d{top:58px;width:56px}.doc i.e{top:72px;width:40px}
  .rule{border-top:1px solid #e3e8ee;margin:0 0 20px}
  .dl{display:inline-block;color:#4f566b;text-decoration:none;font-size:16px;margin-bottom:26px}.dl:before{content:"↓ ";color:#8792a2}
  dl{display:grid;grid-template-columns:96px 1fr;row-gap:12px;margin:0 0 28px;font-size:16px}dt{color:#4f566b}dd{margin:0}
  .cta{display:block;text-align:center;background:#0a2540;color:#fff;text-decoration:none;font-weight:600;font-size:17px;padding:16px;border-radius:6px}
  .num{color:#4f566b;font-size:16px;margin:0 0 22px}
  table{width:100%;border-collapse:collapse;font-size:17px}td{padding:14px 0;border-bottom:1px solid #e3e8ee;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.qty{display:block;color:#8792a2;font-size:14px;margin-top:4px}
  tr.total td{border-bottom:1px solid #e3e8ee;font-weight:600}
  .foot{color:#8792a2;font-size:15px;line-height:1.6;margin:22px 0 0}.foot a{color:#635bff;text-decoration:none}
  .fine{padding:20px 36px 28px;color:#8792a2;font-size:12.5px;line-height:1.6}
  @media print{.band{background:#635bff!important;-webkit-print-color-adjust:exact}.cta{display:none}}
</style></head><body><div class="mail">
  <div class="pre"><h1>Your receipt from Authera</h1><p><b>to:</b> ${escapeHtml(payer.email || payer.name)}</p></div>
  <div class="band">
    <div class="brand"><span class="avatar">A</span>Authera</div>
    <div class="card">
      <div class="head"><div><p class="lead">Receipt from Authera</p><p class="amount">${escapeHtml(amount)}</p><p class="paid">Paid ${escapeHtml(paidOn)}</p></div><div class="doc" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i><i class="e"></i></div></div>
      <div class="rule"></div>
      <a class="dl" href="javascript:window.print()">Download receipt</a>
      <dl><dt>To</dt><dd>${escapeHtml(payer.name)}</dd><dt>From</dt><dd>Authera${offer ? ` · ${escapeHtml(offer.merchantName)}` : ''}</dd><dt>Memo</dt><dd>${escapeHtml(memo)}</dd></dl>
      <a class="cta" href="${escapeHtml(`/purchases/${execution.id}`)}">View this purchase in Authera</a>
    </div>
    <div class="card">
      <p class="num">Receipt #${escapeHtml(receiptNumber)}</p>
      <table><tbody>
        <tr><td>${escapeHtml(offer?.summary ?? 'Purchase')}<span class="qty">Qty ${escapeHtml(String(offer?.quantity ?? 1))}</span></td><td>${escapeHtml(amount)}</td></tr>
        <tr class="total"><td>Amount paid</td><td>${escapeHtml(amount)}</td></tr>
        <tr><td>Payment method<span class="qty">${escapeHtml(method)} · ${isStripe ? 'Stripe (test mode)' : escapeHtml(payment.provider)} · ${escapeHtml(reference)}</span></td><td></td></tr>
      </tbody></table>
      <p class="foot">Questions? Open <a href="${escapeHtml(`/purchases/${execution.id}`)}">this purchase</a> in Authera to see the mandate, the agent's signed request and the gateway decision, or report a problem from there.</p>
    </div>
  </div>
  <div class="fine">Rendered by Authera from the processor record (evidence ${escapeHtml(execution.evidenceId)}). Not a tax invoice.</div>
</div></body></html>`;
}

export function bookingConfirmationHtml(receipt: PurchaseReceipt): string {
  const { execution, offer, booking } = receipt;
  if (execution.state !== 'SUCCEEDED' || offer?.kind !== 'flight' || booking?.state !== 'BOOKED') {
    throw new Error('confirmed flight booking required');
  }
  const airline = offer.airline ?? offer.merchantName;
  const flight = offer.flightNumber ?? '—';
  const pnr = booking.bookingReference ?? '—';
  const tickets = booking.documents
    .map(
      (document) =>
        `<li>${escapeHtml(documentLabel(document.type))}${document.uniqueIdentifier ? ` · ${escapeHtml(document.uniqueIdentifier)}` : ''}</li>`,
    )
    .join('');
  const dep = splitDateTime(offer.departureAt);
  const arr = splitDateTime(offer.arrivalAt);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(airline)} · itinerary receipt</title>
<style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f3f5f9}*{box-sizing:border-box}body{margin:0;padding:32px 16px}
  .page{max-width:720px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 14px rgba(23,32,51,.08)}
  .head{background:#0b1f4d;color:#fff;padding:26px 32px;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .head .airline{font-size:24px;font-weight:700;letter-spacing:-.01em}.head .sub{opacity:.8;font-size:13px;margin-top:4px}
  .head .pnr{text-align:right}.head .pnr span{display:block;font-size:11px;opacity:.75;text-transform:uppercase;letter-spacing:.08em}.head .pnr strong{font-size:22px;font-family:ui-monospace,monospace;letter-spacing:.06em}
  .badge{display:inline-block;font-size:11px;padding:3px 8px;border-radius:999px;background:rgba(255,255,255,.14);margin-top:8px}
  .body{padding:28px 32px}
  .leg{display:grid;grid-template-columns:1fr auto 1fr;gap:18px;align-items:center;padding:20px;border:1px solid #e3e8f0;border-radius:10px;margin-bottom:22px}
  .leg .code{font-size:34px;font-weight:700;line-height:1}.leg .time{font-size:16px;font-weight:600;margin-top:6px}.leg .date{font-size:12.5px;color:#5b6b85}
  .leg .mid{text-align:center;color:#5b6b85;font-size:12px}.leg .mid .fl{font-weight:700;color:#0b1f4d;font-size:14px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 20px;margin-bottom:22px}.grid div span{display:block;font-size:11px;color:#8090a8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}.grid div{font-size:14px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8090a8;margin:18px 0 8px}ul{margin:0;padding-left:18px;font-size:13.5px}code{font-family:ui-monospace,monospace}
  .fare{display:flex;justify-content:space-between;border-top:1px solid #e3e8f0;padding-top:14px;font-size:15px}.fare strong{font-size:18px}
  aside{margin-top:20px;background:#fff7e6;border:1px solid #f5d38a;border-radius:8px;padding:12px 14px;font-size:12.5px;color:#6b4d00}
  footer{margin-top:18px;font-size:11.5px;color:#8090a8}
  @media print{body{background:#fff;padding:0}.page{box-shadow:none}}
</style></head><body><main class="page">
  <header class="head">
    <div><div class="airline">${escapeHtml(airline)}</div><div class="sub">Itinerary receipt · booked through Authera</div><span class="badge">${booking.liveMode ? 'Live booking' : 'Duffel test mode'}</span></div>
    <div class="pnr"><span>Booking reference</span><strong>${escapeHtml(pnr)}</strong></div>
  </header>
  <section class="body">
    <div class="leg">
      <div><div class="code">${escapeHtml(offer.origin ?? '—')}</div><div class="time">${escapeHtml(dep.time)}</div><div class="date">${escapeHtml(dep.date)}</div></div>
      <div class="mid"><div class="fl">${escapeHtml(flight)}</div>${escapeHtml(titleCase(offer.cabin ?? 'economy'))}<br/>${escapeHtml(legSummary(offer.departureAt, offer.arrivalAt, offer.stops))}</div>
      <div style="text-align:right"><div class="code">${escapeHtml(offer.destination ?? '—')}</div><div class="time">${escapeHtml(arr.time)}</div><div class="date">${escapeHtml(arr.date)}</div></div>
    </div>
    <div class="grid">
      <div><span>Passengers</span>${escapeHtml(String(offer.passengerCount ?? 1))} adult${(offer.passengerCount ?? 1) === 1 ? '' : 's'}</div>
      <div><span>Operated by</span>${escapeHtml(airline)}</div>
      <div><span>Sold by</span>${escapeHtml(offer.merchantName)}</div>
      <div><span>Duffel order</span><code>${escapeHtml(booking.providerOrderId ?? '—')}</code></div>
      <div><span>Booked</span>${escapeHtml(formatDate(booking.updatedAt))}</div>
      <div><span>Authera execution</span><code>${escapeHtml(execution.id.slice(0, 8))}</code></div>
    </div>
    <h2>Ticket documents</h2>
    ${tickets ? `<ul>${tickets}</ul>` : '<p style="font-size:13.5px;margin:0">No ticket identifiers were returned by the airline yet.</p>'}
    <h2>Fare</h2>
    <div class="fare"><span>Total paid, all-in (taxes and fees included)</span><strong>${escapeHtml(formatMoney(offer.total))}</strong></div>
    <aside><strong>Not a boarding pass.</strong> This document confirms the booking${booking.liveMode ? '' : ' in Duffel test mode — no real seat was issued'}. The airline issues boarding passes at check-in against the booking reference above.</aside>
    <footer>Booking confirmation · Execution ${escapeHtml(execution.id)} · Evidence ${escapeHtml(execution.evidenceId)}</footer>
  </section>
</main></body></html>`;
}

function legSummary(dep?: string, arr?: string, stops?: number): string {
  const parts: string[] = [];
  if (dep && arr) {
    const minutes = Math.round((Date.parse(arr) - Date.parse(dep)) / 60_000);
    if (Number.isFinite(minutes) && minutes > 0)
      parts.push(`${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`);
  }
  if (stops !== undefined)
    parts.push(stops === 0 ? 'Direct' : `${stops} stop${stops === 1 ? '' : 's'}`);
  return parts.join(' · ') || '→';
}

function splitDateTime(value: string | null | undefined): { date: string; time: string } {
  if (!value) return { date: '—', time: '—' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
  return {
    date: d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    time: value.slice(11, 16),
  };
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
