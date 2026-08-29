import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  useAuditEvents,
  useExecutions,
  useMandate,
  useOffers,
  useReviseMandate,
  useRevokeMandate,
} from '../api/hooks.js';
import { OffersTable, PriceWatchChart } from '../components/price-watch.js';
import { DecisionBadge, MandateStatusBadge, Timeline } from '../components/status.js';
import {
  Alert,
  Button,
  Card,
  Dialog,
  ErrorState,
  Input,
  KeyValue,
  Label,
  Mono,
  PageHeader,
  Skeleton,
  Switch,
  Table,
  Td,
  Textarea,
  Th,
} from '../components/ui/primitives.js';
import {
  formatDateTime,
  formatMoney,
  inputToMinor,
  minorToInput,
  shortHash,
  shortId,
} from '../lib/format.js';

export function MandateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const mandate = useMandate(id);
  const offers = useOffers();
  const executions = useExecutions(id, 20);
  const events = useAuditEvents({ mandateId: id, limit: 200 });
  const revoke = useRevokeMandate(id ?? '');
  const revise = useReviseMandate(id ?? '');
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [newMax, setNewMax] = useState('');
  const [newUntil, setNewUntil] = useState('');
  const [newEscalate, setNewEscalate] = useState(false);

  if (mandate.isError)
    return <ErrorState error={mandate.error} retry={() => void mandate.refetch()} />;
  if (mandate.isPending || !mandate.data) return <Skeleton className="h-64" />;
  const m = mandate.data;
  const limits = m.policy.limits;
  const inProgress =
    executions.data?.filter((e) => e.state === 'RESERVED' || e.state === 'PAYMENT_PENDING') ?? [];

  const openRevise = () => {
    setNewMax(minorToInput(limits.maxPerPurchaseMinor));
    setNewUntil(m.policy.validUntil.slice(0, 16));
    setNewEscalate(m.policy.escalation === 'require_human');
    setReviseOpen(true);
  };

  return (
    <>
      <PageHeader
        title={`${m.policy.intent.origin} → ${m.policy.intent.destination}`}
        meta={<MandateStatusBadge status={m.status} />}
        description={m.summary}
        actions={
          <>
            <Button variant="secondary" onClick={openRevise} disabled={m.status !== 'ACTIVE'}>
              Revise
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRevokeOpen(true)}
              disabled={m.status !== 'ACTIVE'}
            >
              Revoke
            </Button>
          </>
        }
      />
      {m.status === 'REVOKED' ? (
        <div className="mb-4">
          <Alert tone="destructive" title="Revoked">
            No further purchases are authorized. Revoked {formatDateTime(m.revokedAt)}
            {m.revokeReason ? ` — ${m.revokeReason}` : ''}. Remaining allowance (
            {formatMoney({ currency: limits.currency, minor: m.usage.remainingMinor })}) is no
            longer available.
          </Alert>
        </div>
      ) : null}
      {m.status === 'EXPIRED' ? (
        <div className="mb-4">
          <Alert tone="attention" title="Expired">
            This mandate expired {formatDateTime(m.policy.validUntil)}. Create a new one to keep
            watching prices.
          </Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col gap-4">
          <Card title="Limits and usage">
            <div className="grid grid-cols-4 gap-3">
              <Stat
                label="Max per purchase"
                value={formatMoney({
                  currency: limits.currency,
                  minor: limits.maxPerPurchaseMinor,
                })}
              />
              <Stat
                label="Total cap"
                value={formatMoney({ currency: limits.currency, minor: limits.maxTotalMinor })}
              />
              <Stat
                label="Purchases"
                value={`${m.usage.consumedCount} of ${limits.maxFulfillments}`}
                hint={
                  m.usage.reservedCount > 0 ? `${m.usage.reservedCount} in progress` : undefined
                }
              />
              <Stat
                label="Spent"
                value={formatMoney({ currency: limits.currency, minor: m.usage.consumedMinor })}
                hint={
                  m.usage.reservedMinor > 0
                    ? `${formatMoney({ currency: limits.currency, minor: m.usage.reservedMinor })} reserved`
                    : undefined
                }
              />
            </div>
            <KeyValue
              className="mt-4"
              dense
              items={[
                {
                  label: 'Travel window',
                  value: `${m.policy.intent.departureDateFrom} → ${m.policy.intent.departureDateTo}`,
                },
                {
                  label: 'Cabin / passengers',
                  value: `${m.policy.intent.cabin} · ${m.policy.intent.passengerCount}`,
                },
                { label: 'Merchants', value: m.merchants.map((x) => x.displayName).join(', ') },
                {
                  label: 'Valid',
                  value: `${formatDateTime(m.policy.validFrom)} → ${formatDateTime(m.policy.validUntil)}`,
                },
                {
                  label: 'Outside limits',
                  value:
                    m.policy.escalation === 'require_human' ? 'Pause for my approval' : 'Block',
                },
              ]}
            />
          </Card>
          <Card
            title="Price watch"
            description="Catalog offers on this route against your threshold"
          >
            {offers.isPending ? (
              <Skeleton className="h-[180px]" />
            ) : (
              <PriceWatchChart offers={offers.data ?? []} mandate={m} />
            )}
          </Card>
          <Card
            title="Offers evaluated"
            description="Server-owned catalog; eligibility is computed the same way the gateway does"
          >
            {offers.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <OffersTable
                offers={(offers.data ?? []).filter(
                  (o) =>
                    o.origin === m.policy.intent.origin &&
                    o.destination === m.policy.intent.destination,
                )}
                mandate={m}
              />
            )}
          </Card>
          <Card title="Purchase attempts">
            {executions.isPending ? <Skeleton className="h-16" /> : null}
            {executions.data && executions.data.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                The agent has not requested a purchase under this mandate yet.
              </p>
            ) : null}
            {executions.data && executions.data.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Offer</Th>
                    <Th>Amount</Th>
                    <Th>Outcome</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {executions.data.map((e) => (
                    <tr key={e.id}>
                      <Td>{formatDateTime(e.createdAt)}</Td>
                      <Td>{e.offerSummary ?? shortId(e.offerId)}</Td>
                      <Td className="tabular">{formatMoney(e.amount)}</Td>
                      <Td>
                        <DecisionBadge
                          decision={e.decision}
                          state={e.state}
                          reasonCode={e.reasonCode}
                        />
                      </Td>
                      <Td>
                        <Link
                          className="text-[12.5px] font-medium text-cobalt hover:underline"
                          to={
                            e.state === 'SUCCEEDED' ||
                            e.state === 'FAILED' ||
                            e.state === 'PAYMENT_PENDING'
                              ? `/purchases/${e.id}`
                              : `/auditor?executionId=${e.id}`
                          }
                        >
                          Details
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </Card>
          <Card title="Timeline">
            {events.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <Timeline events={events.data ?? []} />
            )}
          </Card>
        </div>
        <aside className="col-span-4 flex flex-col gap-4">
          <Card title="Agent">
            <KeyValue
              dense
              items={[
                { label: 'Name', value: m.agent.displayName },
                { label: 'Key', value: shortId(m.agent.keyThumbprint, 20), mono: true },
                {
                  label: 'Binding',
                  value: 'Only requests signed with this key can use the mandate',
                },
              ]}
            />
          </Card>
          <Card title="Payment">
            <KeyValue
              dense
              items={[
                {
                  label: 'Method',
                  value: m.paymentMethod
                    ? `${m.paymentMethod.brand} •••• ${m.paymentMethod.last4}`
                    : '—',
                },
                { label: 'Reference', value: shortId(m.policy.paymentMethodRef, 18), mono: true },
              ]}
            />
            <p className="mt-2 text-[12px] text-ink-faint">
              The raw card never leaves the vault; the mandate holds an opaque reference.
            </p>
          </Card>
          <Card title="Versions">
            <ul className="divide-y divide-line text-[13px]">
              {m.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between py-1.5">
                  <span>
                    v{v.version} · {formatDateTime(v.createdAt)}
                  </span>
                  <MandateStatusBadge status={v.status} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Evidence">
            <KeyValue
              dense
              items={[
                { label: 'Mandate id', value: shortId(m.id, 18), mono: true },
                { label: 'Policy hash', value: shortHash(m.policyHash), mono: true },
                { label: 'Signing key', value: m.signingKid, mono: true },
              ]}
            />
            <details className="mt-2">
              <summary className="text-[12.5px] font-medium text-cobalt">
                Show signed mandate (JWS)
              </summary>
              <Mono className="mt-1 block max-h-40 overflow-auto break-all whitespace-pre-wrap">
                {m.jws}
              </Mono>
            </details>
          </Card>
        </aside>
      </div>

      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke this mandate?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              onClick={() => {
                void revoke
                  .mutateAsync({ ...(reason.trim() ? { reason: reason.trim() } : {}) })
                  .then(() => setRevokeOpen(false));
              }}
            >
              Revoke now
            </Button>
          </>
        }
      >
        <p className="text-[13.5px]">
          Your agent will stop monitoring and every new purchase attempt using this mandate will
          fail immediately with <Mono>MANDATE_REVOKED</Mono>.
        </p>
        <KeyValue
          className="mt-3"
          dense
          items={[
            {
              label: 'Mandate',
              value: `${m.policy.intent.origin} → ${m.policy.intent.destination}, max ${formatMoney({ currency: limits.currency, minor: limits.maxPerPurchaseMinor })}`,
            },
            { label: 'Agent', value: m.agent.displayName },
            {
              label: 'In progress',
              value:
                inProgress.length > 0
                  ? `${inProgress.length} purchase(s) already reserved will finish; nothing new can start`
                  : 'No purchase in progress',
            },
          ]}
        />
        <div className="mt-3">
          <Label htmlFor="reason" hint="optional">
            Reason
          </Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Changed my plans"
          />
        </div>
        {revoke.isError ? (
          <div className="mt-3">
            <Alert tone="destructive">{revoke.error.message}</Alert>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        title="Revise mandate (creates a new signed version)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviseOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={revise.isPending}
              onClick={() => {
                const minor = inputToMinor(newMax);
                void revise
                  .mutateAsync({
                    limits: {
                      currency: limits.currency,
                      maxPerPurchaseMinor: minor,
                      maxTotalMinor: Math.max(minor, limits.maxTotalMinor),
                      maxFulfillments: limits.maxFulfillments,
                    },
                    validUntil: new Date(newUntil).toISOString(),
                    escalation: newEscalate ? 'require_human' : 'block',
                  })
                  .then(() => setReviseOpen(false));
              }}
            >
              Sign new version
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="newMax">Maximum price (USD)</Label>
            <Input
              id="newMax"
              inputMode="decimal"
              value={newMax}
              onChange={(e) => setNewMax(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="newUntil">Valid until</Label>
            <Input
              id="newUntil"
              type="datetime-local"
              value={newUntil}
              onChange={(e) => setNewUntil(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <Switch
              id="newEscalate"
              checked={newEscalate}
              onChange={setNewEscalate}
              label="Pause for my approval when an offer is outside these limits"
            />
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-muted">
          The current version is superseded and stays in the evidence trail unchanged.
        </p>
        {revise.isError ? (
          <div className="mt-3">
            <Alert tone="destructive">{revise.error.message}</Alert>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted/50 px-3 py-2">
      <p className="text-[11.5px] font-medium tracking-wide text-ink-muted uppercase">{label}</p>
      <p className="tabular mt-0.5 text-[16px] font-semibold text-ink">{value}</p>
      {hint ? <p className="text-[11.5px] text-amber">{hint}</p> : null}
    </div>
  );
}
