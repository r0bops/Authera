import { ArrowRight, Check, CircleDashed, Package, Plane, Plus, Search } from 'lucide-react';
import { Link } from 'react-router';
import {
  useApprovals,
  useAuditEvents,
  useMandates,
  useMe,
  useOffers,
  usePurchases,
} from '../api/hooks.js';
import { offerMatches, PriceWatchChart } from '../components/price-watch.js';
import { Timeline } from '../components/status.js';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  buttonStyles,
} from '../components/ui/primitives.js';
import { formatDate, formatMoney, friendlyAgentName } from '../lib/format.js';
import { intentLabel, offerHeadline, offerInScope } from '../lib/intent.js';

export function OverviewPage() {
  const me = useMe();
  const mandates = useMandates();
  const offers = useOffers();
  const approvals = useApprovals();
  const purchases = usePurchases();
  const active = mandates.data?.find((mandate) => mandate.status === 'ACTIVE');
  const events = useAuditEvents({
    mandateId: active?.id,
    limit: 50,
    enabled: Boolean(active),
  });
  const eligible =
    active && offers.data
      ? offers.data
          .filter((offer) => offerMatches(offer, active).eligible)
          .sort((a, b) => a.total.minor - b.total.minor)
      : [];
  const routeOffers =
    active && offers.data
      ? offers.data
          .filter((offer) => offerInScope(offer, active.policy.intent))
          .sort((a, b) => a.total.minor - b.total.minor)
      : [];
  const best = eligible[0] ?? routeOffers[0];
  const pendingApprovals = approvals.data?.filter((approval) => approval.state === 'PENDING') ?? [];
  const completedPurchase = purchases.data?.find(
    (purchase) => purchase.mandateId === active?.id && purchase.state === 'SUCCEEDED',
  );
  const planComplete = active?.usage.remainingCount === 0;
  const firstName = me.data?.user.displayName.split(' ')[0] ?? 'there';
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);

  return (
    <>
      <div className="mb-5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            Good day, {firstName}
          </h1>
          <p className="mt-1 max-w-2xl text-[13.5px] text-ink-muted">
            Tell {agentName} what you need once. It searches and buys only inside your rules.
          </p>
        </div>
        <Link to="/dashboard/mandates/new" className={buttonStyles()}>
          <Plus className="h-4 w-4" aria-hidden /> Plan a purchase
        </Link>
      </div>

      {pendingApprovals.length > 0 ? (
        <section className="mb-4" aria-labelledby="attention-heading">
          <h2 id="attention-heading" className="mb-2 text-[14px] font-semibold text-ink">
            Needs your decision
          </h2>
          <div className="space-y-2">
            {pendingApprovals.map((approval) => (
              <Alert
                key={approval.id}
                tone="attention"
                title={`${formatMoney(approval.requested)} ${approval.offer ? offerHeadline(approval.offer) : 'offer'} — ${formatMoney(approval.difference)} above your plan`}
              >
                {agentName} paused before paying. Your standing limit stays unchanged unless you
                approve this exact offer.{' '}
                <Link
                  className="inline-flex min-h-10 items-center font-medium text-amber underline-offset-2 hover:underline"
                  to={`/dashboard/approvals/${approval.id}`}
                >
                  Review the offer <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </Alert>
            ))}
          </div>
        </section>
      ) : null}

      {mandates.isError ? (
        <ErrorState error={mandates.error} retry={() => void mandates.refetch()} />
      ) : null}
      {mandates.isPending ? <DashboardSkeleton /> : null}

      {mandates.data && !active ? (
        <EmptyState
          title={`${agentName} is ready when you are`}
          action={
            <Link to="/dashboard/mandates/new" className={buttonStyles()}>
              Plan your first purchase
            </Link>
          }
        >
          Describe what you need and your maximum price. {agentName} will search, compare, and only
          buy when every rule matches.
        </EmptyState>
      ) : null}

      {active ? (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="verified">
                    {planComplete ? 'Plan complete' : `${agentName} is watching`}
                  </Badge>
                  <span className="text-[12px] text-ink-muted">
                    until {formatDate(active.policy.validUntil)}
                  </span>
                </div>
                <h2 className="mt-3 text-[20px] font-semibold tracking-tight text-ink">
                  {intentLabel(active.policy.intent)}
                </h2>
                <p className="mt-1 max-w-3xl text-[14px] leading-6 text-ink-muted">
                  {active.policy.intent.type === 'flight'
                    ? `Buy ${active.policy.intent.passengerCount === 1 ? 'one' : active.policy.intent.passengerCount} economy flight for `
                    : `Buy ${active.policy.intent.maxQuantity === 1 ? 'one' : `up to ${active.policy.intent.maxQuantity}`} “${active.policy.intent.query}” for `}
                  <strong className="font-semibold text-ink">
                    {formatMoney({
                      currency: active.policy.limits.currency,
                      minor: active.policy.limits.maxPerPurchaseMinor,
                    })}{' '}
                    or less
                  </strong>
                  . Anything outside these rules is{' '}
                  {active.policy.escalation === 'require_human'
                    ? 'paused for your approval.'
                    : 'blocked automatically.'}
                </p>
              </div>
              <Link
                to={
                  completedPurchase
                    ? `/dashboard/purchases/${completedPurchase.id}`
                    : `/dashboard/mandates/${active.id}`
                }
                className={buttonStyles({ variant: 'secondary', className: 'shrink-0' })}
              >
                {completedPurchase ? 'View purchase record' : 'Change or stop'}
              </Link>
            </div>

            <ol className="grid border-t border-line bg-surface-muted/45 sm:grid-cols-3">
              <PlanStep icon={Check} title="Plan authorized" detail="Your rules are active" done />
              <PlanStep
                icon={Search}
                title={
                  completedPurchase
                    ? 'Match selected'
                    : eligible.length > 0
                      ? 'Match available'
                      : 'Searching prices'
                }
                detail={
                  completedPurchase
                    ? 'Every rule matched'
                    : eligible.length > 0
                      ? `${formatMoney(eligible[0]!.total)} matches your rules`
                      : best
                        ? `Best so far: ${formatMoney(best.total)}`
                        : 'Waiting for a real offer'
                }
                active={!completedPurchase}
                done={Boolean(completedPurchase)}
              />
              <PlanStep
                icon={CircleDashed}
                title={completedPurchase ? 'Purchase completed' : 'Purchase'}
                detail={
                  completedPurchase
                    ? `${formatMoney(completedPurchase.amount)} paid safely`
                    : 'Only after every rule matches'
                }
                done={Boolean(completedPurchase)}
              />
            </ol>
          </section>

          <div className="grid gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <Card
                title={completedPurchase ? 'Purchased' : 'Best price right now'}
                description={
                  completedPurchase
                    ? 'Aria completed this plan inside your rules.'
                    : eligible.length > 0
                      ? 'This offer is inside your plan.'
                      : 'No action needed. Aria keeps watching.'
                }
              >
                {offers.isError ? (
                  <ErrorState error={offers.error} retry={() => void offers.refetch()} />
                ) : offers.isPending ? (
                  <Skeleton className="h-28" />
                ) : completedPurchase ? (
                  <div>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[13px] font-medium text-ink">
                          {completedPurchase.offerSummary ?? 'Purchase completed'}
                        </p>
                        <p className="mt-0.5 text-[12.5px] text-ink-muted">
                          Paid with the plan you approved
                        </p>
                      </div>
                      <p className="tabular whitespace-nowrap text-[26px] font-semibold tracking-tight text-emerald">
                        {formatMoney(completedPurchase.amount)}
                      </p>
                    </div>
                    <Link
                      to={`/dashboard/purchases/${completedPurchase.id}`}
                      className="mt-4 inline-flex min-h-10 items-center border-t border-line pt-3 text-[12.5px] font-medium text-cobalt hover:underline"
                    >
                      Open receipt <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                    </Link>
                  </div>
                ) : best ? (
                  <div>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-[13px] font-medium text-ink">{offerHeadline(best)}</p>
                        <p className="mt-0.5 text-[12.5px] text-ink-muted">
                          {best.merchantName}
                          {best.departureAt ? ` · departs ${best.departureAt.slice(0, 10)}` : ''}
                        </p>
                      </div>
                      <p
                        className={`tabular whitespace-nowrap text-[26px] font-semibold tracking-tight ${eligible.length > 0 ? 'text-emerald' : 'text-ink'}`}
                      >
                        {formatMoney(best.total)}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[12.5px]">
                      {best.kind === 'goods' ? (
                        <Package className="h-4 w-4 text-cobalt" aria-hidden />
                      ) : (
                        <Plane className="h-4 w-4 text-cobalt" aria-hidden />
                      )}
                      {eligible.length > 0 ? (
                        <span className="font-medium text-emerald">Inside your price limit</span>
                      ) : (
                        <span className="text-ink-muted">
                          {formatMoney({
                            currency: active.policy.limits.currency,
                            minor: Math.max(
                              0,
                              best.total.minor - active.policy.limits.maxPerPurchaseMinor,
                            ),
                          })}{' '}
                          above your limit
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-muted">
                    No real offers have been returned for this route yet.
                  </p>
                )}
              </Card>
            </div>

            <div className="lg:col-span-7">
              <Card
                title={`What ${agentName} has done`}
                description="A readable record of the work behind your plan."
                actions={
                  <Link
                    to="/dashboard/activity"
                    className="inline-flex min-h-10 items-center text-[12.5px] font-medium text-cobalt hover:underline"
                  >
                    View all
                  </Link>
                }
              >
                {events.isError ? (
                  <ErrorState error={events.error} retry={() => void events.refetch()} />
                ) : events.isPending ? (
                  <Skeleton className="h-28" />
                ) : (
                  <Timeline events={events.data ?? []} limit={5} showLinks={false} plainLanguage />
                )}
              </Card>
            </div>
          </div>

          <details className="group rounded-md border border-line bg-surface">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
              <span>See all prices Aria is comparing</span>
              <span className="text-[12px] font-normal text-ink-muted group-open:hidden">
                Optional detail
              </span>
            </summary>
            <div className="border-t border-line px-4 py-3">
              {offers.isPending ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <PriceWatchChart offers={offers.data ?? []} mandate={active} />
              )}
            </div>
          </details>
        </div>
      ) : null}
    </>
  );
}

function PlanStep({
  icon: Icon,
  title,
  detail,
  done = false,
  active = false,
}: {
  icon: typeof Check;
  title: string;
  detail: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          done
            ? 'bg-emerald-soft text-emerald'
            : active
              ? 'bg-cobalt-soft text-cobalt'
              : 'bg-surface text-ink-faint'
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-ink">{title}</span>
        <span className="block truncate text-[11.5px] text-ink-muted">{detail}</span>
      </span>
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading your purchase plan">
      <Skeleton className="h-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    </div>
  );
}
