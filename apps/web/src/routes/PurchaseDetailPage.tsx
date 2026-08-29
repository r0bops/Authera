import { Check, Package, Plane, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { usePurchase } from '../api/hooks.js';
import { Checklist, DecisionBadge, Timeline } from '../components/status.js';
import {
  Alert,
  Card,
  ErrorState,
  KeyValue,
  Mono,
  PageHeader,
  Skeleton,
  buttonStyles,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, friendlyAgentName } from '../lib/format.js';
import { offerHeadline } from '../lib/intent.js';

export function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const purchase = usePurchase(id);
  if (purchase.isError)
    return <ErrorState error={purchase.error} retry={() => void purchase.refetch()} />;
  if (purchase.isPending || !purchase.data) return <Skeleton className="h-64" />;
  const { execution, offer, mandate, verification } = purchase.data;
  const paid = execution.amount;
  const max = mandate?.maxPerPurchase;
  const savings =
    paid && max && max.minor >= paid.minor
      ? { currency: paid.currency, minor: max.minor - paid.minor }
      : null;
  const succeeded = execution.state === 'SUCCEEDED';
  const OfferIcon = offer?.kind === 'goods' ? Package : Plane;

  return (
    <>
      <PageHeader
        title={
          succeeded
            ? offer?.kind === 'goods'
              ? 'Purchase complete'
              : 'Flight purchased'
            : execution.state === 'PAYMENT_PENDING'
              ? 'Payment pending'
              : execution.state === 'FAILED'
                ? 'Payment failed'
                : 'Purchase record'
        }
        meta={
          <DecisionBadge
            decision={execution.decision}
            state={execution.state}
            reasonCode={execution.reasonCode}
            showReasonCode={false}
          />
        }
        description={execution.explanation ?? undefined}
        actions={
          <Link
            to={`/dashboard/disputes/new?executionId=${execution.id}`}
            className={buttonStyles({ variant: 'secondary' })}
          >
            Report a problem
          </Link>
        }
      />
      {execution.state === 'FAILED' ? (
        <div className="mb-4">
          <Alert tone="destructive" title="No money moved">
            {execution.payment?.failureReason ?? 'The processor declined the payment'}; your plan’s
            allowance was restored.
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <section className="rounded-md border border-line bg-surface">
            <div className="flex flex-col gap-4 border-b border-dashed border-line-strong px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-cobalt-soft text-cobalt">
                  <OfferIcon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <p className="text-[15px] font-semibold">
                    {offer ? offerHeadline(offer) : 'Purchase'}
                  </p>
                  <p className="text-[12.5px] text-ink-muted">
                    Purchased from {offer?.merchantName ?? '—'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="tabular whitespace-nowrap text-[22px] font-semibold text-ink">
                  {formatMoney(paid)}
                </p>
                {max ? (
                  <p className="text-[12px] text-ink-muted">
                    authorized up to {formatMoney(max)}
                    {savings && savings.minor > 0 ? ` · saved ${formatMoney(savings)}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 px-4 py-4 sm:grid-cols-4 sm:px-5">
              {offer?.kind === 'goods' ? (
                <>
                  <Segment label="Quantity" value={String(offer.quantity)} />
                  <Segment label="Category" value="Product" />
                  <Segment label="Search" value={offer.searchQuery ?? '—'} />
                  <Segment label="Purchased" value={formatDateTime(execution.createdAt)} />
                </>
              ) : (
                <>
                  <Segment label="From" value={offer?.origin ?? '—'} />
                  <Segment label="To" value={offer?.destination ?? '—'} />
                  <Segment
                    label="Departs"
                    value={
                      offer?.departureAt ? offer.departureAt.slice(0, 16).replace('T', ' ') : '—'
                    }
                  />
                  <Segment label="Cabin" value={offer?.cabin ?? '—'} />
                </>
              )}
            </div>
            <div className="border-t border-line px-5 py-3">
              <KeyValue
                dense
                items={[
                  {
                    label: 'Payment',
                    value: `${mandate?.paymentMethodLabel ?? '—'} · ${execution.payment?.state ?? 'no payment'}`,
                  },
                  { label: 'Purchased at', value: formatDateTime(execution.createdAt) },
                  {
                    label: 'Decision',
                    value:
                      execution.reasonCode === 'ALLOW_CHECKOUT_APPROVAL'
                        ? 'Approved by you for this exact checkout'
                        : 'Automatically approved — matched every condition in your plan',
                  },
                ]}
              />
            </div>
          </section>
          <Card title="Plan used">
            {mandate ? (
              <>
                <p className="text-[13.5px]">{mandate.summary}</p>
                <KeyValue
                  className="mt-3"
                  dense
                  items={[
                    {
                      label: 'Plan',
                      value: (
                        <Link
                          className="text-cobalt hover:underline"
                          to={`/dashboard/mandates/${mandate.id}`}
                        >
                          Open purchase plan
                        </Link>
                      ),
                    },
                    { label: 'Version', value: `v${mandate.version} · ${mandate.status}` },
                    { label: 'Agent', value: friendlyAgentName(mandate.agentDisplayName) },
                  ]}
                />
              </>
            ) : (
              <p className="text-[13px] text-ink-muted">Purchase plan not available.</p>
            )}
          </Card>
          <Card
            title="Proof & details"
            description="The receipt above is the readable record. Technical evidence stays available here."
          >
            <details>
              <summary className="text-[12.5px] font-medium text-cobalt">
                Policy checklist ({execution.checklist.length} checks)
              </summary>
              <div className="mt-2">
                <Checklist checks={execution.checklist} />
              </div>
            </details>
            <details className="mt-2">
              <summary className="text-[12.5px] font-medium text-cobalt">Identifiers</summary>
              <KeyValue
                className="mt-2"
                dense
                items={[
                  { label: 'Execution', value: execution.id, mono: true },
                  { label: 'Evidence id', value: execution.evidenceId, mono: true },
                  { label: 'Checkout', value: execution.checkoutId ?? '—', mono: true },
                  { label: 'Reservation', value: execution.reservationState ?? '—' },
                  {
                    label: 'Provider reference',
                    value: execution.payment?.providerPaymentId ?? '—',
                    mono: true,
                  },
                ]}
              />
            </details>
            <details className="mt-2">
              <summary className="text-[12.5px] font-medium text-cobalt">Event timeline</summary>
              <div className="mt-2">
                <Timeline events={execution.timeline} />
              </div>
            </details>
          </Card>
        </div>
        <aside className="lg:col-span-4">
          <Card title="Why Authera allowed it" className="lg:sticky lg:top-5">
            <ul className="divide-y divide-line">
              {verification.map((v) => (
                <li key={v.label} className="flex items-start gap-2 py-2 text-[13px]">
                  {v.ok ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald" aria-hidden />
                  ) : (
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-coral" aria-hidden />
                  )}
                  <div>
                    <p className={v.ok ? 'text-ink' : 'text-coral'}>{v.label}</p>
                    {v.detail ? <p className="text-[11.5px] text-ink-faint">{v.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
            <details className="mt-3 border-t border-line pt-3 text-[11.5px]">
              <summary className="min-h-10 font-medium text-cobalt">Show evidence id</summary>
              <Mono className="mt-1 block break-all">{execution.evidenceId}</Mono>
            </details>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Segment({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className="text-[15px] font-semibold text-ink">{value}</p>
    </div>
  );
}
