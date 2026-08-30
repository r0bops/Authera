import type {
  CreateMandateRequest,
  MandateChatDraft,
  MandateChatMessage,
  MandateChatResponse,
  MeResponse,
} from '@authera/contracts';
import { Bot, LockKeyhole, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import {
  useCreateMandate,
  useInterpretMandateChat,
  useMandates,
  useMe,
  useRevokeMandate,
} from '../api/hooks.js';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  ErrorState,
  KeyValue,
  Skeleton,
} from '../components/ui/primitives.js';
import { cn } from '../lib/cn.js';
import { formatDateTime, formatMoney, friendlyAgentName } from '../lib/format.js';
import { selectDashboardPlans } from '../lib/mandates.js';

type LocalMessage = MandateChatMessage & { id: string; tone?: 'normal' | 'error' };

export function ChatPage() {
  const me = useMe();
  const mandates = useMandates();
  const interpret = useInterpretMandateChat();
  const create = useCreateMandate();
  const { livePlan } = selectDashboardPlans(mandates.data);
  const revoke = useRevokeMandate(livePlan?.id ?? '');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [draftResult, setDraftResult] = useState<MandateChatResponse | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const firstName = me.data?.user.displayName.split(' ')[0] ?? 'there';
  const busy = interpret.isPending;

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
      addMessage({
        role: 'assistant',
        content:
          'Monitoring is active under your signed rules. Verified attempts appear in Activity, and completed purchases appear in Orders.',
      });
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
        content: `The plan is signed and active. ${agentName} can now search under plan ${created.id.slice(0, 8)}. The signed rules—not this conversation—control every purchase attempt.`,
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
            Where should we fly, {firstName}?
          </h1>
        </div>
      </header>

      <main
        className="flex-1 space-y-4 pb-36"
        aria-live="polite"
        aria-label="Conversation with Aria"
      >
        {messages.length === 0 ? (
          <AgentBubble>
            <p>
              Hi {firstName}. Where are you thinking of going? Tell me naturally—we can work out the
              route, dates, and budget together.
            </p>
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

        {draftResult?.complete ? (
          <AgentBubble>
            <FlightConfirmation
              result={draftResult}
              onAuthorize={() => setAuthorizeOpen(true)}
              onChange={() => composer.current?.focus()}
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
              Preparing a safe draft…
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
              placeholder="Where do you want to fly?"
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
  const merchants = me.merchants.filter((merchant) => merchant.slug === 'duffel');
  if (merchants.length === 0) return null;
  const intent: CreateMandateRequest['intent'] | null =
    draft.origin &&
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

function FlightConfirmation({
  result,
  onAuthorize,
  onChange,
}: {
  result: MandateChatResponse;
  onAuthorize: () => void;
  onChange: () => void;
}) {
  const draft = result.draft;
  return (
    <section className="min-w-0" aria-label="Flight plan ready for review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cobalt" aria-hidden />
          <h2 className="font-semibold text-ink">Here’s the flight plan I understood</h2>
        </div>
        <Badge tone="verified">Ready to review</Badge>
      </div>
      <p className="mt-3 text-ink">{flightSummary(draft)}</p>
      <p className="mt-2 text-[12px] text-ink-muted">
        {result.interpreter === 'openai'
          ? 'I prepared this with AI. It cannot authorize or pay until you confirm the exact rules.'
          : 'I prepared this draft. It cannot authorize or pay until you confirm the exact rules.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onAuthorize}>
          <ShieldCheck className="h-4 w-4" aria-hidden /> Review and authorize
        </Button>
        <Button variant="secondary" onClick={onChange}>
          Change details
        </Button>
      </div>
    </section>
  );
}

function flightSummary(draft: MandateChatDraft): string {
  const route = `${draft.origin ?? 'your origin'} to ${draft.destination ?? 'your destination'}`;
  const dates =
    draft.departureDateFrom && draft.departureDateTo
      ? `${draft.departureDateFrom} through ${draft.departureDateTo}`
      : 'the dates you choose';
  const maximum =
    draft.maxPerPurchaseMinor && draft.currency
      ? formatMoney({ currency: draft.currency, minor: draft.maxPerPurchaseMinor })
      : 'your maximum';
  const outside = draft.escalation === 'block' ? 'block anything outside it' : 'ask you first';
  return `${draft.passengerCount ?? 1} passenger, economy, ${route}, departing ${dates}. The all-in maximum is ${maximum}. I may complete ${draft.maxFulfillments ?? 1} purchase and will ${outside}.`;
}

function DraftSummary({ draft }: { draft: MandateChatDraft }) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Purchase',
      value: draft.category
        ? `${draft.origin ?? '…'} → ${draft.destination ?? '…'} · economy`
        : 'Flight not specified',
    },
    ...(draft.category
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
