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
import type { VerificationView } from '@authera/contracts';
import { cn } from '../lib/cn.js';
import { formatDate, formatDateTime, formatMoney, shortHash, shortId } from '../lib/format.js';
import { decisionLabel, reasonLabel } from '../lib/labels.js';

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
        description="What the merchant can verify before accepting an agent purchase: identity, mandate, constraints, the exact cart, and the payment state."
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
      {v ? <VerificationSummary v={v} /> : null}
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

/** What VuelaYa needs to know before accepting, in the brief's words; details follow below. */
function VerificationSummary({ v }: { v: VerificationView }) {
  const check = (code: string) => v.policyChecks.find((c) => c.code === code);
  const passed = (code: string) => check(code)?.passed;
  const perPurchase = check('AMOUNT_PER_PURCHASE');
  const expected = perPurchase?.expected;
  const maxMinor = typeof expected === 'number' ? expected : null;
  const rows: Array<{ label: string; value: string; ok: boolean | null }> = [
    {
      label: 'Agent identity',
      value: v.agentIdentity.ok ? 'Verified' : 'Rejected',
      ok: v.agentIdentity.ok,
    },
    {
      label: 'Human mandate',
      value: v.mandate ? `Signature valid · v${v.mandate.version}` : 'Not found',
      ok: v.mandate ? (passed('MANDATE_SIGNATURE') ?? true) : false,
    },
    {
      label: 'Mandate status',
      value: v.mandate ? v.mandate.status.charAt(0) + v.mandate.status.slice(1).toLowerCase() : '—',
      ok: v.mandate ? v.mandate.status === 'ACTIVE' : null,
    },
    {
      label: 'Category',
      value: passed('INTENT_KIND') === false ? 'Forbidden' : 'Allowed',
      ok: passed('INTENT_KIND') ?? null,
    },
    {
      label: 'Price',
      value: v.checkout
        ? `${formatMoney(v.checkout.total)}${maxMinor !== null ? ` / ${formatMoney({ minor: maxMinor, currency: v.checkout.total.currency })} max` : ''}`
        : '—',
      ok: passed('AMOUNT_PER_PURCHASE') ?? null,
    },
    {
      label: 'Validity',
      value: v.mandate ? `until ${formatDate(v.mandate.validUntil)}` : '—',
      ok: passed('VALID_UNTIL') ?? null,
    },
    {
      label: 'Usage',
      value: passed('USAGE_RESERVATION') === false ? 'Exhausted' : 'Within limit',
      ok: passed('USAGE_RESERVATION') ?? null,
    },
    {
      label: 'Quote binding',
      value: v.checkout ? (v.checkout.bound ? 'Match' : 'Mismatch') : '—',
      ok: v.checkout ? v.checkout.bound : null,
    },
  ];
  return (
    <Card className="mb-4" title="Verification at a glance">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-2">
            <dt className="text-[12px] uppercase tracking-wide text-ink-muted">{row.label}</dt>
            <dd
              className={cn(
                'font-medium',
                row.ok === true && 'text-emerald',
                row.ok === false && 'text-coral',
              )}
            >
              {row.ok === true ? '✓ ' : row.ok === false ? '✕ ' : ''}
              {row.value}
            </dd>
          </div>
        ))}
        <div className="col-span-2 flex items-baseline gap-2 md:col-span-4">
          <dt className="text-[12px] uppercase tracking-wide text-ink-muted">Decision</dt>
          <dd className="font-semibold">
            {decisionLabel(v.decision)}
            {v.reasonCode ? (
              <span className="ml-2 font-normal text-ink-muted">{reasonLabel(v.reasonCode)}</span>
            ) : null}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
