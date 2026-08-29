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
  PageHeader,
  Skeleton,
  Textarea,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortHash } from '../lib/format.js';

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

  return (
    <>
      <PageHeader
        title="Approval requested"
        meta={<Badge tone={tone}>{a.state}</Badge>}
        description="Your agent found an offer outside your mandate and stopped. Nothing has been charged. Approving applies to this exact checkout only and does not raise your standing limit."
      />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Card title="Requested flight" className="border-amber/40">
              <KeyValue
                items={[
                  {
                    label: 'Flight',
                    value: a.offer ? `${a.offer.airline} ${a.offer.flightNumber}` : '—',
                  },
                  {
                    label: 'Route',
                    value: a.offer ? `${a.offer.origin} → ${a.offer.destination}` : '—',
                  },
                  {
                    label: 'Departs',
                    value: a.offer ? a.offer.departureAt.slice(0, 16).replace('T', ' ') : '—',
                  },
                  { label: 'Cabin', value: a.offer?.cabin ?? '—' },
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
            <Card title="Your mandate">
              <KeyValue
                items={[
                  {
                    label: 'Limit',
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
                  { label: 'Why it stopped', value: a.explanation },
                  {
                    label: 'Mandate',
                    value: (
                      <Link className="text-cobalt hover:underline" to={`/mandates/${a.mandateId}`}>
                        v{a.mandateVersion} · open
                      </Link>
                    ),
                  },
                ]}
              />
            </Card>
          </div>
          <Card title="Mandate summary">
            <p className="text-[13.5px]">{a.mandateSummary}</p>
          </Card>
          <Card title="What approving means">
            <ul className="list-disc space-y-1 pl-5 text-[13px]">
              <li>
                The agent may complete <strong>this checkout</strong> (hash{' '}
                <code className="font-mono text-[12px]">{shortHash(a.checkoutHash)}</code>) once.
              </li>
              <li>
                If the cart changes in any way, the approval no longer applies and the purchase is
                blocked.
              </li>
              <li>
                Your standing limit of {formatMoney(a.limit)} stays unchanged for every other
                purchase.
              </li>
              <li>
                The offer is expected to remain available until {formatDateTime(a.expiresAt)}.
              </li>
            </ul>
          </Card>
        </div>
        <aside className="col-span-4">
          <Card title="Decision" className="sticky top-5">
            {pending ? (
              <>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note for the record"
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
                    Approve this purchase only
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
                    to="/mandates/new"
                    className="text-center text-[12.5px] text-cobalt hover:underline"
                  >
                    Create a new mandate instead
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
                        : a.state
                  }
                >
                  {a.decidedAt ? `Decided ${formatDateTime(a.decidedAt)}.` : null}{' '}
                  {a.state === 'APPROVED'
                    ? 'The agent’s next attempt on this exact checkout will complete once.'
                    : null}
                  {a.consumedByExecutionId ? (
                    <Link
                      className="ml-1 text-cobalt hover:underline"
                      to={`/purchases/${a.consumedByExecutionId}`}
                    >
                      View receipt
                    </Link>
                  ) : null}
                </Alert>
              </>
            )}
            <p className="mt-3 text-[11.5px] text-ink-faint">
              Approval evidence is signed into the audit trail with the checkout hash, amount, and
              your decision time.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
