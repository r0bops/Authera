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
  Badge,
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
  buttonStyles,
} from '../components/ui/primitives.js';
import {
  formatDate,
  formatDateTime,
  formatMoney,
  friendlyAgentName,
  inputToMinor,
  minorToInput,
  shortHash,
  shortId,
} from '../lib/format.js';
import { intentLabel, intentTitle, offerInScope } from '../lib/intent.js';

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
  const agentName = friendlyAgentName(m.agent.displayName);
  const isComplete = m.status === 'ACTIVE' && m.usage.remainingCount === 0;
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
        title={intentLabel(m.policy.intent)}
        meta={
          isComplete ? (
            <Badge tone="verified">Plan complete</Badge>
          ) : (
            <MandateStatusBadge status={m.status} plainLanguage />
          )
        }
        description={`${agentName} may buy ${intentTitle(m.policy.intent)} for ${formatMoney({ currency: limits.currency, minor: limits.maxPerPurchaseMinor })} or less, ${limits.maxFulfillments === 1 ? 'once' : `up to ${limits.maxFulfillments} times`}, until ${formatDateTime(m.policy.validUntil)}.`}
        actions={
          isComplete ? (
            <Link to="/dashboard/mandates/new" className={buttonStyles()}>
              Plan another purchase
            </Link>
          ) : (
            <>
              <Button variant="secondary" onClick={openRevise} disabled={m.status !== 'ACTIVE'}>
                Change plan
              </Button>
              <Button
                variant="destructive"
                onClick={() => setRevokeOpen(true)}
                disabled={m.status !== 'ACTIVE'}
              >
                Stop {agentName}
              </Button>
            </>
          )
        }
      />
      {isComplete ? (
        <div className="mb-4">
          <Alert tone="verified" title="Purchase complete">
            This plan has no uses left and cannot authorize another purchase. Its rules and proof
            remain available below.
          </Alert>
        </div>
      ) : null}
      {m.status === 'REVOKED' ? (
        <div className="mb-4">
          <Alert tone="destructive" title="Plan stopped">
            {agentName} cannot start another purchase with this plan. Stopped{' '}
            {formatDateTime(m.revokedAt)}
            {m.revokeReason ? ` — ${m.revokeReason}` : ''}. Remaining allowance (
            {formatMoney({ currency: limits.currency, minor: m.usage.remainingMinor })}) is no
            longer available.
          </Alert>
        </div>
      ) : null}
      {m.status === 'EXPIRED' ? (
        <div className="mb-4">
          <Alert tone="attention" title="Plan expired">
            This plan ended {formatDateTime(m.policy.validUntil)}. Create a new one to keep watching
            prices.
          </Alert>
        </div>
      ) : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <Card title="Your rules">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Price limit"
                value={formatMoney({
                  currency: limits.currency,
                  minor: limits.maxPerPurchaseMinor,
                })}
              />
              <Stat
                label="Total allowed"
                value={formatMoney({ currency: limits.currency, minor: limits.maxTotalMinor })}
              />
              <Stat
                label="Bought"
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
                ...(m.policy.intent.type === 'flight'
                  ? [
                      {
                        label: 'Travel window',
                        value: `${formatDate(m.policy.intent.departureDateFrom)} → ${formatDate(m.policy.intent.departureDateTo)}`,
                      },
                      {
                        label: 'Cabin / passengers',
                        value: `${m.policy.intent.cabin} · ${m.policy.intent.passengerCount}`,
                      },
                    ]
                  : [
                      { label: 'Product', value: `“${m.policy.intent.query}”` },
                      { label: 'Quantity', value: `up to ${m.policy.intent.maxQuantity}` },
                    ]),
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
          <details className="group rounded-md border border-line bg-surface">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
              <span>See prices and offers {agentName} compared</span>
              <span className="text-[12px] font-normal text-ink-muted group-open:hidden">
                Optional detail
              </span>
            </summary>
            <div className="space-y-5 border-t border-line px-4 py-4">
              <section aria-labelledby="price-history-heading">
                <h2 id="price-history-heading" className="text-[14px] font-semibold text-ink">
                  Price history
                </h2>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Real provider offers compared with your limit.
                </p>
                <div className="mt-3">
                  {offers.isPending ? (
                    <Skeleton className="h-[180px]" />
                  ) : (
                    <PriceWatchChart offers={offers.data ?? []} mandate={m} />
                  )}
                </div>
              </section>
              <section className="border-t border-line pt-4" aria-labelledby="offers-heading">
                <h2 id="offers-heading" className="text-[14px] font-semibold text-ink">
                  Offers compared
                </h2>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  Every offer is checked against the rules you approved.
                </p>
                <div className="mt-3">
                  {offers.isError ? (
                    <ErrorState error={offers.error} retry={() => void offers.refetch()} />
                  ) : offers.isPending ? (
                    <Skeleton className="h-24" />
                  ) : (
                    <OffersTable
                      offers={(offers.data ?? []).filter((o) => offerInScope(o, m.policy.intent))}
                      mandate={m}
                    />
                  )}
                </div>
              </section>
            </div>
          </details>
          <Card title="Purchase checks">
            {executions.isPending ? <Skeleton className="h-16" /> : null}
            {executions.data && executions.data.length === 0 ? (
              <p className="text-[13px] text-ink-muted">
                {agentName} has not requested a purchase with this plan yet.
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
                          showReasonCode={false}
                          plainLanguage
                        />
                      </Td>
                      <Td>
                        <Link
                          className="text-[12.5px] font-medium text-cobalt hover:underline"
                          to={
                            e.state === 'SUCCEEDED' ||
                            e.state === 'FAILED' ||
                            e.state === 'PAYMENT_PENDING'
                              ? `/dashboard/purchases/${e.id}`
                              : '/dashboard/activity'
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
          <Card title={`What ${agentName} has done`}>
            {events.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <Timeline events={events.data ?? []} showLinks={false} plainLanguage />
            )}
          </Card>
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card title="Who can use this plan">
            <KeyValue
              dense
              items={[
                { label: 'Agent', value: agentName },
                {
                  label: 'Protection',
                  value: 'Requests from any other agent are blocked',
                },
              ]}
            />
            <details className="mt-2 text-[12px]">
              <summary className="min-h-11 font-medium text-cobalt md:min-h-10">
                Show verified key
              </summary>
              <Mono className="mt-1 block break-all">{m.agent.keyThumbprint}</Mono>
            </details>
          </Card>
          <Card title="Payment method">
            <KeyValue
              dense
              items={[
                {
                  label: 'Method',
                  value: m.paymentMethod
                    ? `${m.paymentMethod.brand} •••• ${m.paymentMethod.last4}`
                    : '—',
                },
              ]}
            />
            <p className="mt-2 text-[12px] text-ink-faint">
              Your card details are never shared with {agentName}.
            </p>
            <details className="mt-2 text-[12px]">
              <summary className="min-h-11 font-medium text-cobalt md:min-h-10">
                Show payment reference
              </summary>
              <Mono className="mt-1 block break-all">{m.policy.paymentMethodRef}</Mono>
            </details>
          </Card>
          <Card title="Plan history">
            <ul className="divide-y divide-line text-[13px]">
              {m.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between py-1.5">
                  <span>
                    v{v.version} · {formatDateTime(v.createdAt)}
                  </span>
                  {v.version === m.version && isComplete ? (
                    <Badge tone="verified">Used</Badge>
                  ) : (
                    <MandateStatusBadge status={v.status} plainLanguage />
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card
            title="Proof & details"
            description="Technical evidence is available for an audit or dispute."
          >
            <details>
              <summary className="min-h-11 text-[12.5px] font-medium text-cobalt md:min-h-10">
                Show technical evidence
              </summary>
              <div className="mt-2">
                <KeyValue
                  dense
                  items={[
                    { label: 'Mandate id', value: shortId(m.id, 18), mono: true },
                    { label: 'Policy hash', value: shortHash(m.policyHash), mono: true },
                    { label: 'Signing key', value: m.signingKid, mono: true },
                  ]}
                />
                <details className="mt-2">
                  <summary className="min-h-11 text-[12.5px] font-medium text-cobalt md:min-h-10">
                    Show signed authorization (JWS)
                  </summary>
                  <Mono className="mt-1 block max-h-40 overflow-auto break-all whitespace-pre-wrap">
                    {m.jws}
                  </Mono>
                </details>
              </div>
            </details>
          </Card>
        </aside>
      </div>

      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Stop this purchase plan?"
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
              Stop {agentName} now
            </Button>
          </>
        }
      >
        <p className="text-[13.5px]">
          {agentName} will stop monitoring this plan. Every new purchase attempt using it will be
          blocked immediately.
        </p>
        <KeyValue
          className="mt-3"
          dense
          items={[
            {
              label: 'Plan',
              value: `${intentTitle(m.policy.intent)}, max ${formatMoney({ currency: limits.currency, minor: limits.maxPerPurchaseMinor })}`,
            },
            { label: 'Agent', value: agentName },
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
        title="Change this plan"
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
              Save new plan
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
          <div className="sm:col-span-2">
            <Switch
              id="newEscalate"
              checked={newEscalate}
              onChange={setNewEscalate}
              label="Pause for my approval when an offer is outside these limits"
            />
          </div>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-muted">
          Your previous rules stay in the evidence record. {agentName} will use only the new plan.
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
