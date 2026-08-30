import {
  effectiveFlightDateWindow,
  type FlightOfferView,
  type MandateView,
} from '@authera/contracts';
import { formatMoney } from '../lib/format.js';
import { offerHeadline, offerInScope, offerWhen } from '../lib/intent.js';
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
    const day = (offer.departureAt ?? '').slice(0, 10);
    const dates = effectiveFlightDateWindow(intent);
    if (offer.origin !== intent.origin || offer.destination !== intent.destination)
      return { eligible: false, why: 'different route' };
    if (offer.cabin !== intent.cabin) return { eligible: false, why: `${offer.cabin} cabin` };
    if (offer.passengerCount !== intent.passengerCount)
      return { eligible: false, why: 'passenger count' };
    if (day < dates.from || day > dates.to) return { eligible: false, why: 'outside travel dates' };
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

/** Simple, dependency-free SVG chart: offer prices over departure date with the mandate threshold. */
export function PriceWatchChart({
  offers,
  mandate,
}: {
  offers: FlightOfferView[];
  mandate: MandateView | undefined;
}) {
  const route = mandate
    ? offers.filter((o) => offerInScope(o, mandate.policy.intent))
    : offers.filter((o) => o.kind !== 'flight' || o.cabin === 'economy');
  const points = [...route].sort((a, b) => offerWhen(a).localeCompare(offerWhen(b)));
  const threshold = mandate?.policy.limits.maxPerPurchaseMinor ?? null;
  const width = 640;
  const height = 180;
  const pad = { left: 48, right: 16, top: 12, bottom: 28 };
  const values = points.map((p) => p.total.minor).concat(threshold !== null ? [threshold] : []);
  const max = Math.max(...values, 1) * 1.1;
  const min = 0;
  const x = (i: number) =>
    pad.left +
    (points.length <= 1
      ? (width - pad.left - pad.right) / 2
      : (i * (width - pad.left - pad.right)) / (points.length - 1));
  const y = (v: number) =>
    pad.top + (height - pad.top - pad.bottom) * (1 - (v - min) / (max - min));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  if (points.length === 0) {
    return <p className="text-[13px] text-ink-muted">No offers on this route yet.</p>;
  }
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[180px] w-full"
      role="img"
      aria-label="Price watch chart"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(t)}
            y2={y(t)}
            stroke="#e2e6ee"
            strokeWidth={1}
          />
          <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="#8b95a7">
            {Math.round(t / 100)}
          </text>
        </g>
      ))}
      {threshold !== null ? (
        <g>
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="#14805c"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
          <text
            x={width - pad.right}
            y={y(threshold) - 4}
            textAnchor="end"
            fontSize={10.5}
            fill="#14805c"
            fontWeight={600}
          >
            limit{' '}
            {formatMoney({ currency: mandate?.policy.limits.currency ?? 'USD', minor: threshold })}
          </text>
        </g>
      ) : null}
      {points.length > 1 ? (
        <polyline
          fill="none"
          stroke="#2448d6"
          strokeWidth={1.5}
          points={points.map((p, i) => `${x(i)},${y(p.total.minor)}`).join(' ')}
        />
      ) : null}
      {points.map((p, i) => {
        const eligible =
          threshold !== null && p.total.minor <= threshold && offerMatches(p, mandate).eligible;
        return (
          <g key={p.id}>
            <circle cx={x(i)} cy={y(p.total.minor)} r={4} fill={eligible ? '#14805c' : '#2448d6'} />
            <text x={x(i)} y={height - 10} textAnchor="middle" fontSize={10} fill="#5b6577">
              {offerWhen(p).slice(5, 10)}
            </text>
          </g>
        );
      })}
    </svg>
  );
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
