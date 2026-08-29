import type { FlightOfferView, Intent } from '@authera/contracts';
import { intentTitle, normalizeQuery } from '@authera/contracts';
import { airportLabel } from './airports.js';

export { intentTitle };

/** Long human label: "Caracas (CCS) → Córdoba (COR)" or "“wool runners” (up to 2)". */
export function intentLabel(intent: Intent): string {
  if (intent.type === 'flight')
    return `${airportLabel(intent.origin)} → ${airportLabel(intent.destination)}`;
  return intent.maxQuantity === 1
    ? `“${intent.query}”`
    : `“${intent.query}” (up to ${intent.maxQuantity})`;
}

export function intentKindLabel(intent: Intent): string {
  return intent.type === 'flight' ? 'Flight' : 'Product';
}

/** Whether an offer belongs to the intent's scope (route for flights, query for goods). */
export function offerInScope(offer: FlightOfferView, intent: Intent): boolean {
  if (intent.type === 'flight') {
    return (
      offer.kind === 'flight' &&
      offer.origin === intent.origin &&
      offer.destination === intent.destination
    );
  }
  return (
    offer.kind === 'goods' &&
    offer.searchQuery !== undefined &&
    normalizeQuery(offer.searchQuery) === normalizeQuery(intent.query)
  );
}

/** What to call the thing being bought in a table or receipt. */
export function offerHeadline(offer: FlightOfferView): string {
  if (offer.kind === 'goods') return offer.title ?? 'Product';
  return `${offer.airline ?? ''} ${offer.flightNumber ?? ''}`.trim() || 'Flight';
}

/** A time-like axis for price charts: departure for flights, discovery time for goods. */
export function offerWhen(offer: FlightOfferView): string {
  return offer.departureAt ?? offer.createdAt;
}
