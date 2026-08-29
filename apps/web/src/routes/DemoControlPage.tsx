import { useState } from 'react';
import { Link } from 'react-router';
import type { DemoAttemptResult, DemoDirectAttemptResult } from '@authera/contracts';
import {
  useDemoAttempt,
  useDemoDirect,
  useDemoImpersonate,
  useDemoInjectOffer,
  useDemoPaymentBehavior,
  useDemoRace,
  useDemoReplay,
  useDemoReset,
  useDemoState,
  useDemoTime,
  useMandates,
  useMe,
  useMockWebhook,
  useOffers,
} from '../api/hooks.js';
import { OffersTable } from '../components/price-watch.js';
import { DecisionBadge } from '../components/status.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  KeyValue,
  Label,
  Mono,
  PageHeader,
  Select,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, inputToMinor, shortId } from '../lib/format.js';

type LastResult = { label: string; at: string; value: unknown };

export function DemoControlPage() {
  const me = useMe();
  const demo = useDemoState(Boolean(me.data?.demoMode));
  const mandates = useMandates();
  const offers = useOffers();
  const reset = useDemoReset();
  const inject = useDemoInjectOffer();
  const attempt = useDemoAttempt();
  const direct = useDemoDirect();
  const impersonate = useDemoImpersonate();
  const replay = useDemoReplay();
  const race = useDemoRace();
  const time = useDemoTime();
  const behavior = useDemoPaymentBehavior();
  const webhook = useMockWebhook();
  const [last, setLast] = useState<LastResult | null>(null);
  const [price, setPrice] = useState('130.00');
  const [origin, setOrigin] = useState('CCS');
  const [destination, setDestination] = useState('COR');
  const [cabin, setCabin] = useState<'economy' | 'business'>('economy');
  const [departure, setDeparture] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [mandateId, setMandateId] = useState('');
  const [offerId, setOfferId] = useState('');
  const [mode, setMode] = useState<'scripted' | 'openai'>('scripted');
  const [offsetMinutes, setOffsetMinutes] = useState('0');
  const [outcome, setOutcome] = useState<'succeed' | 'fail' | 'pending'>('succeed');
  const [delay, setDelay] = useState('3000');
  const [webhookExecution, setWebhookExecution] = useState('');
  const [webhookOutcome, setWebhookOutcome] = useState<'succeeded' | 'failed'>('succeeded');

  const active = mandates.data?.find((m) => m.status === 'ACTIVE');
  const selectedMandate = mandateId || active?.id || mandates.data?.[0]?.id || '';
  const anyPending = [
    reset,
    inject,
    attempt,
    direct,
    impersonate,
    replay,
    race,
    time,
    behavior,
    webhook,
  ].some((m) => m.isPending);
  const record = (label: string) => (value: unknown) =>
    setLast({ label, at: new Date().toISOString(), value });
  const errors = [
    reset,
    inject,
    attempt,
    direct,
    impersonate,
    replay,
    race,
    time,
    behavior,
    webhook,
  ]
    .map((m) => m.error)
    .filter(Boolean);

  if (me.data && !me.data.demoMode) {
    return (
      <>
        <PageHeader title="Demo control" />
        <Alert tone="attention" title="Demo mode is off">
          Set DEMO_MODE=true to enable the trial-by-fire controls. Nothing here exists in
          production.
        </Alert>
      </>
    );
  }

  const lastPurchaseExecution = (() => {
    const v = last?.value as
      DemoDirectAttemptResult | DemoAttemptResult | DemoDirectAttemptResult[] | undefined;
    if (!v) return '';
    if (Array.isArray(v)) return v[0]?.purchase?.executionId ?? '';
    if ('purchase' in v && v.purchase) return v.purchase.executionId;
    return '';
  })();

  return (
    <>
      <PageHeader
        title="Demo control"
        description="Trial-by-fire controls for judges. Every button drives the same signed API and services as real traffic — none can bypass verification or fabricate a success."
        actions={
          <Button
            variant="destructive"
            loading={reset.isPending}
            onClick={() => void reset.mutateAsync({}).then(record('reset'))}
          >
            Reset scenario
          </Button>
        }
      />
      {errors.length > 0 ? (
        <div className="mb-4">
          <Alert tone="destructive" title="Last error">
            {errors.map((e) => (e instanceof Error ? e.message : String(e))).join(' · ')}
          </Alert>
        </div>
      ) : null}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-8 flex flex-col gap-4">
          <Card
            title="1 · Inject an offer"
            description="Any merchant, price, route, cabin, or date — the judge's combination"
          >
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label htmlFor="merchant">Merchant</Label>
                <Select
                  id="merchant"
                  value={merchantId || (me.data?.merchants[0]?.id ?? '')}
                  onChange={(e) => setMerchantId(e.target.value)}
                >
                  {(me.data?.merchants ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="price">Price (USD)</Label>
                <Input
                  id="price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div className="col-span-1">
                <Label htmlFor="o">From</Label>
                <Input
                  id="o"
                  value={origin}
                  maxLength={3}
                  onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                />
              </div>
              <div className="col-span-1">
                <Label htmlFor="d">To</Label>
                <Input
                  id="d"
                  value={destination}
                  maxLength={3}
                  onChange={(e) => setDestination(e.target.value.toUpperCase())}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="cabin">Cabin</Label>
                <Select
                  id="cabin"
                  value={cabin}
                  onChange={(e) => setCabin(e.target.value as 'economy' | 'business')}
                >
                  <option value="economy">economy</option>
                  <option value="business">business</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="dep">Departure</Label>
                <Input
                  id="dep"
                  type="date"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                />
              </div>
              <div className="col-span-1 flex items-end">
                <Button
                  className="w-full"
                  loading={inject.isPending}
                  onClick={() =>
                    void inject
                      .mutateAsync({
                        amountMinor: inputToMinor(price),
                        origin,
                        destination,
                        cabin,
                        currency: 'USD',
                        passengerCount: 1,
                        ...(merchantId || me.data?.merchants[0]?.id
                          ? { merchantId: merchantId || me.data!.merchants[0]!.id }
                          : {}),
                        expiresInMinutes: 1440,
                        ...(departure ? { departureAt: `${departure}T08:00:00.000Z` } : {}),
                      })
                      .then((o) => {
                        setOfferId(o.id);
                        record('inject offer')(o);
                      })
                  }
                >
                  Inject
                </Button>
              </div>
            </div>
          </Card>

          <Card
            title="2 · Agent attempt"
            description="The agent searches every merchant and market, prepares a checkout per offer, compares them, and asks the gateway for its choice. Or force one offer for a direct signed attempt."
          >
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-5">
                <Label htmlFor="mandate">Mandate</Label>
                <Select
                  id="mandate"
                  value={selectedMandate}
                  onChange={(e) => setMandateId(e.target.value)}
                >
                  {(mandates.data ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.policy.intent.origin} → {m.policy.intent.destination} · max{' '}
                      {formatMoney({
                        currency: m.policy.limits.currency,
                        minor: m.policy.limits.maxPerPurchaseMinor,
                      })}{' '}
                      · {m.status}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="mode">Who decides</Label>
                <Select
                  id="mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as 'scripted' | 'openai')}
                >
                  <option value="scripted">Deterministic (no LLM)</option>
                  <option value="openai">AI agent (OpenAI)</option>
                </Select>
              </div>
              <div className="col-span-5 flex items-end gap-2">
                <Button
                  loading={attempt.isPending}
                  disabled={!selectedMandate}
                  onClick={() =>
                    void attempt
                      .mutateAsync({ mandateId: selectedMandate, mode })
                      .then(record('agent attempt'))
                  }
                >
                  Run agent
                </Button>
                <Button
                  variant="secondary"
                  loading={direct.isPending}
                  disabled={!selectedMandate || !offerId}
                  onClick={() =>
                    void direct
                      .mutateAsync({ mandateId: selectedMandate, offerId, impersonate: false })
                      .then(record('direct attempt'))
                  }
                >
                  Direct attempt on selected offer
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <OffersTable
                offers={offers.data ?? []}
                mandate={mandates.data?.find((m) => m.id === selectedMandate)}
                onSelect={(o) => setOfferId(o.id)}
                selectedId={offerId}
              />
            </div>
          </Card>

          <Card
            title="3 · Adversarial attempts"
            description="Impersonate the agent, replay a captured signed request, or race two executions for a one-use mandate"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={impersonate.isPending}
                disabled={!selectedMandate || !offerId}
                onClick={() =>
                  void impersonate
                    .mutateAsync({ mandateId: selectedMandate, offerId, impersonate: true })
                    .then(record('impersonated attempt'))
                }
              >
                Sign with a forged key
              </Button>
              <Button
                variant="secondary"
                loading={replay.isPending}
                disabled={!lastPurchaseExecution && (demo.data?.capturedRequests.length ?? 0) === 0}
                onClick={() => {
                  const target =
                    lastPurchaseExecution || demo.data?.capturedRequests.at(-1)?.executionId;
                  if (target)
                    void replay
                      .mutateAsync({ executionId: target })
                      .then(record('replayed request'));
                }}
              >
                Replay last signed request
              </Button>
              <Button
                variant="secondary"
                loading={race.isPending}
                disabled={!selectedMandate || !offerId}
                onClick={() =>
                  void race
                    .mutateAsync({ mandateId: selectedMandate, offerId, attempts: 2 })
                    .then(record('concurrent attempts'))
                }
              >
                Race two attempts
              </Button>
            </div>
          </Card>

          <Card title="4 · Environment" description="Demo clock and mock processor behavior">
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-3">
                <Label
                  htmlFor="offset"
                  hint={demo.data?.clockEnabled ? undefined : '(DEMO_CLOCK_ENABLED=false)'}
                >
                  Clock offset (minutes)
                </Label>
                <Input
                  id="offset"
                  value={offsetMinutes}
                  onChange={(e) => setOffsetMinutes(e.target.value)}
                  disabled={!demo.data?.clockEnabled}
                />
              </div>
              <div className="col-span-2 flex items-end">
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={!demo.data?.clockEnabled}
                  loading={time.isPending}
                  onClick={() =>
                    void time
                      .mutateAsync({ offsetMinutes: Number.parseInt(offsetMinutes, 10) || 0 })
                      .then(record('clock'))
                  }
                >
                  Apply
                </Button>
              </div>
              <div className="col-span-3">
                <Label htmlFor="outcome">Next payments</Label>
                <Select
                  id="outcome"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                >
                  <option value="succeed">succeed</option>
                  <option value="fail">fail (card declined)</option>
                  <option value="pending">pending, then webhook</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="delay">Webhook delay (ms)</Label>
                <Input
                  id="delay"
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                  disabled={outcome !== 'pending'}
                />
              </div>
              <div className="col-span-2 flex items-end">
                <Button
                  variant="secondary"
                  className="w-full"
                  loading={behavior.isPending}
                  onClick={() =>
                    void behavior
                      .mutateAsync({
                        outcome,
                        ...(outcome === 'fail' ? { failureReason: 'card_declined' } : {}),
                        ...(outcome === 'pending'
                          ? {
                              webhookDelayMs: Number.parseInt(delay, 10) || 0,
                              pendingResolvesTo: 'succeed',
                              duplicateWebhooks: 1,
                            }
                          : {}),
                      })
                      .then(record('payment behavior'))
                  }
                >
                  Apply
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-12 gap-3">
              <div className="col-span-5">
                <Label htmlFor="wh">Simulate provider webhook for execution</Label>
                <Input
                  id="wh"
                  value={webhookExecution || lastPurchaseExecution}
                  onChange={(e) => setWebhookExecution(e.target.value)}
                  placeholder="execution id"
                />
              </div>
              <div className="col-span-3">
                <Label htmlFor="who">Outcome</Label>
                <Select
                  id="who"
                  value={webhookOutcome}
                  onChange={(e) => setWebhookOutcome(e.target.value as typeof webhookOutcome)}
                >
                  <option value="succeeded">succeeded</option>
                  <option value="failed">failed</option>
                </Select>
              </div>
              <div className="col-span-4 flex items-end">
                <Button
                  variant="secondary"
                  loading={webhook.isPending}
                  disabled={!(webhookExecution || lastPurchaseExecution)}
                  onClick={() =>
                    void webhook
                      .mutateAsync({
                        executionId: webhookExecution || lastPurchaseExecution,
                        outcome: webhookOutcome,
                      })
                      .then(record('mock webhook'))
                  }
                >
                  Deliver webhook (twice-safe)
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <aside className="col-span-4 flex flex-col gap-4">
          <Card title="State">
            <KeyValue
              dense
              items={[
                { label: 'Server time', value: demo.data ? formatDateTime(demo.data.now) : '…' },
                {
                  label: 'Clock offset',
                  value: demo.data ? `${demo.data.clockOffsetMinutes} min` : '…',
                },
                { label: 'Payment mode', value: demo.data?.paymentMode ?? '…' },
                { label: 'Agent mode', value: demo.data?.agentMode ?? '…' },
                { label: 'Processor calls', value: demo.data?.paymentCalls ?? 0 },
                {
                  label: 'Payment behavior',
                  value: demo.data?.paymentBehavior
                    ? demo.data.paymentBehavior.outcome
                    : 'succeed (default)',
                },
                { label: 'Captured requests', value: demo.data?.capturedRequests.length ?? 0 },
              ]}
            />
            {anyPending ? <p className="mt-2 text-[12px] text-cobalt">Working…</p> : null}
          </Card>
          <Card
            title="Last result"
            description={
              last
                ? `${last.label} · ${formatDateTime(last.at)}`
                : 'Run a control to see its outcome'
            }
          >
            {last ? <ResultSummary value={last.value} /> : null}
            {last ? (
              <details className="mt-2">
                <summary className="text-[12px] font-medium text-cobalt">Raw response</summary>
                <Mono className="mt-1 block max-h-72 overflow-auto whitespace-pre">
                  {JSON.stringify(last.value, null, 2)}
                </Mono>
              </details>
            ) : null}
          </Card>
        </aside>
      </div>
    </>
  );
}

function ResultSummary({ value }: { value: unknown }) {
  const list = Array.isArray(value) ? (value as DemoDirectAttemptResult[]) : null;
  if (list) {
    return (
      <ul className="space-y-1.5">
        {list.map((r, i) => (
          <li key={i} className="text-[13px]">
            <span className="font-mono text-[11.5px] text-ink-faint">HTTP {r.status}</span>{' '}
            {r.purchase ? (
              <DecisionBadge
                decision={r.purchase.decision}
                state={r.purchase.state}
                reasonCode={r.purchase.reasonCode}
              />
            ) : (
              <Badge tone="destructive">
                {(r.response as { error?: { code?: string } })?.error?.code ?? 'error'}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    );
  }
  const v = value as Partial<DemoDirectAttemptResult & DemoAttemptResult> | undefined;
  if (!v) return null;
  const purchase = v.purchase;
  return (
    <div className="space-y-1.5 text-[13px]">
      {typeof v.status === 'number' ? (
        <p>
          <span className="font-mono text-[11.5px] text-ink-faint">HTTP {v.status}</span>{' '}
          {!purchase ? (
            <Badge tone="destructive">
              {(v.response as { error?: { code?: string; message?: string } })?.error?.code ??
                'rejected'}
            </Badge>
          ) : null}
        </p>
      ) : null}
      {v.outcome ? (
        <>
          <p>
            Agent outcome:{' '}
            <Badge tone={v.outcome === 'PURCHASE_REQUESTED' ? 'info' : 'neutral'}>
              {v.outcome}
            </Badge>{' '}
            {v.mode ? (
              <span className="text-ink-faint">
                ({v.mode}
                {v.fallbackUsed ? ', fallback' : ''})
              </span>
            ) : null}
          </p>
          {v.consideredOfferIds ? (
            <p className="text-ink-faint">
              Considered {v.consideredOfferIds.length} offer
              {v.consideredOfferIds.length === 1 ? '' : 's'} across {v.marketsSearched?.length ?? 0}{' '}
              market
              {(v.marketsSearched?.length ?? 0) === 1 ? '' : 's'}
              {v.marketsSearched && v.marketsSearched.length > 0
                ? ` (${v.marketsSearched.join(', ')})`
                : ''}
              .
            </p>
          ) : null}
          {v.selectionReason ? (
            <p className="rounded-md border border-line bg-ground px-2.5 py-1.5 text-ink">
              <span className="font-medium">Agent's reasoning:</span> {v.selectionReason}
            </p>
          ) : null}
        </>
      ) : null}
      {purchase ? (
        <p className="flex flex-wrap items-center gap-1.5">
          <DecisionBadge
            decision={purchase.decision}
            state={purchase.state}
            reasonCode={purchase.reasonCode}
          />
          <Link
            className="text-[12px] text-cobalt hover:underline"
            to={`/verify?executionId=${purchase.executionId}`}
          >
            merchant view
          </Link>
          <span className="text-ink-faint">·</span>
          <Link
            className="text-[12px] text-cobalt hover:underline"
            to={`/audit?executionId=${purchase.executionId}`}
          >
            evidence
          </Link>
          {purchase.state === 'SUCCEEDED' ||
          purchase.state === 'PAYMENT_PENDING' ||
          purchase.state === 'FAILED' ? (
            <>
              <span className="text-ink-faint">·</span>
              <Link
                className="text-[12px] text-cobalt hover:underline"
                to={`/dashboard/purchases/${purchase.executionId}`}
              >
                receipt
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {v.signedRequest ? (
        <p className="font-mono text-[11.5px] text-ink-faint">
          nonce {shortId(v.signedRequest.nonce, 12)} · key {shortId(v.signedRequest.keyid, 12)}
        </p>
      ) : null}
      {(v as { error?: { message?: string } }).error?.message ? (
        <p className="text-coral">{(v as { error?: { message?: string } }).error?.message}</p>
      ) : null}
    </div>
  );
}
