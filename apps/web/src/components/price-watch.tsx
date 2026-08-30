import {
  effectiveFlightDateWindow,
  type FlightOfferView,
  type MandateView,
} from '@authera/contracts';
import { formatMoney } from '../lib/format.js';
import { offerHeadline, offerInScope } from '../lib/intent.js';
import { Badge, Table, Td, Th } from './ui/primitives.js';

export function offerMatches(
  offer: FlightOfferView,
  mandate: MandateView | undefined,
): { eligible: boolean; why: string } {
  if (!mandate) return { eligible: false, why: 'no active mandate' };
  const intent = mandate.policy.intent;
  const limits = mandate.policy.limits;
  if (offer.kind !== intent.type)
    return { eligible: false, why: intent.type === 'flight' ? 'not a flight' : 'not a product' };
  if (intent.type === 'flight') {
    const mismatch = flightRuleMismatch(offer, intent);
    if (mismatch) return { eligible: false, why: mismatch };
  } else {
    if (!offerInScope(offer, intent)) return { eligible: false, why: 'different search' };
    if (offer.quantity > intent.maxQuantity) return { eligible: false, why: 'quantity' };
  }
  if (offer.total.currency !== limits.currency) return { eligible: false, why: 'currency' };
  if (offer.total.minor > limits.maxPerPurchaseMinor)
    return {
      eligible: false,
      why: `above ${formatMoney({ currency: limits.currency, minor: limits.maxPerPurchaseMinor })}`,
    };
  if (offer.status !== 'AVAILABLE') return { eligible: false, why: offer.status.toLowerCase() };
  return { eligible: true, why: 'within mandate' };
}

/** Closest authoritative flight in the soft band, only when no offer meets the hard limit. */

/** Simple, dependency-free SVG chart: offer prices over departure date with the mandate threshold. */

function flightRuleMismatch(
  offer: FlightOfferView,
  intent: Extract<MandateView['policy']['intent'], { type: 'flight' }>,
): string | undefined {
  const day = (offer.departureAt ?? '').slice(0, 10);
  const dates = effectiveFlightDateWindow(intent);
  if (offer.kind !== 'flight') return 'not a flight';
  if (offer.origin !== intent.origin || offer.destination !== intent.destination)
    return 'different route';
  if (offer.cabin !== intent.cabin) return `${offer.cabin} cabin`;
  if (offer.passengerCount !== intent.passengerCount) return 'passenger count';
  if (day < dates.from || day > dates.to) return 'outside travel dates';
  return undefined;
}

export function OffersTable({
  offers,
  mandate,
  onSelect,
  selectedId,
}: {
  offers: FlightOfferView[];
  mandate?: MandateView | undefined;
  onSelect?: (offer: FlightOfferView) => void;
  selectedId?: string;
}) {
  if (offers.length === 0)
    return <p className="text-[13px] text-ink-muted">No offers in the catalog.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Merchant</Th>
          <Th>Item</Th>
          <Th>Route</Th>
          <Th>Departure</Th>
          <Th>Cabin / qty</Th>
          <Th className="text-right">Price</Th>
          <Th>Eligibility</Th>
          {onSelect ? <Th /> : null}
        </tr>
      </thead>
      <tbody>
        {offers.map((offer) => {
          const match = offerMatches(offer, mandate);
          return (
            <tr key={offer.id} className={selectedId === offer.id ? 'bg-cobalt-soft/50' : ''}>
              <Td>
                <span className="font-medium">{offer.merchantName}</span>{' '}
                <span className="font-mono text-[11px] text-ink-faint">{offer.market}</span>
              </Td>
              <Td>
                <span className="font-medium">{offerHeadline(offer)}</span>
                {offer.source === 'demo' ? (
                  <Badge tone="info" className="ml-1.5">
                    injected
                  </Badge>
                ) : null}
                {offer.source === 'duffel' ? (
                  <Badge tone="verified" className="ml-1.5">
                    live · Duffel test
                  </Badge>
                ) : null}
              </Td>
              <Td mono>{offer.kind === 'flight' ? `${offer.origin}→${offer.destination}` : '—'}</Td>
              <Td>{offer.departureAt ? offer.departureAt.slice(0, 16).replace('T', ' ') : '—'}</Td>
              <Td>{offer.kind === 'flight' ? offer.cabin : `×${offer.quantity}`}</Td>
              <Td className="tabular text-right font-medium">{formatMoney(offer.total)}</Td>
              <Td>
                <Badge tone={match.eligible ? 'verified' : 'neutral'}>
                  {match.eligible ? 'eligible' : match.why}
                </Badge>
              </Td>
              {onSelect ? (
                <Td>
                  <button
                    type="button"
                    className="text-[12.5px] font-medium text-cobalt hover:underline"
                    onClick={() => onSelect(offer)}
                  >
                    {selectedId === offer.id ? 'Selected' : 'Select'}
                  </button>
                </Td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
