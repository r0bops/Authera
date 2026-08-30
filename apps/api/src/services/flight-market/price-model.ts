/**
 * Region-calibrated prices for SANDBOX inventory (Duffel test mode has synthetic fares).
 *
 * Off in live mode and off by default. When on, every sandbox offer gets a deterministic price
 * from a region-class model (the same classes as `scripts/populate-flights.mjs`): the class comes
 * from the two airports' countries, the factor from a hash of the provider offer id — so the same
 * offer always calibrates to the same number, on search and on revalidation alike. Offers carry
 * `priceModel: 'region-calibrated'` so every screen and receipt says what the number is.
 */

export type PriceModel = 'off' | 'region';

type RegionClass =
  | 'domestic-short'
  | 'domestic-medium'
  | 'regional'
  | 'regional-long'
  | 'north-america'
  | 'transatlantic'
  | 'asia';

const CLASSES: Record<RegionClass, { base: number; spread: [number, number] }> = {
  'domestic-short': { base: 45, spread: [0.7, 1.9] },
  'domestic-medium': { base: 95, spread: [0.7, 1.8] },
  regional: { base: 190, spread: [0.75, 1.7] },
  'regional-long': { base: 480, spread: [0.8, 1.6] },
  'north-america': { base: 330, spread: [0.75, 1.7] },
  transatlantic: { base: 720, spread: [0.8, 1.5] },
  asia: { base: 1250, spread: [0.85, 1.4] },
};

/** Airport → ISO country. Unknown airports fall back to a regional fare. */
const COUNTRY: Record<string, string> = {
  CCS: 'VE',
  MAR: 'VE',
  VLN: 'VE',
  BOG: 'CO',
  MDE: 'CO',
  CLO: 'CO',
  CTG: 'CO',
  BAQ: 'CO',
  PTY: 'PA',
  SJO: 'CR',
  SAL: 'SV',
  GUA: 'GT',
  MEX: 'MX',
  CUN: 'MX',
  GDL: 'MX',
  MTY: 'MX',
  EZE: 'AR',
  AEP: 'AR',
  COR: 'AR',
  MDZ: 'AR',
  BRC: 'AR',
  GRU: 'BR',
  GIG: 'BR',
  BSB: 'BR',
  CGH: 'BR',
  LIM: 'PE',
  CUZ: 'PE',
  SCL: 'CL',
  UIO: 'EC',
  GYE: 'EC',
  MVD: 'UY',
  ASU: 'PY',
  LPB: 'BO',
  MIA: 'US',
  JFK: 'US',
  LAX: 'US',
  ORD: 'US',
  YYZ: 'CA',
  YUL: 'CA',
  MAD: 'ES',
  BCN: 'ES',
  LIS: 'PT',
  CDG: 'FR',
  LHR: 'GB',
  FCO: 'IT',
  AMS: 'NL',
  FRA: 'DE',
  NRT: 'JP',
  HND: 'JP',
  DXB: 'AE',
  DOH: 'QA',
  IST: 'TR',
  SYD: 'AU',
  PEK: 'CN',
  ICN: 'KR',
};

const LATAM_NORTH = new Set(['VE', 'CO', 'PA', 'CR', 'SV', 'GT', 'MX', 'EC', 'PE', 'BO']);
const LATAM_SOUTH = new Set(['AR', 'BR', 'CL', 'UY', 'PY']);
const NORTH_AMERICA = new Set(['US', 'CA']);
const EUROPE = new Set(['ES', 'PT', 'FR', 'GB', 'IT', 'NL', 'DE']);
const SHORT_DOMESTIC = new Set([
  'BOG-MDE',
  'MDE-BOG',
  'BOG-CLO',
  'CLO-BOG',
  'LIM-CUZ',
  'CUZ-LIM',
  'EZE-MDZ',
  'MDZ-EZE',
  'AEP-COR',
  'COR-AEP',
  'GRU-GIG',
  'GIG-GRU',
  'MEX-GDL',
  'GDL-MEX',
]);

export function regionClassFor(origin: string, destination: string): RegionClass {
  const a = COUNTRY[origin.toUpperCase()];
  const b = COUNTRY[destination.toUpperCase()];
  if (!a || !b) return 'regional';
  if (a === b)
    return SHORT_DOMESTIC.has(`${origin}-${destination}`.toUpperCase())
      ? 'domestic-short'
      : 'domestic-medium';
  const latam = (c: string) => LATAM_NORTH.has(c) || LATAM_SOUTH.has(c);
  if (latam(a) && latam(b)) {
    const spansContinent =
      (LATAM_NORTH.has(a) && LATAM_SOUTH.has(b)) || (LATAM_SOUTH.has(a) && LATAM_NORTH.has(b));
    return spansContinent ? 'regional-long' : 'regional';
  }
  if (NORTH_AMERICA.has(a) || NORTH_AMERICA.has(b)) return 'north-america';
  if (EUROPE.has(a) || EUROPE.has(b)) return 'transatlantic';
  return 'asia';
}

/** FNV-1a → [0, 1): stable per offer id, so a fare never moves between search and payment. */
function unit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % 100000) / 100000;
}

/** Whole-dollar price in minor units for a sandbox offer. */
export function regionCalibratedMinor(input: {
  providerOfferId: string;
  origin: string;
  destination: string;
  stops?: number;
}): number {
  const cls = CLASSES[regionClassFor(input.origin, input.destination)];
  const u = unit(input.providerOfferId);
  const factor = cls.spread[0] + (cls.spread[1] - cls.spread[0]) * u;
  const stopFactor = (input.stops ?? 0) > 0 ? 0.9 : 1;
  return Math.max(1, Math.round(cls.base * factor * stopFactor)) * 100;
}
