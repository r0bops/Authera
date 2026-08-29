import { ArrowRight, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useApprovals, useAuditEvents, useMandates, useMe, useOffers } from '../api/hooks.js';
import { offerMatches, PriceWatchChart } from '../components/price-watch.js';
import { MandateStatusBadge, Timeline } from '../components/status.js';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  Skeleton,
} from '../components/ui/primitives.js';
import { formatDate, formatMoney } from '../lib/format.js';

export function OverviewPage() {
  const me = useMe();
  const mandates = useMandates();
  const offers = useOffers();
  const active = mandates.data?.find((m) => m.status === 'ACTIVE') ?? mandates.data?.[0];
  const events = useAuditEvents(active ? { mandateId: active.id, limit: 50 } : { limit: 0 });
  const eligible =
    active && offers.data
      ? offers.data
          .filter((o) => offerMatches(o, active).eligible)
          .sort((a, b) => a.total.minor - b.total.minor)
      : [];
  const routeOffers =
    active && offers.data
      ? offers.data
          .filter(
            (o) =>
              o.origin === active.policy.intent.origin &&
              o.destination === active.policy.intent.destination,
          )
          .sort((a, b) => a.total.minor - b.total.minor)
      : [];
  const best = eligible[0] ?? routeOffers[0];
  const approvals = useApprovals();
  const pendingApprovals = approvals.data?.filter((a) => a.state === 'PENDING') ?? [];

  return (
    <>
      <PageHeader
        title={`Good day, ${me.data?.user.displayName.split(' ')[0] ?? 'Marta'}`}
        description="Your purchasing agent only spends inside the mandates you sign. Everything it does is verified by the gateway and recorded."
        actions={
          <Link to="/mandates/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden /> Create mandate
            </Button>
          </Link>
        }
      />
      {pendingApprovals.map((a) => (
        <div key={a.id} className="mb-4">
          <Alert
            tone="attention"
            title={`Approval requested: ${formatMoney(a.requested)} for ${a.offer ? `${a.offer.airline} ${a.offer.flightNumber}` : 'a flight'} (limit ${formatMoney(a.limit)})`}
          >
            The agent stopped because this offer is outside your mandate.{' '}
            <Link className="font-medium text-cobalt hover:underline" to={`/approvals/${a.id}`}>
              Review and decide
            </Link>
          </Alert>
        </div>
      ))}
      {mandates.isError ? (
        <ErrorState error={mandates.error} retry={() => void mandates.refetch()} />
      ) : null}
      {mandates.isPending ? <Skeleton className="h-40" /> : null}
      {mandates.data && !active ? (
        <EmptyState
          title="No mandate yet"
          action={
            <Link to="/mandates/new">
              <Button>Create your first mandate</Button>
            </Link>
          }
        >
          Authorize your agent to buy one flight within limits you set — price, route, dates,
          merchant, and expiry.
        </EmptyState>
      ) : null}
      {active ? (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-4 flex flex-col gap-4">
            <Card title="Active mandate" actions={<MandateStatusBadge status={active.status} />}>
              <KeyValue
                items={[
                  {
                    label: 'Route',
                    value: (
                      <span className="font-medium">
                        {active.policy.intent.origin} → {active.policy.intent.destination}
                      </span>
                    ),
                  },
                  {
                    label: 'Maximum',
                    value: (
                      <span className="font-medium">
                        {formatMoney({
                          currency: active.policy.limits.currency,
                          minor: active.policy.limits.maxPerPurchaseMinor,
                        })}
                      </span>
                    ),
                  },
                  {
                    label: 'Travel dates',
                    value: `${active.policy.intent.departureDateFrom} → ${active.policy.intent.departureDateTo}`,
                  },
                  { label: 'Valid until', value: formatDate(active.policy.validUntil) },
                  {
                    label: 'Payment',
                    value: active.paymentMethod
                      ? `${active.paymentMethod.brand} •••• ${active.paymentMethod.last4}`
                      : '—',
                  },
                  {
                    label: 'Remaining',
                    value: `${active.usage.remainingCount} purchase(s) · ${formatMoney({ currency: active.policy.limits.currency, minor: active.usage.remainingMinor })}`,
                  },
                ]}
              />
              <Link
                to={`/mandates/${active.id}`}
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-cobalt hover:underline"
              >
                Inspect or pause <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </Card>
            <Card
              title="Current best offer"
              description={
                eligible.length > 0
                  ? 'Within your mandate — the agent will request it.'
                  : 'Nothing within your limit yet.'
              }
            >
              {best ? (
                <KeyValue
                  items={[
                    { label: 'Flight', value: `${best.airline} ${best.flightNumber}` },
                    { label: 'Departs', value: best.departureAt.slice(0, 16).replace('T', ' ') },
                    {
                      label: 'Price',
                      value: (
                        <span
                          className={`text-[16px] font-semibold ${eligible[0] ? 'text-emerald' : 'text-ink'}`}
                        >
                          {formatMoney(best.total)}
                        </span>
                      ),
                    },
                    {
                      label: 'Threshold',
                      value: formatMoney({
                        currency: active.policy.limits.currency,
                        minor: active.policy.limits.maxPerPurchaseMinor,
                      }),
                    },
                  ]}
                />
              ) : (
                <p className="text-[13px] text-ink-muted">No offers on this route yet.</p>
              )}
            </Card>
          </div>
          <div className="col-span-8 flex flex-col gap-4">
            <Card
              title="Price watch"
              description={`${active.policy.intent.origin} → ${active.policy.intent.destination}, economy · dots turn green when an offer is eligible`}
            >
              {offers.isPending ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <PriceWatchChart offers={offers.data ?? []} mandate={active} />
              )}
            </Card>
            <Card
              title="Recent agent activity"
              actions={
                <Link
                  to="/activity"
                  className="text-[12.5px] font-medium text-cobalt hover:underline"
                >
                  All activity
                </Link>
              }
            >
              {events.isPending ? (
                <Skeleton className="h-24" />
              ) : (
                <Timeline events={events.data ?? []} limit={8} />
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
