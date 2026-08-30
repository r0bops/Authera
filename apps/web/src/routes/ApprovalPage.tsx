import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApproval, useDecideApproval } from '../api/hooks.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  KeyValue,
  Label,
  PageHeader,
  Skeleton,
  Textarea,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortHash } from '../lib/format.js';
import { offerHeadline } from '../lib/intent.js';

export function ApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const approval = useApproval(id);
  const decide = useDecideApproval(id ?? '');
  const [note, setNote] = useState('');
  if (approval.isError)
    return <ErrorState error={approval.error} retry={() => void approval.refetch()} />;
  if (approval.isPending || !approval.data) return <Skeleton className="h-64" />;
  const a = approval.data;
  const pending = a.state === 'PENDING';
  const tone =
    a.state === 'APPROVED' || a.state === 'CONSUMED'
      ? 'verified'
      : a.state === 'PENDING'
        ? 'attention'
        : 'destructive';
  const stateLabel = {
    PENDING: 'Waiting for you',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    EXPIRED: 'Expired',
    CONSUMED: 'Approved and used',
    REVOKED: 'Cancelled',
  }[a.state];

  return (
    <>
      <PageHeader
        title="Aria needs your decision"
        meta={<Badge tone={tone}>{stateLabel}</Badge>}
        description="This offer is outside your plan, so Aria stopped before paying. Approving applies only to this exact offer and does not raise your standing limit."
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card title="Offer Aria found" className="border-amber/40">
              <KeyValue
                items={[
                  {
                    label: 'Offer',
                    value: a.offer ? offerHeadline(a.offer) : '—',
                  },
                  {
                    label: a.offer?.kind === 'goods' ? 'Product' : 'Route',
                    value: a.offer
                      ? a.offer.kind === 'goods'
                        ? offerHeadline(a.offer)
                        : `${a.offer.origin} → ${a.offer.destination}`
                      : '—',
                  },
                  {
                    label: 'Departs',
                    value: formatDateTime(a.offer?.departureAt),
                  },
                  {
                    label: a.offer?.kind === 'goods' ? 'Quantity' : 'Cabin',
                    value: a.offer
                      ? a.offer.kind === 'goods'
                        ? String(a.offer.quantity)
                        : (a.offer.cabin ?? '—')
                      : '—',
                  },
                  {
                    label: 'Price',
                    value: (
                      <span className="text-[18px] font-semibold text-amber">
                        {formatMoney(a.requested)}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
            <Card title="Your plan">
              <KeyValue
                items={[
                  {
                    label: 'Your limit',
                    value: (
                      <span className="text-[18px] font-semibold">{formatMoney(a.limit)}</span>
                    ),
                  },
                  {
                    label: 'Difference',
                    value: (
                      <span className="font-semibold text-amber">+{formatMoney(a.difference)}</span>
                    ),
                  },
                  { label: 'Why Aria paused', value: a.explanation },
                  {
                    label: 'Plan',
                    value: (
                      <Link
                        className="text-cobalt hover:underline"
                        to={`/dashboard/mandates/${a.mandateId}`}
                      >
                        View plan
                      </Link>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
          <Card title="Plan that set your limit">
            <p className="text-[13.5px]">
              Your plan allows up to {formatMoney(a.limit)} for this kind of purchase. This offer is{' '}
              {formatMoney(a.difference)} higher, so no payment can happen without this decision.
            </p>
          </Card>
          <Card title="What approving means">
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              <li>
                Aria may complete <strong>this exact offer</strong> once.
              </li>
              <li>
                If the cart changes in any way, the approval no longer applies and the purchase is
                blocked.
              </li>
              <li>Your standing limit of {formatMoney(a.limit)} stays unchanged.</li>
              <li>
                The offer is expected to remain available until {formatDateTime(a.expiresAt)}.
              </li>
            </ul>
            <details className="mt-3 border-t border-line pt-3 text-[12px]">
              <summary className="min-h-11 font-medium text-cobalt md:min-h-10">
                Proof & details
              </summary>
              <p className="mt-1 text-ink-muted">
                This one-time approval is bound to checkout hash{' '}
                <code className="font-mono">{shortHash(a.checkoutHash)}</code>. If the checkout
                changes, Authera blocks it.
              </p>
            </details>
          </Card>
        </div>
        <aside className="lg:col-span-4">
          <Card title="Your decision" className="lg:sticky lg:top-5">
            {pending ? (
              <>
                <Label htmlFor="approval-note" hint="optional">
                  Note for your record
                </Label>
                <Textarea
                  id="approval-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why you chose this option"
                />
                <div className="mt-3 flex flex-col gap-2">
                  <Button
                    loading={decide.isPending}
                    onClick={() =>
                      void decide.mutateAsync({
                        decision: 'APPROVED',
                        ...(note.trim() ? { note: note.trim() } : {}),
                      })
                    }
                  >
                    Approve this offer only
                  </Button>
                  <Button
                    variant="secondary"
                    loading={decide.isPending}
                    onClick={() =>
                      void decide.mutateAsync({
                        decision: 'REJECTED',
                        ...(note.trim() ? { note: note.trim() } : {}),
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Link
                    to="/dashboard/mandates/new"
                    className="text-center text-[12.5px] text-cobalt hover:underline"
                  >
                    Make a different plan
                  </Link>
                </div>
                {decide.isError ? (
                  <div className="mt-3">
                    <Alert tone="destructive">{decide.error.message}</Alert>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <Alert
                  tone={tone}
                  title={
                    a.state === 'CONSUMED'
                      ? 'Approved and used'
                      : a.state === 'APPROVED'
                        ? 'Approved — waiting for the agent'
                        : stateLabel
                  }
                >
                  {a.decidedAt ? `Decided ${formatDateTime(a.decidedAt)}.` : null}{' '}
                  {a.state === 'APPROVED'
                    ? 'The agent’s next attempt on this exact checkout will complete once.'
                    : null}
                  {a.consumedByExecutionId ? (
                    <Link
                      className="ml-1 text-cobalt hover:underline"
                      to={`/dashboard/purchases/${a.consumedByExecutionId}`}
                    >
                      View receipt
                    </Link>
                  ) : null}
                </Alert>
              </>
            )}
            <details className="mt-3 border-t border-line pt-3 text-[11.5px]">
              <summary className="min-h-11 font-medium text-cobalt md:min-h-10">
                How this is recorded
              </summary>
              <p className="mt-1 text-ink-muted">
                Authera records the exact checkout, amount, and decision time in the evidence trail.
              </p>
            </details>
          </Card>
        </aside>
      </div>
    </>
  );
}
