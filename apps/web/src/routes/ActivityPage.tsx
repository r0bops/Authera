import type { AuditEvent, ExecutionSummary, MandateView } from '@authera/contracts';
import { Bot, CheckCircle2, Clock3, Radar, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useAuditEvents, useExecutions, useMandates, useMe } from '../api/hooks.js';
import { Timeline } from '../components/status.js';
import { EmptyState, ErrorState, Skeleton, buttonStyles } from '../components/ui/primitives.js';
import { formatMoney, friendlyAgentName } from '../lib/format.js';
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
  'BOOKING_PENDING',
  'BOOKING_CONFIRMED',
  'BOOKING_FAILED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
]);

export function ActivityPage() {
  const me = useMe();
  const mandates = useMandates();
  const executions = useExecutions(undefined, 100);
  const events = useAuditEvents({ limit: 400 });
  const { livePlan, completedPlan } = selectDashboardPlans(mandates.data);
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const latestExecution = newestExecutionForPlan(executions.data, livePlan ?? completedPlan);
  const brief = agentBrief(agentName, livePlan, completedPlan, latestExecution);
  const BriefIcon = brief.icon;
  const importantEvents = (events.data ?? []).filter((event) =>
    IMPORTANT_EVENTS.has(event.eventType),
  );
  const isError = mandates.isError || executions.isError || events.isError;

  return (
    <section className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-line sm:shadow-sm">
      <header className="flex min-h-16 shrink-0 items-center border-b border-line px-4 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Updates</h1>
          <p className="text-[12px] text-ink-muted">A simple view of what {agentName} is doing.</p>
        </div>
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

        {!isError ? (
          mandates.isPending || executions.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <section
              className="rounded-xl border border-line bg-surface p-4 sm:p-5"
              aria-live="polite"
            >
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
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden /> Live
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-ink-muted">{brief.description}</p>
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
            </section>
          )
        ) : null}

        {!isError ? (
          <section className="mt-5" aria-labelledby="recent-updates-title">
            <div className="mb-2 flex items-end justify-between gap-3 px-0.5">
              <div>
                <h2 id="recent-updates-title" className="text-[13.5px] font-semibold text-ink">
                  Recent updates
                </h2>
                <p className="text-[11.5px] text-ink-muted">
                  Only decisions that affect your trip.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface px-4 py-1 sm:px-5">
              {events.isPending ? <Skeleton className="my-4 h-32" /> : null}
              {!events.isPending && importantEvents.length === 0 ? (
                <div className="py-4">
                  <EmptyState
                    title="No updates yet"
                    action={
                      <Link to="/dashboard" className={buttonStyles()}>
                        Start a trip
                      </Link>
                    }
                  >
                    Once a plan starts, searches, decisions, and orders will appear here.
                  </EmptyState>
                </div>
              ) : null}
              {!events.isPending && importantEvents.length > 0 ? (
                <Timeline events={importantEvents} limit={12} showLinks={false} plainLanguage />
              ) : null}
            </div>
          </section>
        ) : null}

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface px-3 py-3 text-[12px] text-ink-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald" aria-hidden />
          <p>Authera checks your rules and authorization before any payment can continue.</p>
        </div>
      </div>
    </section>
  );
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
  livePlan: MandateView | undefined,
  completedPlan: MandateView | undefined,
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

  if (livePlan) {
    return {
      title: `${agentName} is watching for a match`,
      description:
        'Verified providers are being checked. A purchase can continue only when every rule matches.',
      detail: `${intentLabel(livePlan.policy.intent)} · up to ${formatMoney({ currency: livePlan.policy.limits.currency, minor: livePlan.policy.limits.maxPerPurchaseMinor })}`,
      live: true,
      icon: Radar,
      iconClass: 'bg-emerald-soft text-emerald',
      action: null,
    };
  }

  if (completedPlan) {
    return {
      title: 'The trip plan is complete',
      description: `${agentName} finished the purchase within your rules. Your documents are ready in Orders.`,
      detail: intentLabel(completedPlan.policy.intent),
      live: false,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-soft text-emerald',
      action: { to: '/dashboard/purchases', label: 'See orders' },
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
