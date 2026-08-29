import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { DisputeReason } from '@agentcerta/contracts';
import { useDispute, useDisputes, useEvidence, useOpenDispute, usePurchase } from '../api/hooks.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  KeyValue,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortHash, shortId } from '../lib/format.js';

const REASONS: Array<{ value: DisputeReason; label: string }> = [
  { value: 'DID_NOT_CREATE_MANDATE', label: 'I did not create this mandate' },
  { value: 'PURCHASE_DID_NOT_MATCH_MANDATE', label: 'The purchase did not match my mandate' },
  { value: 'REVOKED_BEFORE_PURCHASE', label: 'I revoked the mandate before the purchase' },
  { value: 'UNRECOGNIZED_AGENT', label: 'I do not recognize the agent' },
  { value: 'OTHER', label: 'Another problem' },
];

export function NewDisputePage() {
  const [params] = useSearchParams();
  const executionId = params.get('executionId') ?? '';
  const purchase = usePurchase(executionId || undefined);
  const evidence = useEvidence(executionId || undefined, 'human');
  const open = useOpenDispute();
  const navigate = useNavigate();
  const [reason, setReason] = useState<DisputeReason>('PURCHASE_DID_NOT_MATCH_MANDATE');
  const [description, setDescription] = useState('');

  if (!executionId)
    return <Alert tone="attention">Open a purchase receipt and choose “Report a problem”.</Alert>;
  return (
    <>
      <PageHeader
        title="Report a problem"
        description="Tell us what is wrong. The evidence recorded at purchase time is used to investigate — it does not assume you or the merchant are wrong."
      />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-7 flex flex-col gap-4">
          <Card title="Purchase">
            {purchase.isPending ? <Skeleton className="h-24" /> : null}
            {purchase.data ? (
              <KeyValue
                items={[
                  {
                    label: 'Flight',
                    value: purchase.data.offer
                      ? `${purchase.data.offer.airline} ${purchase.data.offer.flightNumber} · ${purchase.data.offer.origin} → ${purchase.data.offer.destination}`
                      : '—',
                  },
                  { label: 'Paid', value: formatMoney(purchase.data.execution.amount) },
                  { label: 'When', value: formatDateTime(purchase.data.execution.createdAt) },
                  { label: 'Status', value: purchase.data.execution.state },
                ]}
              />
            ) : null}
          </Card>
          <Card
            title="Evidence that will be used"
            description="A preview of what the record contains"
          >
            {evidence.isPending ? <Skeleton className="h-24" /> : null}
            {evidence.data ? (
              <ul className="space-y-1 text-[13px]">
                <li>
                  Human authorization:{' '}
                  {evidence.data.human
                    ? `mandate v${evidence.data.human.authorization.version}, hash ${shortHash(evidence.data.human.authorization.policyHash)}`
                    : 'none linked'}
                </li>
                <li>
                  Mandate status: {evidence.data.mandate?.status ?? '—'}
                  {evidence.data.mandate?.revokedAt
                    ? ` (revoked ${formatDateTime(evidence.data.mandate.revokedAt)})`
                    : ''}
                </li>
                <li>
                  Agent: {evidence.data.agent.displayName ?? '—'} · signature{' '}
                  {evidence.data.agent.signatureVerified ? 'verified' : 'not verified'}
                </li>
                <li>
                  Merchant verification: {evidence.data.policyChecks.filter((c) => c.passed).length}{' '}
                  of {evidence.data.policyChecks.length} checks passed · cart{' '}
                  {evidence.data.checkout?.bound ? 'bound' : 'unbound'}
                </li>
                <li>
                  Payment:{' '}
                  {evidence.data.payment
                    ? `${evidence.data.payment.state} at ${formatDateTime(evidence.data.payment.updatedAt)}`
                    : 'none'}
                </li>
                <li>
                  Audit chain:{' '}
                  {evidence.data.audit.chain.valid
                    ? `valid (${evidence.data.audit.chain.events} events)`
                    : 'INVALID'}
                </li>
              </ul>
            ) : null}
          </Card>
        </div>
        <aside className="col-span-5">
          <Card title="What is wrong?">
            <div className="space-y-2">
              {REASONS.map((r) => (
                <label key={r.value} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input
                    type="radio"
                    name="reason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                  />
                  {r.label}
                </label>
              ))}
            </div>
            <Textarea
              className="mt-3"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details"
            />
            <Button
              className="mt-3 w-full"
              loading={open.isPending}
              onClick={() =>
                void open
                  .mutateAsync({
                    executionId,
                    reason,
                    ...(description.trim() ? { description: description.trim() } : {}),
                  })
                  .then((d) => navigate(`/disputes/${d.id}`))
              }
            >
              Submit dispute
            </Button>
            {open.isError ? (
              <div className="mt-3">
                <Alert tone="destructive">{open.error.message}</Alert>
              </div>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}

export function DisputePage() {
  const { id } = useParams<{ id: string }>();
  const dispute = useDispute(id);
  if (dispute.isError)
    return <ErrorState error={dispute.error} retry={() => void dispute.refetch()} />;
  if (dispute.isPending || !dispute.data) return <Skeleton className="h-64" />;
  const d = dispute.data;
  const r = d.resolution;
  const tone =
    r?.outcome === 'AUTHORIZED'
      ? 'verified'
      : r?.outcome === 'CUSTOMER_SUPPORTED'
        ? 'info'
        : 'attention';
  return (
    <>
      <PageHeader
        title={r?.headline ?? 'Dispute under review'}
        meta={<Badge tone={tone}>{r?.outcome.replace(/_/g, ' ') ?? d.state}</Badge>}
        description={`Dispute ${shortId(d.id)} · opened ${formatDateTime(d.createdAt)} · reason: ${REASONS.find((x) => x.value === d.reason)?.label ?? d.reason}`}
        actions={
          <>
            <Link to={`/auditor?executionId=${d.executionId}`}>
              <Button variant="secondary">Open evidence</Button>
            </Link>
            <Button
              variant="ghost"
              disabled
              title="Human review escalation is recorded; contact support"
            >
              Appeal
            </Button>
          </>
        }
      />
      {r ? (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <Card title="What happened, in order">
              <ol className="relative ml-2 border-l border-line-strong pl-5">
                {r.timeline.map((t, i) => (
                  <li key={i} className="relative pb-3 text-[13px]">
                    <span
                      className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-cobalt bg-surface"
                      aria-hidden
                    />
                    <p className="font-medium">{t.label}</p>
                    <p className="text-[12px] text-ink-muted">
                      {formatDateTime(t.at)}
                      {t.detail ? ` · ${t.detail}` : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
          <div className="col-span-6">
            <Card title="Decision">
              <Alert tone={tone} title={r.headline}>
                {r.explanation}
              </Alert>
              {d.description ? (
                <p className="mt-3 text-[12.5px] text-ink-muted">Your note: “{d.description}”</p>
              ) : null}
            </Card>
          </div>
          <div className="col-span-6">
            <Card title="Verification evidence">
              <Table>
                <thead>
                  <tr>
                    <Th>Finding</Th>
                    <Th>Result</Th>
                    <Th>Detail</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.findings.map((f) => (
                    <tr key={f.label}>
                      <Td>{f.label}</Td>
                      <Td>
                        <Badge tone={f.ok === null ? 'neutral' : f.ok ? 'verified' : 'destructive'}>
                          {f.ok === null ? 'n/a' : f.ok ? 'yes' : 'no'}
                        </Badge>
                      </Td>
                      <Td className="text-ink-muted">{f.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <details className="mt-3">
                <summary className="text-[12.5px] font-medium text-cobalt">
                  Evidence references
                </summary>
                <KeyValue
                  className="mt-2"
                  dense
                  items={r.evidenceRefs.map((ref) => ({
                    label: ref.label,
                    value: ref.value,
                    mono: true,
                  }))}
                />
              </details>
            </Card>
          </div>
        </div>
      ) : (
        <Alert tone="attention">This dispute is awaiting resolution.</Alert>
      )}
    </>
  );
}

export function DisputesListPage() {
  const disputes = useDisputes();
  return (
    <>
      <PageHeader title="Disputes" />
      {disputes.isPending ? <Skeleton className="h-24" /> : null}
      {disputes.data && disputes.data.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No disputes.</p>
      ) : null}
      {disputes.data && disputes.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>Opened</Th>
              <Th>Execution</Th>
              <Th>Reason</Th>
              <Th>Outcome</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {disputes.data.map((d) => (
              <tr key={d.id}>
                <Td>{formatDateTime(d.createdAt)}</Td>
                <Td mono>{shortId(d.executionId)}</Td>
                <Td>{REASONS.find((x) => x.value === d.reason)?.label ?? d.reason}</Td>
                <Td>
                  {d.resolution ? (
                    <Badge
                      tone={
                        d.resolution.outcome === 'AUTHORIZED'
                          ? 'verified'
                          : d.resolution.outcome === 'CUSTOMER_SUPPORTED'
                            ? 'info'
                            : 'attention'
                      }
                    >
                      {d.resolution.headline}
                    </Badge>
                  ) : (
                    d.state
                  )}
                </Td>
                <Td>
                  <Link
                    className="text-[12.5px] font-medium text-cobalt hover:underline"
                    to={`/disputes/${d.id}`}
                  >
                    Open
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </>
  );
}
