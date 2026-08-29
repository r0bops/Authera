import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useExecutions, useVerification } from '../api/hooks.js';
import { Checklist, DecisionBadge, MandateStatusBadge } from '../components/status.js';
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  Label,
  PageHeader,
  Select,
  Skeleton,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortHash, shortId } from '../lib/format.js';

export function MerchantPage() {
  const [params, setParams] = useSearchParams();
  const executions = useExecutions(undefined, 50);
  const [chosen, setChosen] = useState('');
  const selected = chosen || params.get('executionId') || executions.data?.[0]?.id || '';
  const verification = useVerification(selected || undefined);
  const v = verification.data;

  return (
    <>
      <PageHeader
        title="Merchant view"
        description="What VuelaYa can verify before accepting an agent purchase: identity, mandate, constraints, the exact cart, and the payment state."
      />
      <Card className="mb-4">
        <div className="flex items-end gap-3">
          <div className="w-[520px]">
            <Label htmlFor="exec">Purchase attempt</Label>
            <Select
              id="exec"
              value={selected}
              onChange={(e) => {
                setChosen(e.target.value);
                setParams({ executionId: e.target.value });
              }}
            >
              {(executions.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {formatDateTime(e.createdAt)} · {e.offerSummary ?? shortId(e.offerId)} · {e.state}
                </option>
              ))}
            </Select>
          </div>
          {v ? (
            <DecisionBadge decision={v.decision} state={v.state} reasonCode={v.reasonCode} />
          ) : null}
        </div>
      </Card>
      {executions.data && executions.data.length === 0 ? (
        <EmptyState title="No purchase attempts to verify yet" />
      ) : null}
      {verification.isError ? (
        <ErrorState error={verification.error} retry={() => void verification.refetch()} />
      ) : null}
      {verification.isPending && selected ? <Skeleton className="h-48" /> : null}
      {v ? (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-4 flex flex-col gap-4">
            <Card
              title="1 · Agent identity"
              actions={
                <Badge tone={v.agentIdentity.ok ? 'verified' : 'destructive'}>
                  {v.agentIdentity.ok ? 'verified' : 'not verified'}
                </Badge>
              }
            >
              <KeyValue
                dense
                items={[
                  { label: 'Agent', value: shortId(v.agentIdentity.agentId, 18), mono: true },
                  { label: 'Key', value: shortId(v.agentIdentity.keyThumbprint, 22), mono: true },
                  { label: 'Profile', value: v.agentIdentity.profileUri ?? '—', mono: true },
                  { label: 'Nonce', value: shortId(v.agentIdentity.nonce, 18), mono: true },
                  {
                    label: 'Body digest',
                    value: shortId(v.agentIdentity.requestDigest, 24),
                    mono: true,
                  },
                ]}
              />
            </Card>
            <Card
              title="2 · Mandate"
              actions={v.mandate ? <MandateStatusBadge status={v.mandate.status} /> : null}
            >
              {v.mandate ? (
                <KeyValue
                  dense
                  items={[
                    { label: 'Mandate', value: shortId(v.mandate.id, 18), mono: true },
                    { label: 'Version', value: `v${v.mandate.version}` },
                    { label: 'Signed by', value: v.mandate.signatureKid, mono: true },
                    { label: 'Policy hash', value: shortHash(v.mandate.policyHash), mono: true },
                    {
                      label: 'Valid',
                      value: `${formatDateTime(v.mandate.validFrom)} → ${formatDateTime(v.mandate.validUntil)}`,
                    },
                  ]}
                />
              ) : (
                <p className="text-[13px] text-ink-muted">No mandate resolved.</p>
              )}
            </Card>
            <Card
              title="4 · Checkout binding"
              actions={
                v.checkout ? (
                  <Badge tone={v.checkout.bound ? 'verified' : 'destructive'}>
                    {v.checkout.bound ? 'bound' : 'MISMATCH'}
                  </Badge>
                ) : null
              }
            >
              {v.checkout ? (
                <KeyValue
                  dense
                  items={[
                    { label: 'Checkout', value: shortId(v.checkout.id, 18), mono: true },
                    { label: 'Total', value: formatMoney(v.checkout.total) },
                    { label: 'Status', value: v.checkout.status },
                    { label: 'Stored hash', value: shortHash(v.checkout.cartHash), mono: true },
                    { label: 'Recomputed', value: shortHash(v.checkout.computedHash), mono: true },
                  ]}
                />
              ) : (
                <p className="text-[13px] text-ink-muted">No checkout.</p>
              )}
            </Card>
            <Card title="5 · Reservation and payment">
              <KeyValue
                dense
                items={[
                  {
                    label: 'Reservation',
                    value: v.reservation
                      ? `${v.reservation.state} · ${formatMoney(v.reservation.amount)}`
                      : 'none (blocked before reservation)',
                  },
                  {
                    label: 'Payment',
                    value: v.payment ? `${v.payment.state} · ${v.payment.provider}` : 'none',
                  },
                  { label: 'Provider ref', value: v.payment?.providerPaymentId ?? '—', mono: true },
                ]}
              />
            </Card>
          </div>
          <div className="col-span-8">
            <Card title="3 · Constraint evaluation" description={v.explanation ?? undefined}>
              <Checklist checks={v.policyChecks} />
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}
