import type {
  CreateMandateRequest,
  FlightOfferView,
  MandateChatDraft,
  MandateChatMessage,
  MandateChatResponse,
  MandateView,
  MeResponse,
} from '@authera/contracts';
import {
  ArrowRight,
  Bot,
  Clock3,
  ExternalLink,
  LockKeyhole,
  Plane,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Square,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  useApprovals,
  useAuditEvents,
  useCreateMandate,
  useDemoAttempt,
  useInterpretMandateChat,
  useMandates,
  useMe,
  useOffers,
  usePurchases,
  useRevokeMandate,
} from '../api/hooks.js';
import { findOverBudgetFlightRecommendation, offerMatches } from '../components/price-watch.js';
import { Timeline } from '../components/status.js';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  ErrorState,
  KeyValue,
  Skeleton,
  buttonStyles,
} from '../components/ui/primitives.js';
import { cn } from '../lib/cn.js';
import { formatDate, formatDateTime, formatMoney, friendlyAgentName } from '../lib/format.js';
import { intentLabel, offerHeadline, offerInScope } from '../lib/intent.js';
import { selectDashboardPlans } from '../lib/mandates.js';

type LocalMessage = MandateChatMessage & { id: string; tone?: 'normal' | 'error' };

const STARTERS = [
  'Watch a flight from Caracas to Córdoba next month under $150, valid until the end of the month. Ask me if it is outside the rules.',
  'Buy one pair of wool running shoes for up to $120 before the end of the month. Ask me if it costs more.',
] as const;

export function ChatPage() {
  const me = useMe();
  const mandates = useMandates();
  const offers = useOffers();
  const approvals = useApprovals();
  const purchases = usePurchases();
  const interpret = useInterpretMandateChat();
  const create = useCreateMandate();
  const runAgent = useDemoAttempt();
  const { livePlan, plan } = selectDashboardPlans(mandates.data);
  const revoke = useRevokeMandate(livePlan?.id ?? '');
  const events = useAuditEvents({ mandateId: plan?.id, limit: 20, enabled: Boolean(plan) });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draftResult, setDraftResult] = useState<MandateChatResponse | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const firstName = me.data?.user.displayName.split(' ')[0] ?? 'there';
  const pendingApprovals = approvals.data?.filter((approval) => approval.state === 'PENDING') ?? [];
  const completedPurchase = purchases.data?.find(
    (purchase) => purchase.mandateId === plan?.id && purchase.state === 'SUCCEEDED',
  );
  const scopedOffers =
    plan && offers.data
      ? offers.data
          .filter((offer) => offerInScope(offer, plan.policy.intent))
          .sort((left, right) => left.total.minor - right.total.minor)
      : [];
  const eligibleOffer = plan && scopedOffers.find((offer) => offerMatches(offer, plan).eligible);
  const recommendation = livePlan
    ? findOverBudgetFlightRecommendation(offers.data ?? [], livePlan)
    : undefined;
  const bestOffer = eligibleOffer ?? recommendation?.offer ?? scopedOffers[0];
  const busy = interpret.isPending || runAgent.isPending;

  const transcript = useMemo<MandateChatMessage[]>(
    () => messages.map(({ role, content }) => ({ role, content })).slice(-15),
    [messages],
  );

  const addMessage = (message: Omit<LocalMessage, 'id'>) => {
    setMessages((current) => [...current, { ...message, id: crypto.randomUUID() }]);
  };

  const submitText = async (raw: string) => {
    const content = raw.trim();
    if (!content || busy) return;
    setInput('');
    const userMessage: MandateChatMessage = { role: 'user', content };
    addMessage(userMessage);

    if (livePlan && /\b(stop|revoke|cancel)\b.*\b(plan|mandate|watch)/i.test(content)) {
      addMessage({
        role: 'assistant',
        content: 'I will show the trusted stop confirmation. Nothing changes until you confirm it.',
      });
      setRevokeOpen(true);
      return;
    }

    if (livePlan && /\b(check|search|look|run|try)\b/i.test(content)) {
      if (!me.data?.demoMode) {
        addMessage({
          role: 'assistant',
          content:
            'Price monitoring is already active. I will report the next verified provider update here.',
        });
        return;
      }
      try {
        const result = await runAgent.mutateAsync({ mandateId: livePlan.id });
        const runRecommendation = 'recommendation' in result ? result.recommendation : undefined;
        const content = result.purchase
          ? result.purchase.decision === 'ALLOW'
            ? 'The gateway accepted the request. Payment and fulfillment status will appear from the provider events below.'
            : result.purchase.decision === 'REQUIRE_HUMAN'
              ? 'I found an offer outside the standing rules and stopped before payment. Review the exact one-time approval below.'
              : 'The gateway blocked the attempt. No payment was authorized.'
          : runRecommendation
            ? `No offer matched the hard limit. The closest verified option is ${formatMoney({ currency: runRecommendation.currency, minor: runRecommendation.totalMinor })}, so I did not request a purchase.`
            : 'I checked the connected markets, but no verified offer currently satisfies every rule.';
        addMessage({ role: 'assistant', content });
      } catch (error) {
        addMessage({
          role: 'assistant',
          tone: 'error',
          content:
            error instanceof Error
              ? `I could not complete that provider check: ${error.message}`
              : 'I could not complete that provider check. Try again.',
        });
      }
      return;
    }

    try {
      const result = await interpret.mutateAsync({
        messages: [...transcript, userMessage],
        draft: draftResult?.draft ?? null,
      });
      setDraftResult(result);
      addMessage({ role: 'assistant', content: result.reply });
    } catch (error) {
      addMessage({
        role: 'assistant',
        tone: 'error',
        content:
          error instanceof Error
            ? `I could not interpret that safely: ${error.message}. Your message was not turned into authority.`
            : 'I could not interpret that safely. Your message was not turned into authority.',
      });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitText(input);
  };

  const authorize = async () => {
    if (!draftResult?.complete || !me.data) return;
    const request = requestFromDraft(draftResult.draft, me.data);
    if (!request) return;
    try {
      const created = await create.mutateAsync(request);
      setAuthorizeOpen(false);
      setDraftResult(null);
      addMessage({
        role: 'assistant',
        content: `${agentName} can now search under plan ${created.id.slice(0, 8)}. The signed rules—not this conversation—control every purchase attempt.`,
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        tone: 'error',
        content:
          error instanceof Error
            ? `The trusted surface did not activate the plan: ${error.message}`
            : 'The trusted surface did not activate the plan.',
      });
      setAuthorizeOpen(false);
    }
  };

  const confirmRevoke = async () => {
    if (!livePlan) return;
    try {
      await revoke.mutateAsync({ reason: 'Stopped from the Authera conversation' });
      setRevokeOpen(false);
      addMessage({
        role: 'assistant',
        content: 'The plan is stopped. Every later purchase attempt under this mandate will fail.',
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        tone: 'error',
        content:
          error instanceof Error
            ? `The plan could not be stopped: ${error.message}`
            : 'The plan could not be stopped.',
      });
      setRevokeOpen(false);
    }
  };

  if (me.isError || mandates.isError) {
    return (
      <ErrorState
        error={me.error ?? mandates.error}
        retry={() => {
          void me.refetch();
          void mandates.refetch();
        }}
      />
    );
  }

  if (me.isPending || mandates.isPending) return <ChatSkeleton />;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8.5rem)] w-full max-w-4xl flex-col">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold tracking-wide text-cobalt uppercase">
            Authera assistant
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            What can I take care of, {firstName}?
          </h1>
        </div>
      </header>

      <main
        className="flex-1 space-y-4 pb-36"
        aria-live="polite"
        aria-label="Conversation with Aria"
      >
        {!plan ? (
          <AgentBubble>
            <p>
              Tell me what you want to buy in your own words. I can draft the rules and search, but
              only the trusted Authera gateway can authorize a payment.
            </p>
            {messages.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <StarterButton icon={Plane} onClick={() => void submitText(STARTERS[0])}>
                  Watch a flight
                </StarterButton>
                <StarterButton icon={ShoppingBag} onClick={() => void submitText(STARTERS[1])}>
                  Shop for a product
                </StarterButton>
              </div>
            ) : null}
          </AgentBubble>
        ) : null}

        {plan ? (
          <AgentBubble>
            <p className="mb-3">
              {livePlan
                ? `Your signed plan is active. ${agentName} can search, but every checkout is checked against these rules.`
                : 'This plan is complete. Its receipt and authorization evidence remain available.'}
            </p>
            <ActivePlanCard
              plan={plan}
              active={Boolean(livePlan)}
              onStop={() => setRevokeOpen(true)}
            />
          </AgentBubble>
        ) : null}

        {bestOffer && plan && !completedPurchase ? (
          <AgentBubble>
            <p className="mb-3">
              {eligibleOffer
                ? 'A provider-verified offer currently matches every standing rule.'
                : recommendation
                  ? 'Nothing matches the hard limit. This is the closest option in the recommendation band; it is not authorized.'
                  : 'This provider result is outside one or more signed rules, so it is not authorized.'}
            </p>
            <VerifiedOfferCard offer={bestOffer} plan={plan} eligible={Boolean(eligibleOffer)} />
          </AgentBubble>
        ) : null}

        {pendingApprovals.map((approval) => (
          <AgentBubble key={approval.id} tone="attention">
            <p className="font-medium">I stopped before payment because this offer needs you.</p>
            <p className="mt-1 text-ink-muted">
              {formatMoney(approval.requested)} is {formatMoney(approval.difference)} above your
              standing limit. Approval applies only to the exact checkout.
            </p>
            <Link
              to={`/dashboard/approvals/${approval.id}`}
              className={buttonStyles({ size: 'sm', className: 'mt-3' })}
            >
              Review exact offer <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </AgentBubble>
        ))}

        {completedPurchase ? (
          <AgentBubble tone="success">
            <p className="font-medium">Purchase complete</p>
            <div className="mt-3 rounded-md border border-emerald/20 bg-surface p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Badge tone="verified">Payment and fulfillment confirmed</Badge>
                  <p className="mt-2 font-semibold text-ink">
                    {completedPurchase.offerSummary ?? 'Verified purchase'}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink-muted">
                    Authorized under plan v{plan?.version}
                  </p>
                </div>
                <p className="tabular text-xl font-semibold text-emerald">
                  {formatMoney(completedPurchase.amount)}
                </p>
              </div>
              <Link
                to={`/dashboard/purchases/${completedPurchase.id}`}
                className={buttonStyles({ variant: 'secondary', size: 'sm', className: 'mt-4' })}
              >
                Open receipt and proof <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </AgentBubble>
        ) : null}

        {events.data && events.data.length > 0 ? (
          <AgentBubble subdued>
            <details>
              <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
                <span>Verified activity from the gateway</span>
                <Badge tone="info">{events.data.length} events</Badge>
              </summary>
              <div className="mt-2 border-t border-line pt-2">
                <Timeline events={events.data} limit={6} showLinks={false} plainLanguage />
              </div>
            </details>
          </AgentBubble>
        ) : null}

        {messages.map((message) =>
          message.role === 'user' ? (
            <UserBubble key={message.id}>{message.content}</UserBubble>
          ) : (
            <AgentBubble key={message.id} tone={message.tone === 'error' ? 'error' : undefined}>
              {message.content}
            </AgentBubble>
          ),
        )}

        {draftResult ? (
          <AgentBubble>
            <MandateDraftCard
              result={draftResult}
              onAuthorize={() => setAuthorizeOpen(true)}
              onDiscard={() => setDraftResult(null)}
            />
          </AgentBubble>
        ) : null}

        {busy ? (
          <AgentBubble subdued>
            <div className="flex items-center gap-2 text-ink-muted" role="status">
              <span className="flex gap-1" aria-hidden>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt [animation-delay:240ms]" />
              </span>
              {runAgent.isPending ? 'Checking authoritative providers…' : 'Preparing a safe draft…'}
            </div>
          </AgentBubble>
        ) : null}
      </main>

      <div className="sticky bottom-20 z-10 mt-6 pb-3 md:bottom-24">
        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-line-strong bg-surface p-2 shadow-lg shadow-ink/5"
        >
          <div className="flex items-end gap-2">
            <label htmlFor="chat-message" className="sr-only">
              Message {agentName}
            </label>
            <textarea
              ref={composer}
              id="chat-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitText(input);
                }
              }}
              rows={1}
              disabled={busy}
              placeholder={
                livePlan
                  ? 'Ask Aria to check now, or describe another purchase…'
                  : 'Describe what you want to buy…'
              }
              className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-60"
            />
            <Button type="submit" disabled={!input.trim() || busy} aria-label="Send message">
              <Send className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-1 hidden min-w-0 items-center gap-1.5 border-t border-line px-2 pt-1.5 text-[11.5px] text-ink-muted sm:flex">
            <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Chat drafts; signed rules authorize
          </p>
        </form>
      </div>

      <AuthorizeDialog
        open={authorizeOpen}
        result={draftResult}
        me={me.data}
        loading={create.isPending}
        onClose={() => setAuthorizeOpen(false)}
        onAuthorize={() => void authorize()}
      />
      <Dialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Stop this plan?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRevokeOpen(false)}>
              Keep active
            </Button>
            <Button
              variant="destructive"
              loading={revoke.isPending}
              onClick={() => void confirmRevoke()}
            >
              Stop plan now
            </Button>
          </>
        }
      >
        <Alert tone="destructive" title="Future attempts will fail">
          This immediately revokes the mandate. Completed purchases remain in your records, but
          {` ${agentName}`} cannot start another purchase under these rules.
        </Alert>
      </Dialog>
    </div>
  );
}

function requestFromDraft(draft: MandateChatDraft, me: MeResponse): CreateMandateRequest | null {
  const paymentMethodId = me.paymentMethods[0]?.id;
  if (
    !draft.category ||
    !draft.maxPerPurchaseMinor ||
    !draft.currency ||
    !draft.maxFulfillments ||
    !draft.validUntil ||
    !draft.escalation ||
    !paymentMethodId
  ) {
    return null;
  }
  const merchants = me.merchants.filter((merchant) =>
    draft.category === 'flight' ? merchant.slug === 'duffel' : merchant.slug !== 'duffel',
  );
  if (merchants.length === 0) return null;
  const intent: CreateMandateRequest['intent'] | null =
    draft.category === 'flight'
      ? draft.origin &&
        draft.destination &&
        draft.departureDateFrom &&
        draft.departureDateTo &&
        draft.passengerCount
        ? {
            type: 'flight',
            origin: draft.origin,
            destination: draft.destination,
            cabin: 'economy',
            departureDateFrom: draft.departureDateFrom,
            departureDateTo: draft.departureDateTo,
            dateFlexibilityDays: draft.dateFlexibilityDays ?? 0,
            passengerCount: draft.passengerCount,
          }
        : null
      : draft.query && draft.maxQuantity
        ? { type: 'goods', query: draft.query, maxQuantity: draft.maxQuantity }
        : null;
  if (!intent) return null;
  return {
    paymentMethodId,
    allowedMerchantIds: merchants.map((merchant) => merchant.id),
    intent,
    limits: {
      currency: draft.currency,
      maxPerPurchaseMinor: draft.maxPerPurchaseMinor,
      maxTotalMinor: draft.maxPerPurchaseMinor * draft.maxFulfillments,
      maxFulfillments: draft.maxFulfillments,
    },
    validUntil: draft.validUntil,
    escalation: draft.escalation,
  };
}

function AgentBubble({
  children,
  tone,
  subdued,
}: {
  children: ReactNode;
  tone?: 'attention' | 'success' | 'error';
  subdued?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cobalt text-white">
        <Bot className="h-4 w-4" aria-hidden />
      </span>
      <div
        className={cn(
          'max-w-[min(100%,44rem)] rounded-lg rounded-tl-sm border px-4 py-3 text-[13.5px] leading-6',
          subdued && 'border-line bg-surface-muted/70',
          !subdued && !tone && 'border-line bg-surface',
          tone === 'attention' && 'border-amber/25 bg-amber-soft/60',
          tone === 'success' && 'border-emerald/25 bg-emerald-soft/50',
          tone === 'error' && 'border-coral/25 bg-coral-soft/60 text-coral',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end pl-12">
      <div className="max-w-[min(100%,38rem)] rounded-lg rounded-tr-sm bg-cobalt px-4 py-3 text-[13.5px] leading-6 text-white">
        {children}
      </div>
    </div>
  );
}

function StarterButton({
  icon: Icon,
  children,
  onClick,
}: {
  icon: typeof Plane;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-[12.5px] font-medium text-ink transition-colors hover:bg-cobalt-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
    >
      <Icon className="h-4 w-4 text-cobalt" aria-hidden />
      {children}
    </button>
  );
}

function ActivePlanCard({
  plan,
  active,
  onStop,
}: {
  plan: MandateView;
  active: boolean;
  onStop: () => void;
}) {
  return (
    <section className="rounded-md border border-line bg-surface-muted/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Badge tone={active ? 'verified' : 'neutral'}>
            {active ? 'Signed and active' : 'Complete'}
          </Badge>
          <h2 className="mt-2 text-[16px] font-semibold text-ink">
            {intentLabel(plan.policy.intent)}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Up to{' '}
            {formatMoney({
              currency: plan.policy.limits.currency,
              minor: plan.policy.limits.maxPerPurchaseMinor,
            })}{' '}
            · {plan.usage.remainingCount} use{plan.usage.remainingCount === 1 ? '' : 's'} left ·
            expires {formatDate(plan.policy.validUntil)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/dashboard/mandates/${plan.id}`}
            className={buttonStyles({ variant: 'secondary', size: 'sm' })}
          >
            View rules
          </Link>
          {active ? (
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="h-3.5 w-3.5" aria-hidden /> Stop
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-muted">
        <ShieldCheck className="h-4 w-4 text-emerald" aria-hidden />
        Agent identity, checkout, live mandate state, and allowance are checked before payment.
      </div>
    </section>
  );
}

function VerifiedOfferCard({
  offer,
  plan,
  eligible,
}: {
  offer: FlightOfferView;
  plan: MandateView;
  eligible: boolean;
}) {
  const source =
    offer.source === 'duffel'
      ? 'Duffel test API'
      : offer.source === 'shopify'
        ? 'Live Shopify storefront'
        : 'Judge-injected scenario offer';
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={offer.source === 'demo' ? 'info' : 'verified'}>{source}</Badge>
            <Badge tone={eligible ? 'verified' : 'attention'}>
              {eligible ? 'Within your rules' : 'Not authorized'}
            </Badge>
          </div>
          <p className="mt-2 font-semibold text-ink">{offerHeadline(offer)}</p>
          <p className="text-[12.5px] text-ink-muted">
            {offer.kind === 'flight' ? `${offer.origin} → ${offer.destination}` : offer.title}
            {' · '}
            {offer.merchantName}
          </p>
        </div>
        <div className="text-right">
          <p
            className={cn('tabular text-xl font-semibold', eligible ? 'text-emerald' : 'text-ink')}
          >
            {formatMoney(offer.total)}
          </p>
          <p className="text-[11.5px] text-ink-muted">
            Limit{' '}
            {formatMoney({
              currency: plan.policy.limits.currency,
              minor: plan.policy.limits.maxPerPurchaseMinor,
            })}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[11.5px] text-ink-muted">
        <span className="flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" aria-hidden /> Retrieved {formatDateTime(offer.createdAt)}
        </span>
        <span>Expires {formatDateTime(offer.expiresAt)}</span>
        <span className="font-mono">{offer.providerOfferId ?? offer.id.slice(0, 12)}</span>
      </div>
    </section>
  );
}

function MandateDraftCard({
  result,
  onAuthorize,
  onDiscard,
}: {
  result: MandateChatResponse;
  onAuthorize: () => void;
  onDiscard: () => void;
}) {
  const draft = result.draft;
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cobalt" aria-hidden />
          <h2 className="font-semibold text-ink">Draft purchase plan</h2>
        </div>
        <Badge tone={result.complete ? 'verified' : 'attention'}>
          {result.complete
            ? 'Ready to review'
            : `${result.missingFields.length} detail${result.missingFields.length === 1 ? '' : 's'} missing`}
        </Badge>
      </div>
      <div className="mt-3 rounded-md border border-line bg-surface-muted/50 p-3">
        <DraftSummary draft={draft} />
      </div>
      <p className="mt-2 text-[11.5px] text-ink-muted">
        {result.interpreter === 'openai'
          ? 'OpenAI prepared this draft. It has no authority until you review and confirm it.'
          : 'The fallback interpreter prepared this draft. Review it carefully before confirming.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {result.complete ? (
          <Button onClick={onAuthorize}>
            <ShieldCheck className="h-4 w-4" aria-hidden /> Review and authorize
          </Button>
        ) : null}
        <Link to="/dashboard/mandates/new" className={buttonStyles({ variant: 'secondary' })}>
          Open detailed editor
        </Link>
        <Button variant="ghost" onClick={onDiscard}>
          Discard draft
        </Button>
      </div>
    </section>
  );
}

function DraftSummary({ draft }: { draft: MandateChatDraft }) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Purchase',
      value:
        draft.category === 'flight'
          ? `${draft.origin ?? '…'} → ${draft.destination ?? '…'} · economy`
          : draft.category === 'goods'
            ? (draft.query ?? 'Product not specified')
            : 'Not specified',
    },
    ...(draft.category === 'flight'
      ? [
          {
            label: 'Travel dates',
            value:
              draft.departureDateFrom && draft.departureDateTo
                ? `${draft.departureDateFrom} → ${draft.departureDateTo}`
                : 'Not specified',
          },
          { label: 'Passengers', value: draft.passengerCount ?? 'Not specified' },
        ]
      : draft.category === 'goods'
        ? [{ label: 'Quantity', value: draft.maxQuantity ?? 'Not specified' }]
        : []),
    {
      label: 'Hard maximum',
      value:
        draft.maxPerPurchaseMinor && draft.currency
          ? formatMoney({ currency: draft.currency, minor: draft.maxPerPurchaseMinor })
          : 'Not specified',
    },
    { label: 'Purchase count', value: draft.maxFulfillments ?? 'Not specified' },
    {
      label: 'Authorization expires',
      value: draft.validUntil ? formatDateTime(draft.validUntil) : 'Not specified',
    },
    {
      label: 'Outside rules',
      value:
        draft.escalation === 'require_human'
          ? 'Stop and ask me once'
          : draft.escalation === 'block'
            ? 'Block'
            : 'Not specified',
    },
  ];
  return <KeyValue dense items={rows} />;
}

function AuthorizeDialog({
  open,
  result,
  me,
  loading,
  onClose,
  onAuthorize,
}: {
  open: boolean;
  result: MandateChatResponse | null;
  me: MeResponse | undefined;
  loading: boolean;
  onClose: () => void;
  onAuthorize: () => void;
}) {
  if (!result) return null;
  const method = me?.paymentMethods[0];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Authorize this purchase plan"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} onClick={onAuthorize}>
            <LockKeyhole className="h-4 w-4" aria-hidden /> Authorize plan
          </Button>
        </>
      }
    >
      <Alert tone="info" title="This confirmation creates authority">
        The conversation only prepared this draft. Authera will sign the exact rules below, bind
        them to Aria, and enforce them independently of the model.
      </Alert>
      <div className="mt-4 rounded-md border border-line bg-surface-muted/45 p-4">
        <DraftSummary draft={result.draft} />
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-line p-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-cobalt-soft text-cobalt">
          <LockKeyhole className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <p className="text-[12px] text-ink-muted">Tokenized payment method</p>
          <p className="font-medium text-ink">
            {method ? `${method.brand} •••• ${method.last4}` : 'No payment method available'}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[11.5px] text-ink-muted">
        Aria receives only identifiers. It never receives the raw card number and cannot change the
        signed maximum, scope, validity, or purchase count.
      </p>
    </Dialog>
  );
}

function ChatSkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4" aria-label="Loading conversation">
      <Skeleton className="h-14 w-2/3" />
      <Skeleton className="h-28 w-3/4" />
      <Skeleton className="ml-auto h-20 w-1/2" />
      <Skeleton className="h-40 w-4/5" />
    </div>
  );
}
