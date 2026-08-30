import type { AuditEvent, ExecutionSummary, MandateView } from '@authera/contracts';
import { Bot, CheckCircle2, Clock3, Radar, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAuditEvents, useExecutions, useMandates, useMe } from '../api/hooks.js';
import { MandateStatusBadge, Timeline } from '../components/status.js';
import { EmptyState, ErrorState, Skeleton, buttonStyles } from '../components/ui/primitives.js';
import { cn } from '../lib/cn.js';
import { formatDate, formatMoney, friendlyAgentName } from '../lib/format.js';
import { intentLabel } from '../lib/intent.js';
import { selectDashboardPlans } from '../lib/mandates.js';

const IMPORTANT_EVENTS = new Set<AuditEvent['eventType']>([
  'MANDATE_ACTIVATED',
  'MANDATE_REVISED',
  'MANDATE_REVOKED',
  'AGENT_SIGNATURE_REJECTED',
  'REPLAY_REJECTED',
  'POLICY_EVALUATED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'PAYMENT_PENDING',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'USAGE_RESERVED',
  'USAGE_CONSUMED',
  'USAGE_RELEASED',
]);

/**
 * Updates works like Orders: the plans are the list, one is selected (the live one by default),
 * and everything below follows what the agent did for that plan only.
 */
export function ActivityPage() {
  const me = useMe();
  const mandates = useMandates();
  const executions = useExecutions(undefined, 100);
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const plans = mandates.data ?? [];
  const { livePlan, completedPlan } = selectDashboardPlans(plans);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selected =
    plans.find((plan) => plan.id === chosenId) ?? livePlan ?? completedPlan ?? plans[0];
  const events = useAuditEvents({
    limit: 400,
    ...(selected ? { mandateId: selected.id } : {}),
    enabled: Boolean(selected),
  });
  const importantEvents = (events.data ?? []).filter(
    (event) => IMPORTANT_EVENTS.has(event.eventType) && event.mandateId === selected?.id,
  );
  const latestExecution = newestExecutionForPlan(executions.data, selected);
  const brief = agentBrief(agentName, selected, latestExecution);
  const BriefIcon = brief.icon;
  const isError = mandates.isError || executions.isError || events.isError;

  const live = plans.filter((plan) => plan.status === 'ACTIVE' && plan.usage.remainingCount > 0);
  const finished = plans.filter(
    (plan) => plan.status === 'ACTIVE' && plan.usage.remainingCount === 0,
  );
  const stopped = plans.filter((plan) => plan.status !== 'ACTIVE');

  return (
    <section className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-line sm:shadow-sm">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Updates</h1>
          <p className="text-[12px] text-ink-muted">
            Pick a plan to follow what {agentName} does for it.
          </p>
        </div>
        {live.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald motion-reduce:animate-none"
              aria-hidden
            />
            {live.length} live
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ground p-4 sm:p-5">
        {isError ? (
          <ErrorState
            error={mandates.error ?? executions.error ?? events.error}
            retry={() => {
              void mandates.refetch();
              void executions.refetch();
              void events.refetch();
            }}
          />
        ) : null}

        {!isError && mandates.isPending ? <Skeleton className="h-40 rounded-xl" /> : null}

        {!isError && !mandates.isPending && plans.length === 0 ? (
          <EmptyState
            title="No plans yet"
            action={
              <Link to="/dashboard" className={buttonStyles()}>
                Start a trip
              </Link>
            }
          >
            Once you authorize a plan in the chat, {agentName}&rsquo;s searches, decisions and
            orders for it appear here.
          </EmptyState>
        ) : null}

        {!isError && plans.length > 0 ? (
          <>
            {live.length > 0 ? (
              <PlanGroup
                title="Live plans"
                description={`${agentName} is watching these right now.`}
              >
                {live.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selected={plan.id === selected?.id}
                    latestExecution={newestExecutionForPlan(executions.data, plan)}
                    onSelect={() => setChosenId(plan.id)}
                  />
                ))}
              </PlanGroup>
            ) : null}
            {finished.length > 0 ? (
              <PlanGroup title="Completed" description="Every permitted purchase was made.">
                {finished.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selected={plan.id === selected?.id}
                    latestExecution={newestExecutionForPlan(executions.data, plan)}
                    onSelect={() => setChosenId(plan.id)}
                  />
                ))}
              </PlanGroup>
            ) : null}
            {stopped.length > 0 ? (
              <PlanGroup title="Stopped or expired" description="No longer authorizing anything.">
                {stopped.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    selected={plan.id === selected?.id}
                    latestExecution={newestExecutionForPlan(executions.data, plan)}
                    onSelect={() => setChosenId(plan.id)}
                  />
                ))}
              </PlanGroup>
            ) : null}

            {selected ? (
              <section className="mt-1" aria-labelledby="plan-updates-title" aria-live="polite">
                <div className="mb-2 px-0.5">
                  <h2 id="plan-updates-title" className="text-[13.5px] font-semibold text-ink">
                    What {agentName} is doing for {intentLabel(selected.policy.intent)}
                  </h2>
                  <p className="text-[11.5px] text-ink-muted">
                    Only decisions that affect this plan, newest first.
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-surface p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${brief.iconClass}`}
                    >
                      <BriefIcon className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[15px] font-semibold text-ink">{brief.title}</p>
                        {brief.live ? (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden />{' '}
                            Live
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                        {brief.description}
                      </p>
                      {brief.detail ? (
                        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[12.5px] text-ink">
                          {brief.detail}
                        </p>
                      ) : null}
                      {brief.action ? (
                        <Link
                          to={brief.action.to}
                          className={buttonStyles({ size: 'sm', className: 'mt-3' })}
                        >
                          {brief.action.label}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-4 border-t border-line pt-1">
                    {events.isPending ? <Skeleton className="my-4 h-32" /> : null}
                    {!events.isPending && importantEvents.length === 0 ? (
                      <p className="py-4 text-[13px] text-ink-muted">
                        Nothing has happened for this plan yet. Searches run in the background;
                        decisions appear here the moment {agentName} requests a purchase.
                      </p>
                    ) : null}
                    {!events.isPending && importantEvents.length > 0 ? (
                      <Timeline
                        events={importantEvents}
                        limit={20}
                        showLinks={false}
                        plainLanguage
                      />
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-3 text-[12px] text-ink-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald" aria-hidden />
          <p>Authera checks your rules and authorization before any payment can continue.</p>
        </div>
      </div>
    </section>
  );
}

function PlanGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const titleId = `plans-${title.replaceAll(' ', '-').toLowerCase()}`;
  return (
    <section className="mb-5" aria-labelledby={titleId}>
      <div className="mb-2 px-0.5">
        <h2 id={titleId} className="text-[13.5px] font-semibold text-ink">
          {title}
        </h2>
        <p className="text-[11.5px] text-ink-muted">{description}</p>
      </div>
      <div className="space-y-2" role="list">
        {children}
      </div>
    </section>
  );
}

function PlanCard({
  plan,
  selected,
  latestExecution,
  onSelect,
}: {
  plan: MandateView;
  selected: boolean;
  latestExecution: ExecutionSummary | undefined;
  onSelect: () => void;
}) {
  const live = plan.status === 'ACTIVE' && plan.usage.remainingCount > 0;
  const limit = formatMoney({
    currency: plan.policy.limits.currency,
    minor: plan.policy.limits.maxPerPurchaseMinor,
  });
  const lastStep = latestExecution
    ? `${latestExecution.offerSummary ?? 'Offer'} · ${formatMoney(latestExecution.amount)} · ${stepLabel(latestExecution)}`
    : live
      ? 'Watching live offers · no purchase requested yet'
      : 'No agent activity';
  return (
    <div role="listitem">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          'w-full rounded-xl border bg-surface p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/30',
          selected
            ? 'border-cobalt shadow-sm shadow-cobalt/10'
            : 'border-line hover:border-line-strong',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              live ? 'bg-emerald-soft text-emerald' : 'bg-surface-muted text-ink-muted',
            )}
          >
            {live ? (
              <Radar className="h-4 w-4" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="min-w-0">
                <h3 className="truncate text-[13.5px] font-semibold text-ink">
                  {intentLabel(plan.policy.intent)}
                </h3>
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  up to {limit} · {plan.usage.remainingCount} of{' '}
                  {plan.policy.limits.maxFulfillments} purchase
                  {plan.policy.limits.maxFulfillments === 1 ? '' : 's'} left · until{' '}
                  {formatDate(plan.policy.validUntil)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {live ? (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-emerald">
                    <span
                      className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald motion-reduce:animate-none"
                      aria-hidden
                    />
                    Live
                  </span>
                ) : null}
                <MandateStatusBadge status={plan.status} />
              </div>
            </div>
            <p className="mt-2 truncate text-[12.5px] text-ink-muted">{lastStep}</p>
          </div>
        </div>
      </button>
    </div>
  );
}

function stepLabel(execution: ExecutionSummary): string {
  switch (execution.state) {
    case 'SUCCEEDED':
      return 'paid';
    case 'PAYMENT_PENDING':
    case 'RESERVED':
      return 'processing';
    case 'FAILED':
      return 'payment failed';
    default:
      return execution.decision === 'REQUIRE_HUMAN' ? 'waiting for you' : 'blocked';
  }
}

function newestExecutionForPlan(
  executions: ExecutionSummary[] | undefined,
  plan: MandateView | undefined,
): ExecutionSummary | undefined {
  if (!plan) return undefined;
  return executions
    ?.filter((execution) => execution.mandateId === plan.id)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}

function agentBrief(
  agentName: string,
  plan: MandateView | undefined,
  latestExecution: ExecutionSummary | undefined,
) {
  if (latestExecution?.state === 'PAYMENT_PENDING' || latestExecution?.state === 'RESERVED') {
    return {
      title: 'Your order is being processed',
      description: `${agentName} found an eligible offer. Authera approved it and is waiting for the provider to finish.`,
      detail: `${latestExecution.offerSummary ?? 'Selected offer'} · ${formatMoney(latestExecution.amount)}`,
      live: true,
      icon: Clock3,
      iconClass: 'bg-cobalt-soft text-cobalt',
      action: { to: '/dashboard/purchases', label: 'See order' },
    };
  }

  if (latestExecution?.decision === 'REQUIRE_HUMAN') {
    return {
      title: `${agentName} needs your decision`,
      description:
        'An offer fell outside automatic approval, so nothing will be charged until you review it.',
      detail: `${latestExecution.offerSummary ?? 'Selected offer'} · ${formatMoney(latestExecution.amount)}`,
      live: true,
      icon: Clock3,
      iconClass: 'bg-amber-soft text-amber',
      action: { to: '/dashboard/chats', label: 'Open chats' },
    };
  }

  if (plan && plan.status === 'ACTIVE' && plan.usage.remainingCount > 0) {
    return {
      title: `${agentName} is watching for a match`,
      description:
        'Verified providers are being checked. A purchase can continue only when every rule matches.',
      detail: `${intentLabel(plan.policy.intent)} · up to ${formatMoney({ currency: plan.policy.limits.currency, minor: plan.policy.limits.maxPerPurchaseMinor })}`,
      live: true,
      icon: Radar,
      iconClass: 'bg-emerald-soft text-emerald',
      action: null,
    };
  }

  if (plan && plan.status === 'ACTIVE') {
    return {
      title: 'The trip plan is complete',
      description: `${agentName} finished the purchase within your rules. Your documents are ready in Orders.`,
      detail: intentLabel(plan.policy.intent),
      live: false,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-soft text-emerald',
      action: { to: '/dashboard/purchases', label: 'See orders' },
    };
  }

  if (plan) {
    return {
      title: 'This plan is no longer active',
      description: `${agentName} can no longer buy anything under it. Every later attempt fails.`,
      detail: intentLabel(plan.policy.intent),
      live: false,
      icon: CheckCircle2,
      iconClass: 'bg-surface-muted text-ink-muted',
      action: { to: '/dashboard', label: 'Start a new trip' },
    };
  }

  return {
    title: `${agentName} is ready`,
    description:
      'Describe the trip you want. You will review the price limit and rules before the agent can act.',
    detail: null,
    live: false,
    icon: Bot,
    iconClass: 'bg-cobalt-soft text-cobalt',
    action: { to: '/dashboard', label: 'Start a trip' },
  };
}
