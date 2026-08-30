import type {
  ChatSessionSummary,
  DisputeView,
  ExecutionSummary,
  MandateView,
} from '@authera/contracts';
import {
  Ban,
  Download,
  FileSearch,
  MessageSquare,
  Radar,
  ReceiptText,
  ShieldAlert,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useChats, useDisputes, useMandates, usePurchases } from '../api/hooks.js';
import { cn } from '../lib/cn.js';
import { intentLabel } from '../lib/intent.js';
import { DecisionBadge } from '../components/status.js';
import { EmptyState, ErrorState, Skeleton, buttonStyles } from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, formatPaymentState } from '../lib/format.js';

export function PurchasesPage() {
  const purchases = usePurchases();
  const chats = useChats();
  const disputes = useDisputes();
  const mandates = useMandates();
  const current = purchases.data?.filter((purchase) => purchase.state === 'PAYMENT_PENDING') ?? [];
  const completed = purchases.data?.filter((purchase) => purchase.state === 'SUCCEEDED') ?? [];
  const waiting = purchases.data?.filter((purchase) => purchase.state === 'REQUIRES_HUMAN') ?? [];
  const unsuccessful = purchases.data?.filter((purchase) => purchase.state === 'FAILED') ?? [];
  // Plans Aria is still shopping for: live, purchases left, nothing completed under them yet.
  const finding = (mandates.data ?? []).filter(
    (plan) =>
      plan.status === 'ACTIVE' &&
      plan.usage.remainingCount > 0 &&
      !completed.some((purchase) => purchase.mandateId === plan.id),
  );
  const stopped = (mandates.data ?? []).filter(
    (plan) => plan.status === 'REVOKED' || plan.status === 'EXPIRED',
  );
  const hasOrders = Boolean(purchases.data?.length) || finding.length > 0 || stopped.length > 0;

  return (
    <section className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-line sm:shadow-sm">
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold text-ink">Orders</h1>
          <p className="text-[12px] text-ink-muted">
            Current orders, completed bookings, and receipts.
          </p>
        </div>
        {current.length > 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-cobalt">
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt motion-reduce:animate-none"
              aria-hidden
            />
            {current.length} processing
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ground p-4 sm:p-5">
        {purchases.isError ? (
          <ErrorState error={purchases.error} retry={() => void purchases.refetch()} />
        ) : null}
        {purchases.isPending ? <OrdersSkeleton /> : null}
        {!purchases.isPending && !purchases.isError && !hasOrders ? (
          <EmptyState
            title="No orders yet"
            action={
              <Link to="/" className={buttonStyles()}>
                Start a trip
              </Link>
            }
          >
            When the agent completes or starts processing a purchase, it will appear here.
          </EmptyState>
        ) : null}

        {finding.length > 0 ? (
          <OrderGroup
            title="Finding a flight"
            description="Aria is watching live fares for these plans; nothing is bought until a fare fits the rules."
            tone="pending"
          >
            {finding.map((plan) => (
              <PlanOrderCard
                key={plan.id}
                plan={plan}
                latest={purchases.data?.find((purchase) => purchase.mandateId === plan.id)}
                tone="pending"
              />
            ))}
          </OrderGroup>
        ) : null}
        {waiting.length > 0 ? (
          <OrderGroup
            title="Waiting for you"
            description="An offer fell outside the rules; Aria stopped until you decide."
            tone="pending"
          >
            {waiting.map((purchase) => (
              <OrderCard
                key={purchase.id}
                purchase={purchase}
                chat={chatFor(purchase, chats.data)}
                dispute={disputes.data?.find((d) => d.executionId === purchase.id)}
                tone="pending"
              />
            ))}
          </OrderGroup>
        ) : null}
        {current.length > 0 ? (
          <OrderGroup
            title="In progress"
            description="The provider is still finishing these orders."
          >
            {current.map((purchase) => (
              <OrderCard
                key={purchase.id}
                purchase={purchase}
                chat={chatFor(purchase, chats.data)}
                dispute={disputes.data?.find((d) => d.executionId === purchase.id)}
              />
            ))}
          </OrderGroup>
        ) : null}

        {completed.length > 0 ? (
          <OrderGroup title="Completed" description="Confirmed purchases and their documents.">
            {completed.map((purchase) => (
              <OrderCard
                key={purchase.id}
                purchase={purchase}
                chat={chatFor(purchase, chats.data)}
                dispute={disputes.data?.find((d) => d.executionId === purchase.id)}
              />
            ))}
          </OrderGroup>
        ) : null}

        {unsuccessful.length > 0 ? (
          <OrderGroup
            title="Didn’t complete"
            description="No completed payment was recorded."
            tone="failed"
          >
            {unsuccessful.map((purchase) => (
              <OrderCard
                key={purchase.id}
                purchase={purchase}
                chat={chatFor(purchase, chats.data)}
                dispute={disputes.data?.find((d) => d.executionId === purchase.id)}
              />
            ))}
          </OrderGroup>
        ) : null}
        {stopped.length > 0 ? (
          <OrderGroup
            title="Stopped plans"
            description="Revoked or expired: merchants reject any purchase attempt under them."
            tone="failed"
          >
            {stopped.map((plan) => (
              <PlanOrderCard
                key={plan.id}
                plan={plan}
                latest={purchases.data?.find((purchase) => purchase.mandateId === plan.id)}
                tone="failed"
              />
            ))}
          </OrderGroup>
        ) : null}
      </div>
    </section>
  );
}

type OrderTone = 'pending' | 'failed' | 'done' | 'neutral';
const TONE_BORDER: Record<OrderTone, string> = {
  pending: 'border-l-4 border-l-amber-400',
  failed: 'border-l-4 border-l-red-400',
  done: 'border-l-4 border-l-emerald',
  neutral: '',
};

function OrderGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
  tone?: OrderTone;
}) {
  const titleId = `orders-${title.replaceAll(' ', '-').toLowerCase()}`;
  return (
    <section className="mb-5 last:mb-0" aria-labelledby={titleId}>
      <div className="mb-2 px-0.5">
        <h2 id={titleId} className="text-[13.5px] font-semibold text-ink">
          {title}
        </h2>
        <p className="text-[11.5px] text-ink-muted">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function OrderCard({
  purchase,
  chat,
  dispute,
  tone,
}: {
  purchase: ExecutionSummary;
  chat?: ChatSessionSummary;
  dispute?: DisputeView | undefined;
  tone?: OrderTone;
}) {
  const succeeded = purchase.state === 'SUCCEEDED';
  const cardTone: OrderTone =
    tone ?? (succeeded ? 'done' : purchase.state === 'FAILED' ? 'failed' : 'neutral');
  return (
    <article className={cn('rounded-xl border border-line bg-surface p-4', TONE_BORDER[cardTone])}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-soft text-cobalt">
          <ReceiptText className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h3 className="truncate text-[13.5px] font-semibold text-ink">
                {purchase.offerSummary ?? 'Travel order'}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {formatDateTime(purchase.updatedAt)}
              </p>
            </div>
            <p className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">
              {formatMoney(purchase.amount)}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <DecisionBadge decision={purchase.decision} state={purchase.state} plainLanguage />
            <span className="text-[12px] text-ink-muted">
              {formatPaymentState(purchase.paymentState)}
              {purchase.bookingState === 'BOOKED' ? ' · Booking confirmed' : ''}
            </span>
          </div>
          {purchase.explanation && !succeeded ? (
            <p className="mt-2 text-[12.5px] leading-5 text-ink-muted">{purchase.explanation}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {succeeded ? (
          <a
            href={`/api/purchases/${purchase.id}/stripe-receipt.html`}
            download
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            <Download className="h-4 w-4" aria-hidden /> Card receipt
          </a>
        ) : null}
        {succeeded ? (
          <a
            href={`/api/purchases/${purchase.id}/processor-receipt`}
            target="_blank"
            rel="noreferrer"
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden /> Stripe receipt
          </a>
        ) : null}
        {succeeded && purchase.bookingState === 'BOOKED' ? (
          <a
            href={`/api/purchases/${purchase.id}/booking-confirmation.html`}
            download
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            <Download className="h-4 w-4" aria-hidden /> Booking
          </a>
        ) : null}
        {succeeded ? (
          <Link
            to={`/purchases/${purchase.id}`}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <FileSearch className="h-4 w-4" aria-hidden /> Details &amp; verification
          </Link>
        ) : null}
        {succeeded && !dispute ? (
          <Link
            to={`/disputes/new?executionId=${purchase.id}`}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden /> Report a problem
          </Link>
        ) : null}
        {dispute ? (
          <Link
            to={`/disputes/${dispute.id}`}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <ShieldAlert className="h-4 w-4" aria-hidden /> Dispute:{' '}
            {dispute.resolution
              ? dispute.resolution.outcome.toLowerCase().replaceAll('_', ' ')
              : dispute.state.toLowerCase()}
          </Link>
        ) : null}
        {chat && !succeeded ? (
          <Link to={`/chats/${chat.id}`} className={buttonStyles({ variant: 'ghost', size: 'sm' })}>
            <MessageSquare className="h-4 w-4" aria-hidden /> Open chat
          </Link>
        ) : null}
      </div>
    </article>
  );
}

/** A plan on the Orders page: what Aria is shopping for (yellow) or a plan that was stopped (red). */
function PlanOrderCard({
  plan,
  latest,
  tone,
}: {
  plan: MandateView;
  latest: ExecutionSummary | undefined;
  tone: OrderTone;
}) {
  const stopped = tone === 'failed';
  const limit = formatMoney({
    currency: plan.policy.limits.currency,
    minor: plan.policy.limits.maxPerPurchaseMinor,
  });
  const status = stopped
    ? plan.status === 'EXPIRED'
      ? 'Expired'
      : 'Revoked'
    : latest?.state === 'REQUIRES_HUMAN'
      ? 'Waiting for your decision'
      : 'Searching live fares';
  return (
    <article className={cn('rounded-xl border border-line bg-surface p-4', TONE_BORDER[tone])}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            stopped ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600',
          )}
        >
          {stopped ? (
            <Ban className="h-4 w-4" aria-hidden />
          ) : (
            <Radar className="h-4 w-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h3 className="truncate text-[13.5px] font-semibold text-ink">
                {intentLabel(plan.policy.intent)}
              </h3>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                up to {limit} · {plan.usage.remainingCount} of {plan.policy.limits.maxFulfillments}{' '}
                purchase
                {plan.policy.limits.maxFulfillments === 1 ? '' : 's'} left
              </p>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium',
                stopped ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
              )}
            >
              {!stopped ? (
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none"
                  aria-hidden
                />
              ) : null}
              {status}
            </span>
          </div>
          {latest ? (
            <p className="mt-2 truncate text-[12px] text-ink-muted">
              Last: {latest.offerSummary ?? 'offer'} · {formatMoney(latest.amount)}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <Link to="/activity" className={buttonStyles({ variant: 'secondary', size: 'sm' })}>
              <FileSearch className="h-4 w-4" aria-hidden /> Follow on Updates
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function chatFor(
  purchase: ExecutionSummary,
  chats: ChatSessionSummary[] | undefined,
): ChatSessionSummary | undefined {
  return chats?.find((chat) => chat.mandateId === purchase.mandateId);
}

function OrdersSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading orders">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}
