import type { ChatSessionSummary, ExecutionSummary } from '@authera/contracts';
import { Download, MessageSquare, ReceiptText } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useChats, usePurchases } from '../api/hooks.js';
import { DecisionBadge } from '../components/status.js';
import { EmptyState, ErrorState, Skeleton, buttonStyles } from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, formatPaymentState } from '../lib/format.js';

export function PurchasesPage() {
  const purchases = usePurchases();
  const chats = useChats();
  const current = purchases.data?.filter((purchase) => purchase.state === 'PAYMENT_PENDING') ?? [];
  const completed = purchases.data?.filter((purchase) => purchase.state === 'SUCCEEDED') ?? [];
  const unsuccessful = purchases.data?.filter((purchase) => purchase.state === 'FAILED') ?? [];
  const hasOrders = Boolean(purchases.data?.length);

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
              <Link to="/dashboard" className={buttonStyles()}>
                Start a trip
              </Link>
            }
          >
            When the agent completes or starts processing a purchase, it will appear here.
          </EmptyState>
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
              />
            ))}
          </OrderGroup>
        ) : null}

        {unsuccessful.length > 0 ? (
          <OrderGroup title="Didn’t complete" description="No completed payment was recorded.">
            {unsuccessful.map((purchase) => (
              <OrderCard
                key={purchase.id}
                purchase={purchase}
                chat={chatFor(purchase, chats.data)}
              />
            ))}
          </OrderGroup>
        ) : null}
      </div>
    </section>
  );
}

function OrderGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
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

function OrderCard({ purchase, chat }: { purchase: ExecutionSummary; chat?: ChatSessionSummary }) {
  const succeeded = purchase.state === 'SUCCEEDED';
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
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
            href={`/api/purchases/${purchase.id}/receipt.html`}
            download
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            <Download className="h-4 w-4" aria-hidden /> Receipt
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
        {chat ? (
          <Link
            to={`/dashboard/chats/${chat.id}`}
            className={buttonStyles({ variant: 'ghost', size: 'sm' })}
          >
            <MessageSquare className="h-4 w-4" aria-hidden /> Open chat
          </Link>
        ) : null}
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
