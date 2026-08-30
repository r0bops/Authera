#!/usr/bin/env node
/* global fetch, URLSearchParams, crypto */
/**
 * Populate the flight market with realistic, labelled fares — for demos and rehearsals.
 *
 * Every fare is injected through the demo API exactly like a judge injection (source "demo"),
 * so the gateway, the watcher and the agent treat it like any other offer. Prices are ESTIMATES
 * by region class (documented below), not quotes; where TRAVELPAYOUTS_TOKEN is set and the
 * cached market has data for a route, real cached fares replace the estimate.
 *
 *   API_BASE=https://authera-production.up.railway.app node scripts/populate-flights.mjs
 *   node scripts/populate-flights.mjs --only CCS-COR,BOG-MDE --per-route 8 --dry-run
 *   SEED=7 node scripts/populate-flights.mjs            # same fares every run with the same seed
 *   DEAL=CCS-COR:130 node scripts/populate-flights.mjs  # also drop one "deal" fare on a route
 *
 * Note: if a live plan exists on a route, the watcher will act on any fare inside its rules —
 * that is the product working, not a side effect of this script.
 */

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const DRY_RUN = args.includes('--dry-run');
const PER_ROUTE = Number(flag('--per-route', process.env.PER_ROUTE ?? 6));
const ONLY = (flag('--only', process.env.ONLY ?? '') || '').split(',').filter(Boolean);
const SEED = Number(process.env.SEED ?? Date.now() % 100000);
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD ?? 45);
const DEALS = Object.fromEntries(
  (process.env.DEAL ?? '')
    .split(',')
    .filter(Boolean)
    .map((d) => d.split(':'))
    .map(([route, usd]) => [route, Number(usd)]),
);

// ---------- fare model by region class (one-way, economy, USD, all-in) ----------
// base: typical low season; spread: multiplier range across days/airlines; duration in minutes.
const CLASSES = {
  'domestic-short': { base: 45, spread: [0.7, 1.9], duration: [55, 95], stops: [0, 0, 0, 0, 1] },
  'domestic-medium': { base: 95, spread: [0.7, 1.8], duration: [90, 160], stops: [0, 0, 0, 1] },
  regional: { base: 190, spread: [0.75, 1.7], duration: [110, 260], stops: [0, 0, 1] },
  'regional-long': { base: 480, spread: [0.8, 1.6], duration: [420, 900], stops: [1, 1, 2] },
  'north-america': { base: 330, spread: [0.75, 1.7], duration: [210, 420], stops: [0, 1] },
  transatlantic: { base: 720, spread: [0.8, 1.5], duration: [600, 780], stops: [0, 1] },
  asia: { base: 1250, spread: [0.85, 1.4], duration: [1500, 2400], stops: [1, 2, 3] },
};

// carriers that actually fly each class in LatAm; names are the ones travellers see
const CARRIERS = {
  'domestic-short': [
    ['JetSMART', 'JA'],
    ['Avianca', 'AV'],
    ['LATAM', 'LA'],
    ['Wingo', 'P5'],
  ],
  'domestic-medium': [
    ['Aerolíneas Argentinas', 'AR'],
    ['LATAM', 'LA'],
    ['Flybondi', 'FO'],
    ['Avianca', 'AV'],
  ],
  regional: [
    ['Copa Airlines', 'CM'],
    ['Avianca', 'AV'],
    ['LATAM', 'LA'],
    ['Wingo', 'P5'],
    ['Conviasa', 'V0'],
  ],
  'regional-long': [
    ['Copa Airlines', 'CM'],
    ['Avianca', 'AV'],
    ['LATAM', 'LA'],
    ['Aerolíneas Argentinas', 'AR'],
  ],
  'north-america': [
    ['American Airlines', 'AA'],
    ['Avianca', 'AV'],
    ['Copa Airlines', 'CM'],
    ['Volaris', 'Y4'],
  ],
  transatlantic: [
    ['Iberia', 'IB'],
    ['Air Europa', 'UX'],
    ['LATAM', 'LA'],
    ['Aerolíneas Argentinas', 'AR'],
  ],
  asia: [
    ['Qatar Airways', 'QR'],
    ['Emirates', 'EK'],
    ['Turkish Airlines', 'TK'],
    ['ANA', 'NH'],
  ],
};

// Popular routes for the demo audience (LatAm-first). Edit freely.
export const ROUTES = [
  {
    origin: 'CCS',
    destination: 'COR',
    cls: 'regional-long',
    note: 'Marta’s route — always 1+ stop (via BOG/PTY/LIM)',
  },
  { origin: 'CCS', destination: 'BOG', cls: 'regional' },
  { origin: 'CCS', destination: 'PTY', cls: 'regional' },
  { origin: 'CCS', destination: 'MAD', cls: 'transatlantic' },
  { origin: 'BOG', destination: 'MDE', cls: 'domestic-short' },
  { origin: 'BOG', destination: 'COR', cls: 'regional-long' },
  { origin: 'BOG', destination: 'MEX', cls: 'regional' },
  { origin: 'BOG', destination: 'MIA', cls: 'north-america' },
  { origin: 'MEX', destination: 'BOG', cls: 'regional' },
  { origin: 'MEX', destination: 'CUN', cls: 'domestic-medium' },
  { origin: 'EZE', destination: 'COR', cls: 'domestic-medium' },
  { origin: 'EZE', destination: 'GRU', cls: 'regional' },
  { origin: 'EZE', destination: 'SCL', cls: 'regional' },
  { origin: 'EZE', destination: 'MAD', cls: 'transatlantic' },
  { origin: 'EZE', destination: 'NRT', cls: 'asia' },
  { origin: 'GRU', destination: 'LIM', cls: 'regional' },
  { origin: 'LIM', destination: 'BOG', cls: 'regional' },
  { origin: 'SCL', destination: 'LIM', cls: 'regional' },
];

// ---------- deterministic randomness ----------
let state = SEED >>> 0 || 1;
const rand = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return ((state >>> 0) % 100000) / 100000;
};
const between = (a, b) => a + (b - a) * rand();
const pick = (list) => list[Math.floor(rand() * list.length)];

const DEPARTURE_SLOTS = [
  '05:40',
  '06:30',
  '07:15',
  '08:50',
  '10:20',
  '12:05',
  '13:45',
  '15:30',
  '17:10',
  '18:55',
  '20:40',
  '22:15',
];

function estimateFares(route, count, startDay) {
  const cls = CLASSES[route.cls];
  const fares = [];
  for (let i = 0; i < count; i++) {
    const [carrier, code] = pick(CARRIERS[route.cls]);
    const dayOffset = Math.floor(between(2, DAYS_AHEAD));
    const day = new Date(startDay.getTime() + dayOffset * 86_400_000).toISOString().slice(0, 10);
    const time = pick(DEPARTURE_SLOTS);
    const stops = pick(cls.stops);
    const duration = Math.round(
      between(cls.duration[0], cls.duration[1]) + stops * between(60, 180),
    );
    // weekend and last-minute premiums; a stop discounts; morning slots cost a little more
    const weekend = [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) ? 1.08 : 1;
    const lastMinute = dayOffset < 7 ? 1.18 : 1;
    const stopFactor = stops ? 0.9 : 1;
    const price = Math.round(
      cls.base * between(cls.spread[0], cls.spread[1]) * weekend * lastMinute * stopFactor,
    );
    fares.push({
      ...route,
      airline: carrier,
      flightNumber: `${code}${Math.floor(between(100, 999))}`,
      departureAt: `${day}T${time}:00.000Z`,
      durationMinutes: duration,
      stops,
      amountMinor: price * 100,
      origin_source: 'estimate',
    });
  }
  return fares;
}

async function travelpayoutsFares(route, startDay) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) return [];
  const months = [0, 1].map((m) => {
    const d = new Date(Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth() + m, 1));
    return d.toISOString().slice(0, 7);
  });
  const out = [];
  for (const month of months) {
    const q = new URLSearchParams({
      origin: route.origin,
      destination: route.destination,
      departure_at: month,
      currency: 'usd',
      one_way: 'true',
      sorting: 'price',
      limit: '20',
      unique: 'false',
    });
    try {
      const r = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${q}`, {
        headers: { 'X-Access-Token': token },
      });
      if (!r.ok) continue;
      const body = await r.json();
      for (const f of body.data ?? []) {
        if (!f.departure_at || !f.price) continue;
        out.push({
          ...route,
          airline: f.airline ? `${f.airline} (Aviasales cache)` : 'Aviasales cache',
          flightNumber: `${f.airline ?? 'XX'}${f.flight_number ?? ''}`.slice(0, 10),
          departureAt: `${f.departure_at.slice(0, 16)}:00.000Z`, // local wall time, like Duffel
          durationMinutes: f.duration ?? undefined,
          stops: f.transfers ?? 0,
          amountMinor: Math.round(f.price * 100),
          origin_source: 'travelpayouts',
        });
      }
    } catch {
      // reference source is optional
    }
  }
  return out;
}

async function api(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      'X-Requested-With': 'Authera',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${path} → ${JSON.stringify(j.error ?? j).slice(0, 160)}`);
  return j.data;
}

async function main() {
  const startDay = new Date();
  const me = await api('/api/me');
  const merchant = me.merchants.find((m) => m.slug === 'duffel') ?? me.merchants[0];
  const routes = ROUTES.filter(
    (r) => ONLY.length === 0 || ONLY.includes(`${r.origin}-${r.destination}`),
  );
  let injected = 0;
  console.log(
    `${DRY_RUN ? '[dry run] ' : ''}${API_BASE} · seed ${SEED} · ${routes.length} routes · ${PER_ROUTE} fares each`,
  );
  for (const route of routes) {
    const real = await travelpayoutsFares(route, startDay);
    const fares = real.length
      ? real.slice(0, PER_ROUTE)
      : estimateFares(route, PER_ROUTE, startDay);
    const deal = DEALS[`${route.origin}-${route.destination}`];
    if (deal) {
      const cheapest = [...fares].sort((a, b) => a.amountMinor - b.amountMinor)[0];
      fares.push({
        ...cheapest,
        amountMinor: deal * 100,
        flightNumber: `${cheapest.flightNumber.slice(0, 2)}${Math.floor(between(100, 999))}`,
        origin_source: 'deal',
      });
    }
    const prices = fares.map((f) => f.amountMinor / 100).sort((a, b) => a - b);
    console.log(
      `${route.origin}→${route.destination}  ${route.cls.padEnd(15)} ${real.length ? 'real cached' : 'estimated  '}  USD ${prices[0]}–${prices.at(-1)}  ${fares.length} fares${deal ? ` (+ deal ${deal})` : ''}`,
    );
    if (DRY_RUN) continue;
    for (const f of fares) {
      await api('/api/demo/offers', {
        merchantId: merchant.id,
        origin: f.origin,
        destination: f.destination,
        amountMinor: f.amountMinor,
        currency: 'USD',
        departureAt: f.departureAt,
        airline: f.airline.slice(0, 40),
        flightNumber: f.flightNumber,
        ...(f.durationMinutes
          ? { durationMinutes: Math.min(4320, Math.max(30, f.durationMinutes)) }
          : {}),
        stops: Math.min(3, f.stops ?? 0),
        expiresInMinutes: 60 * 24 * 7,
      });
      injected += 1;
    }
  }
  console.log(
    DRY_RUN
      ? 'nothing injected (dry run)'
      : `${injected} fares injected · they expire in 7 days · "Reset scenario" on /demo clears them`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
