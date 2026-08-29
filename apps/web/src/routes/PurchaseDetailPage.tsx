import { Check, Plane, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { usePurchase } from '../api/hooks.js';
import { Checklist, DecisionBadge, Timeline } from '../components/status.js';
import {
  Alert,
  Button,
  Card,
  ErrorState,
  KeyValue,
  Mono,
  PageHeader,
  Skeleton,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortId } from '../lib/format.js';

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

  return (
    <>
      <PageHeader
        title={
          succeeded
            ? 'Flight purchased'
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
          />
        }
        description={execution.explanation ?? undefined}
        actions={
          <>
            <Link to={`/auditor?executionId=${execution.id}`}>
              <Button variant="secondary">Inspect decision record</Button>
            </Link>
            <Link to={`/disputes/new?executionId=${execution.id}`}>
              <Button variant="ghost">Report a problem</Button>
            </Link>
          </>
        }
      />
      {execution.state === 'FAILED' ? (
        <div className="mb-4">
          <Alert tone="destructive" title="No money moved">
            {execution.payment?.failureReason ?? 'The processor declined the payment'}; the mandate
            allowance was released.
          </Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col gap-4">
          <section className="rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-dashed border-line-strong px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-cobalt-soft text-cobalt">
                  <Plane className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <p className="text-[15px] font-semibold">
                    {offer ? `${offer.airline} ${offer.flightNumber}` : 'Flight'}
                  </p>
                  <p className="text-[12.5px] text-ink-muted">
                    Merchant: VuelaYa · Passenger: Marta Ledezma
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="tabular text-[22px] font-semibold text-ink">{formatMoney(paid)}</p>
                {max ? (
                  <p className="text-[12px] text-ink-muted">
                    authorized up to {formatMoney(max)}
                    {savings && savings.minor > 0 ? ` · saved ${formatMoney(savings)}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4 px-5 py-4">
              <Segment label="From" value={offer?.origin ?? '—'} />
              <Segment label="To" value={offer?.destination ?? '—'} />
              <Segment
                label="Departs"
                value={offer ? offer.departureAt.slice(0, 16).replace('T', ' ') : '—'}
              />
              <Segment label="Cabin" value={offer?.cabin ?? '—'} />
            </div>
            <div className="border-t border-line px-5 py-3">
              <KeyValue
                dense
                items={[
                  {
                    label: 'Payment',
                    value: `${mandate?.paymentMethodLabel ?? '—'} · ${execution.payment?.state ?? 'no payment'}`,
                  },
                  {
                    label: 'Provider reference',
                    value: execution.payment?.providerPaymentId ?? '—',
                    mono: true,
                  },
                  { label: 'Authorized at', value: formatDateTime(execution.createdAt) },
                  {
                    label: 'Decision',
                    value:
                      execution.reasonCode === 'ALLOW_CHECKOUT_APPROVAL'
                        ? 'Approved by you for this exact checkout'
                        : 'Automatically approved — matched every condition in your mandate',
                  },
                ]}
              />
            </div>
          </section>
          <Card title="Mandate used">
            {mandate ? (
              <>
                <p className="text-[13.5px]">{mandate.summary}</p>
                <KeyValue
                  className="mt-3"
                  dense
                  items={[
                    {
                      label: 'Mandate',
                      value: (
                        <Link
                          className="text-cobalt hover:underline"
                          to={`/mandates/${mandate.id}`}
                        >
                          {shortId(mandate.id, 18)}
                        </Link>
                      ),
                    },
                    { label: 'Version', value: `v${mandate.version} · ${mandate.status}` },
                    { label: 'Agent', value: mandate.agentDisplayName },
                  ]}
                />
              </>
            ) : (
              <p className="text-[13px] text-ink-muted">Mandate not available.</p>
            )}
          </Card>
          <Card
            title="Technical evidence"
            description="Collapsed by default — the receipt above is the human-readable record"
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
        <aside className="col-span-4">
          <Card title="Verification" className="sticky top-5">
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
            <p className="mt-3 text-[11.5px] text-ink-faint">
              Evidence id <Mono>{execution.evidenceId}</Mono>
            </p>
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
