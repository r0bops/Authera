import { airportLabel } from '../lib/airports.js';
import { mandateChatSuggestions } from '@authera/contracts';
import type {
  ApprovalView,
  ChatPendingRevision,
  ChatSessionMessageView,
  CreateMandateRequest,
  ExecutionSummary,
  MandateChatDraft,
  MeResponse,
} from '@authera/contracts';
import {
  ArrowLeft,
  Bot,
  Check,
  Clock3,
  Download,
  History,
  LockKeyhole,
  Plane,
  Plus,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useApprovals,
  useChatRevision,
  useChatSession,
  useDecideApproval,
  useCreateChat,
  useCreateMandate,
  useLinkChatMandate,
  useMe,
  usePurchases,
  useMandates,
  useRevokeChatMandate,
  useSendChatMessage,
} from '../api/hooks.js';
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
import { TryCase } from '../components/try-case.js';
import { cn } from '../lib/cn.js';
import { formatDateTime, formatMoney, friendlyAgentName, formatDate } from '../lib/format.js';

export function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const me = useMe();
  const chat = useChatSession(chatId);
  const purchases = usePurchases();
  const createChat = useCreateChat();
  const sendChat = useSendChatMessage(chatId);
  const createMandate = useCreateMandate();
  const linkMandate = useLinkChatMandate(chatId);
  const revokeMandate = useRevokeChatMandate(chatId);
  const revision = useChatRevision(chatId);
  const approvals = useApprovals();
  const mandates = useMandates();
  const [input, setInput] = useState('');
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [transientError, setTransientError] = useState<string | null>(null);
  const [authorizeOpen, setAuthorizeOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const session = chat.data;
  const pendingApprovals = (approvals.data ?? []).filter(
    (a) => a.mandateId === session?.mandateId && a.state === 'PENDING',
  );
  const draft = session?.draft ?? null;
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const firstName = me.data?.user.displayName.split(' ')[0] ?? 'there';
  const busy = createChat.isPending || sendChat.isPending;
  const hasSignedPlan = Boolean(session?.mandateId);
  const conversationLocked = session?.state === 'BOOKED' || session?.state === 'REVOKED';
  const completedPurchase = purchases.data?.find(
    (purchase) => purchase.mandateId === session?.mandateId && purchase.state === 'SUCCEEDED',
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [session?.messageCount, pendingUser, busy, hasSignedPlan]);

  useEffect(() => {
    const field = composer.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 112)}px`;
  }, [input]);

  const submitText = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy || conversationLocked) return;
    if (
      hasSignedPlan &&
      (/\b(stop|revoke|cancel)\b.*\b(plan|mandate|watching|authorization)\b/i.test(message) ||
        /\b(stop watching|revoke it)\b/i.test(message))
    ) {
      setInput('');
      setRevokeOpen(true);
      return;
    }
    setInput('');
    setTransientError(null);
    setPendingUser(message);
    try {
      if (chatId) {
        await sendChat.mutateAsync({ message });
      } else {
        const created = await createChat.mutateAsync({ message });
        navigate(`/chats/${created.id}`, { replace: true });
      }
    } catch (error) {
      setInput(message);
      setTransientError(
        error instanceof Error ? error.message : 'I could not save that message. Please try again.',
      );
    } finally {
      setPendingUser(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submitText(input);
  };

  const authorize = async () => {
    if (!chatId || !draft || !me.data) return;
    const request = requestFromDraft(draft, me.data);
    if (!request) {
      setTransientError('This plan is missing a verified provider or payment method.');
      return;
    }
    try {
      const mandate = await createMandate.mutateAsync(request);
      await linkMandate.mutateAsync({ mandateId: mandate.id });
      setAuthorizeOpen(false);
    } catch (error) {
      setTransientError(
        error instanceof Error
          ? `The plan was not linked safely: ${error.message}`
          : 'The plan was not linked safely.',
      );
      setAuthorizeOpen(false);
    }
  };

  const confirmRevoke = async () => {
    try {
      await revokeMandate.mutateAsync();
      setRevokeOpen(false);
    } catch (error) {
      setTransientError(
        error instanceof Error ? error.message : 'The plan could not be revoked. Please try again.',
      );
      setRevokeOpen(false);
    }
  };

  if (me.isError || chat.isError) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <ErrorState
            error={me.error ?? chat.error}
            retry={() => {
              void me.refetch();
              if (chatId) void chat.refetch();
            }}
          />
        </div>
      </div>
    );
  }
  if (me.isPending || (chatId && chat.isPending)) return <ChatSkeleton />;

  return (
    <section className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-ground sm:rounded-lg sm:border sm:border-line sm:bg-surface sm:shadow-sm">
      <ChatHeader
        title={session?.title ?? 'New trip'}
        status={chatStatus(session?.state, hasSignedPlan, busy)}
        hasSession={Boolean(session)}
        canRevoke={hasSignedPlan && session?.state !== 'REVOKED'}
        onRevoke={() => setRevokeOpen(true)}
      />

      <main
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-ground px-4 py-5 sm:px-6 md:px-8"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Conversation with ${agentName}`}
      >
        <div className="mx-auto w-full max-w-3xl space-y-4">
          {!session && !pendingUser ? (
            <WelcomeMessage firstName={firstName} agentName={agentName} />
          ) : null}

          {session?.messages.map((message) => (
            <PersistedMessage key={message.id} message={message} />
          ))}
          {pendingUser ? <UserBubble>{pendingUser}</UserBubble> : null}

          {draft && !hasSignedPlan && isCompleteDraft(draft) ? (
            <AgentBubble>
              <FlightConfirmation
                draft={draft}
                onAuthorize={() => setAuthorizeOpen(true)}
                onChange={() => composer.current?.focus()}
              />
            </AgentBubble>
          ) : null}

          {hasSignedPlan && session?.state === 'ACTIVE' ? (
            <AgentBubble tone="success">
              <ActivePlanCard
                draft={draft}
                agentName={agentName}
                onRevoke={() => setRevokeOpen(true)}
              />
              {(() => {
                const signedPlan = (mandates.data ?? []).find((m) => m.id === session.mandateId);
                return signedPlan ? <TryCase plan={signedPlan} compact /> : null;
              })()}
            </AgentBubble>
          ) : null}

          {hasSignedPlan && session?.state === 'ACTIVE'
            ? pendingApprovals.map((approval) => (
                <AgentBubble key={approval.id}>
                  <ApprovalCard approval={approval} agentName={agentName} />
                </AgentBubble>
              ))
            : null}

          {hasSignedPlan && session?.state === 'ACTIVE' && session.pendingRevision ? (
            <AgentBubble>
              <PlanChangeCard
                pending={session.pendingRevision}
                busy={revision.isPending}
                onConfirm={() => void revision.mutateAsync({ action: 'confirm' })}
                onDiscard={() => void revision.mutateAsync({ action: 'discard' })}
              />
            </AgentBubble>
          ) : null}

          {completedPurchase ? (
            <AgentBubble tone="success">
              <CompletedTripCard
                purchase={completedPurchase}
                revoked={session?.state === 'REVOKED'}
                onRevoke={() => setRevokeOpen(true)}
              />
            </AgentBubble>
          ) : session?.state === 'BOOKED' ? (
            <AgentBubble subdued>
              <div className="flex items-center gap-2 text-ink-muted" role="status">
                <Clock3 className="h-4 w-4" aria-hidden />
                Finalizing your booking record…
              </div>
            </AgentBubble>
          ) : null}

          {session?.state === 'REVOKED' ? (
            <AgentBubble subdued>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Plan revoked</Badge>
                <span className="text-[12px] text-ink-muted">Read-only record</span>
              </div>
              <p className="mt-2 text-ink-muted">
                Every later purchase attempt under this plan will fail. Your conversation
                {completedPurchase ? ' and completed booking remain available.' : ' remains saved.'}
              </p>
              <Link to="/" className={buttonStyles({ variant: 'secondary', className: 'mt-3' })}>
                <Plus className="h-4 w-4" aria-hidden /> Start another trip
              </Link>
            </AgentBubble>
          ) : null}

          {transientError ? (
            <AgentBubble tone="error">
              <p className="font-medium">I couldn’t complete that action.</p>
              <p className="mt-1">{transientError}</p>
              {!conversationLocked ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => composer.current?.focus()}
                >
                  Try again
                </Button>
              ) : null}
            </AgentBubble>
          ) : null}

          {busy ? (
            <AgentBubble subdued>
              <div className="flex items-center gap-2 text-ink-muted" role="status">
                <span className="flex gap-1" aria-hidden>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt motion-reduce:animate-none" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt motion-reduce:animate-none [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cobalt motion-reduce:animate-none [animation-delay:240ms]" />
                </span>
                Working through the details…
              </div>
            </AgentBubble>
          ) : null}
          <div ref={end} />
        </div>
      </main>

      {conversationLocked ? (
        <LockedActions
          state={session?.state}
          canRevoke={hasSignedPlan && session?.state !== 'REVOKED'}
          onRevoke={() => setRevokeOpen(true)}
        />
      ) : (
        <ChatComposer
          composerRef={composer}
          value={input}
          placeholder={composerPrompt(draft, hasSignedPlan)}
          busy={busy}
          agentName={agentName}
          suggestions={
            input.trim() ? [] : mandateChatSuggestions(draft, { signedPlan: hasSignedPlan })
          }
          onSuggestion={(text) => void submitText(text)}
          onChange={setInput}
          onSubmit={onSubmit}
          onSend={() => void submitText(input)}
        />
      )}

      <AuthorizeDialog
        open={authorizeOpen}
        draft={draft}
        me={me.data}
        loading={createMandate.isPending || linkMandate.isPending}
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
              Keep watching
            </Button>
            <Button
              variant="destructive"
              loading={revokeMandate.isPending}
              onClick={() => void confirmRevoke()}
            >
              Stop plan now
            </Button>
          </>
        }
      >
        <Alert tone="destructive" title="Every later attempt will fail">
          Authera will revoke the signed authority immediately. Any completed booking and this
          conversation remain in your records.
        </Alert>
      </Dialog>
    </section>
  );
}

function ChatHeader({
  title,
  status,
  hasSession,
  canRevoke,
  onRevoke,
}: {
  title: string;
  status: string;
  hasSession: boolean;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  return (
    <header className="z-10 flex min-h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-3 py-2 backdrop-blur sm:px-4">
      <Link
        to="/chats"
        aria-label="Open saved chats"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt sm:hidden"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt text-white shadow-sm shadow-cobalt/20">
        <Bot className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-semibold text-ink">{title}</h1>
        <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden />
          {status}
        </p>
      </div>
      {hasSession ? (
        <Link
          to="/"
          aria-label="Start a new trip"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </Link>
      ) : null}
      <Link
        to="/chats"
        aria-label="Open saved chats"
        className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt sm:flex"
      >
        <History className="h-5 w-5" aria-hidden />
      </Link>
      {canRevoke ? (
        <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={onRevoke}>
          Stop plan
        </Button>
      ) : null}
    </header>
  );
}

function WelcomeMessage({ firstName, agentName }: { firstName: string; agentName: string }) {
  return (
    <div className="flex min-h-[50dvh] flex-col justify-end pb-4 sm:min-h-0 sm:justify-start sm:pb-0">
      <AgentBubble>
        <p className="text-[15px] font-semibold text-ink">Hi {firstName}, where should we go?</p>
        <p className="mt-1 text-ink-muted">
          Tell {agentName} what you need in your own words. We’ll agree on the trip, maximum price,
          and safety rules before anything becomes authorized.
        </p>
      </AgentBubble>
    </div>
  );
}

function ChatComposer({
  composerRef,
  value,
  placeholder,
  busy,
  agentName,
  suggestions,
  onSuggestion,
  onChange,
  onSubmit,
  onSend,
}: {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  placeholder: string;
  busy: boolean;
  agentName: string;
  suggestions: string[];
  onSuggestion: (text: string) => void;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onSend: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-4">
      {suggestions.length > 0 && !busy ? (
        <div
          className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap gap-2"
          role="group"
          aria-label="Suggested replies"
        >
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => onSuggestion(text)}
              className="shrink-0 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink hover:border-cobalt hover:text-cobalt focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt/30"
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
      <form
        onSubmit={onSubmit}
        className="mx-auto w-full max-w-3xl rounded-2xl border border-line-strong bg-surface px-2 py-2 shadow-md shadow-ink/5 focus-within:border-cobalt focus-within:ring-2 focus-within:ring-cobalt/20"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="chat-message" className="sr-only">
            Message {agentName}
          </label>
          <textarea
            ref={composerRef}
            id="chat-message"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSend();
              }
            }}
            rows={1}
            maxLength={1_000}
            disabled={busy}
            placeholder={placeholder}
            className="max-h-28 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] leading-6 text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-60 sm:text-[14px]"
          />
          <Button
            type="submit"
            disabled={!value.trim() || busy}
            loading={busy}
            aria-label={busy ? 'Sending message' : 'Send message'}
            className="h-11 w-11 shrink-0 rounded-full px-0"
          >
            {!busy ? <Send className="h-4 w-4" aria-hidden /> : null}
          </Button>
        </div>
      </form>
      <p className="mx-auto mt-2 flex max-w-3xl items-center justify-center gap-1.5 text-[11.5px] text-ink-muted">
        <LockKeyhole className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Chat prepares the plan. Only your confirmation creates authority.
      </p>
    </footer>
  );
}

function LockedActions({
  state,
  canRevoke,
  onRevoke,
}: {
  state: 'ACTIVE' | 'BOOKED' | 'REVOKED' | undefined;
  canRevoke: boolean;
  onRevoke: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-line bg-surface px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-4">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
        <Link to="/" className={buttonStyles({ className: 'flex-1' })}>
          <Plus className="h-4 w-4" aria-hidden /> Start another trip
        </Link>
        {canRevoke ? (
          <Button variant="secondary" className="flex-1" onClick={onRevoke}>
            {state === 'BOOKED' ? 'Revoke remainder' : 'Stop this plan'}
          </Button>
        ) : null}
      </div>
    </footer>
  );
}

function PersistedMessage({ message }: { message: ChatSessionMessageView }) {
  return message.role === 'user' ? (
    <UserBubble>{message.content}</UserBubble>
  ) : (
    <AgentBubble>{message.content}</AgentBubble>
  );
}

function requestFromDraft(draft: MandateChatDraft, me: MeResponse): CreateMandateRequest | null {
  const paymentMethodId = me.paymentMethods[0]?.id;
  if (
    !isCompleteDraft(draft) ||
    !draft.category ||
    !draft.origin ||
    !draft.destination ||
    !draft.departureDateFrom ||
    !draft.departureDateTo ||
    !draft.passengerCount ||
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
  return {
    paymentMethodId,
    allowedMerchantIds: merchants.map((merchant) => merchant.id),
    intent: {
      type: 'flight',
      origin: draft.origin,
      destination: draft.destination,
      cabin: 'economy',
      departureDateFrom: draft.departureDateFrom,
      departureDateTo: draft.departureDateTo,
      dateFlexibilityDays: draft.dateFlexibilityDays ?? 0,
      passengerCount: draft.passengerCount,
      ...(draft.departureTimeFrom && draft.departureTimeTo
        ? { departureTimeFrom: draft.departureTimeFrom, departureTimeTo: draft.departureTimeTo }
        : {}),
      ...(draft.maxDurationMinutes ? { maxDurationMinutes: draft.maxDurationMinutes } : {}),
      ...(draft.maxStops !== null && draft.maxStops !== undefined
        ? { maxStops: draft.maxStops }
        : {}),
    },
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

function isCompleteDraft(draft: MandateChatDraft): boolean {
  return Boolean(
    draft.category &&
    draft.origin &&
    draft.destination &&
    draft.departureDateFrom &&
    draft.departureDateTo &&
    draft.passengerCount &&
    draft.maxPerPurchaseMinor &&
    draft.currency &&
    draft.maxFulfillments &&
    draft.validUntil &&
    draft.escalation,
  );
}

function composerPrompt(draft: MandateChatDraft | null, hasSignedPlan: boolean): string {
  // Short enough for one line on a phone: placeholders never wrap or clip.
  if (hasSignedPlan) return 'Ask about the plan, change a limit, or say “stop”';
  if (!draft?.origin) return 'Where are you flying from?';
  if (!draft.destination) return 'Where do you want to go?';
  if (!draft.departureDateFrom || !draft.departureDateTo) return 'When would you like to travel?';
  if (!draft.maxPerPurchaseMinor) return 'What is your all-in maximum?';
  if (!draft.validUntil) return 'Until when should this stay valid?';
  if (!draft.escalation) return 'Block or ask you if a price is outside?';
  return 'Change a detail, or review the plan';
}

function chatStatus(
  state: 'ACTIVE' | 'BOOKED' | 'REVOKED' | undefined,
  hasSignedPlan: boolean,
  busy: boolean,
): string {
  if (busy) return 'Aria is replying';
  if (state === 'REVOKED') return 'Plan revoked · read-only';
  if (state === 'BOOKED') return 'Trip booked';
  if (hasSignedPlan) return 'Watching verified providers';
  return 'Private planning chat';
}

function AgentBubble({
  children,
  tone,
  subdued,
}: {
  children: ReactNode;
  tone?: 'success' | 'error';
  subdued?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 sm:gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cobalt text-white sm:h-9 sm:w-9">
        <Bot className="h-4 w-4" aria-hidden />
      </span>
      <div
        className={cn(
          'max-w-[calc(100%-2.625rem)] rounded-2xl rounded-tl-sm border px-3.5 py-3 text-[13.5px] leading-6 sm:max-w-[min(88%,44rem)] sm:px-4',
          subdued && 'border-line bg-surface-muted/80',
          !subdued && !tone && 'border-line bg-surface',
          tone === 'success' && 'border-emerald/25 bg-emerald-soft/55',
          tone === 'error' && 'border-coral/25 bg-coral-soft/70 text-coral',
        )}
      >
        {children}
      </div>
    </div>
  );
}

function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end pl-10 sm:pl-16">
      <div className="max-w-[92%] rounded-2xl rounded-tr-sm bg-cobalt px-4 py-3 text-[13.5px] leading-6 text-white sm:max-w-[80%]">
        {children}
      </div>
    </div>
  );
}

function FlightConfirmation({
  draft,
  onAuthorize,
  onChange,
}: {
  draft: MandateChatDraft;
  onAuthorize: () => void;
  onChange: () => void;
}) {
  return (
    <section className="min-w-0" aria-label="Flight plan ready for review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cobalt" aria-hidden />
          <h2 className="font-semibold text-ink">Your plan is ready</h2>
        </div>
        <Badge tone="verified">Draft only</Badge>
      </div>
      <p className="mt-3 text-ink">{flightSummary(draft)}</p>
      <p className="mt-2 text-[12px] text-ink-muted">
        Nothing can be bought until you review and authorize these exact rules.
      </p>
      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        <Button onClick={onAuthorize}>
          <ShieldCheck className="h-4 w-4" aria-hidden /> Review and authorize
        </Button>
        <Button variant="secondary" onClick={onChange}>
          Change details in chat
        </Button>
      </div>
    </section>
  );
}

function ActivePlanCard({
  draft,
  agentName,
  onRevoke,
}: {
  draft: MandateChatDraft | null;
  agentName: string;
  onRevoke: () => void;
}) {
  return (
    <section aria-label="Signed plan status">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald text-white">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <h2 className="font-semibold text-ink">Plan active</h2>
        <Badge tone="verified">Protected</Badge>
      </div>
      <p className="mt-2 text-ink-muted">
        {agentName} is comparing verified providers. Payment can happen only when every signed rule
        passes; anything else is blocked or returned to you.
      </p>
      {draft ? (
        <details className="group mt-3 rounded-lg border border-emerald/20 bg-surface/70">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 py-2 font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt">
            View signed limits
            <span className="text-[11.5px] font-normal text-ink-muted group-open:hidden">
              Optional
            </span>
          </summary>
          <div className="border-t border-emerald/20 px-3 py-3">
            <DraftSummary draft={draft} />
          </div>
        </details>
      ) : null}
      <Button variant="ghost" size="sm" className="mt-2" onClick={onRevoke}>
        Stop this plan
      </Button>
    </section>
  );
}

/** The agent stopped: an offer is over the limit but close. The human decides here, in the chat. */
function ApprovalCard({ approval, agentName }: { approval: ApprovalView; agentName: string }) {
  const decide = useDecideApproval(approval.id);
  const over = formatMoney(approval.difference);
  return (
    <section aria-label="Approve this purchase?">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-ink">
          {agentName} found one at {formatMoney(approval.requested)} — your limit is{' '}
          {formatMoney(approval.limit)}
        </h2>
        <Badge tone="attention">Waiting for you</Badge>
      </div>
      <p className="mt-1 text-ink-muted">
        {approval.offer?.summary ?? approval.mandateSummary}. That is {over} over, so nothing was
        bought. Approve this exact fare once, or keep watching under the signed rules.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          loading={decide.isPending}
          onClick={() => void decide.mutateAsync({ decision: 'APPROVED' })}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden /> Approve {formatMoney(approval.requested)}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={decide.isPending}
          onClick={() => void decide.mutateAsync({ decision: 'REJECTED' })}
        >
          Keep watching
        </Button>
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">
        Approval covers this cart only; your limits stay {formatMoney(approval.limit)}. Expires{' '}
        {formatDateTime(approval.expiresAt)}.
      </p>
    </section>
  );
}

/**
 * A change captured in the chat is only a proposal: the signed rules stay in force until the
 * person confirms here, and confirming re-signs the plan as a new version.
 */
function PlanChangeCard({
  pending,
  busy,
  onConfirm,
  onDiscard,
}: {
  pending: ChatPendingRevision;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <section aria-label="Update the signed plan">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-ink">Update the plan?</h2>
        <Badge tone="attention">Not in force yet</Badge>
      </div>
      <ul className="mt-2 space-y-1 text-ink">
        {pending.changes.map((change) => (
          <li key={change.field} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ink-muted">{REVISION_LABELS[change.field]}</span>
            <span className="line-through decoration-ink-muted/60">{change.from}</span>
            <span aria-hidden>→</span>
            <span className="font-medium">{change.to}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-ink-muted">
        Confirming re-signs the plan as a new version; the current rules apply until then, and the
        old version can never authorize anything again.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={onConfirm}>
          <LockKeyhole className="h-4 w-4" aria-hidden /> Confirm update
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDiscard}>
          Keep current rules
        </Button>
      </div>
    </section>
  );
}

const REVISION_LABELS: Record<ChatPendingRevision['changes'][number]['field'], string> = {
  maximumPrice: 'Maximum price',
  purchaseCount: 'Purchases',
  validUntil: 'Valid until',
  outsideRules: 'Outside the rules',
  departureDates: 'Departure dates',
  dateFlexibility: 'Date flexibility',
  passengerCount: 'Passengers',
  departureTime: 'Departure time',
  maxDuration: 'Total travel time',
  maxStops: 'Stopovers',
};

function CompletedTripCard({
  purchase,
  revoked,
  onRevoke,
}: {
  purchase: ExecutionSummary;
  revoked: boolean;
  onRevoke: () => void;
}) {
  return (
    <section aria-label="Completed booking">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald text-white">
          <Plane className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink">Trip booked safely</h2>
          <p className="text-[12px] text-ink-muted">The verification record is ready.</p>
        </div>
        <Badge tone="verified">Paid</Badge>
      </div>
      <div className="mt-3 rounded-lg border border-emerald/20 bg-surface/75 p-3">
        <p className="font-medium text-ink">
          {purchase.offerSummary ?? 'Verified flight purchase'}
        </p>
        {purchase.amount ? (
          <p className="tabular mt-1 text-xl font-semibold tracking-tight text-emerald">
            {formatMoney(purchase.amount)}
          </p>
        ) : null}
        <p className="mt-1 text-[12px] text-ink-muted">
          Mandate checked · provider verified · payment recorded
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        <a
          href={`/api/purchases/${purchase.id}/receipt.html`}
          download
          className={buttonStyles({ variant: 'secondary' })}
        >
          <ReceiptText className="h-4 w-4" aria-hidden /> Receipt
        </a>
        <a
          href={`/api/purchases/${purchase.id}/stripe-receipt.html`}
          download
          className={buttonStyles({ variant: 'secondary' })}
        >
          <ReceiptText className="h-4 w-4" aria-hidden /> Card receipt
        </a>
        {purchase.bookingState === 'BOOKED' ? (
          <a
            href={`/api/purchases/${purchase.id}/booking-confirmation.html`}
            download
            className={buttonStyles({ variant: 'secondary' })}
          >
            <Download className="h-4 w-4" aria-hidden /> Booking confirmation
          </a>
        ) : null}
        {!revoked ? (
          <Button variant="ghost" size="sm" onClick={onRevoke}>
            Revoke mandate
          </Button>
        ) : null}
      </div>
      <p className="mt-3 text-[12px] text-ink-muted">
        This conversation is complete. You can reopen this record at any time and revoke any
        remaining authority.
      </p>
    </section>
  );
}

/** The plan card restates the draft the way a person would say it, not in codes and ISO dates. */
function flightSummary(draft: MandateChatDraft): string {
  const people =
    (draft.passengerCount ?? 1) === 1
      ? 'One economy flight'
      : `${draft.passengerCount} economy flights`;
  const route = `${airportLabel(draft.origin ?? undefined)} → ${airportLabel(draft.destination ?? undefined)}`;
  const dates =
    draft.departureDateFrom && draft.departureDateTo
      ? `leaving between ${formatDate(draft.departureDateFrom)} and ${formatDate(draft.departureDateTo)}`
      : 'on the dates you choose';
  const extras = [
    draft.departureTimeFrom && draft.departureTimeTo
      ? `departing ${draft.departureTimeFrom}–${draft.departureTimeTo}`
      : null,
    draft.maxStops === 0
      ? 'direct only'
      : draft.maxStops
        ? `at most ${draft.maxStops} stop(s)`
        : null,
    draft.maxDurationMinutes ? `under ${Math.round(draft.maxDurationMinutes / 60)} h` : null,
  ].filter(Boolean);
  const hours = extras.length ? ` (${extras.join(', ')})` : '';
  const maximum =
    draft.maxPerPurchaseMinor && draft.currency
      ? formatMoney({ currency: draft.currency, minor: draft.maxPerPurchaseMinor })
      : 'your maximum';
  const uses =
    (draft.maxFulfillments ?? 1) === 1
      ? 'one purchase'
      : `up to ${draft.maxFulfillments} purchases`;
  const until = draft.validUntil ? `, valid until ${formatDate(draft.validUntil)}` : '';
  const outside =
    draft.escalation === 'block'
      ? 'Anything outside these rules is blocked — except a near miss on price (within about 10 %), which I bring to you first.'
      : 'Anything outside these rules pauses and asks you first.';
  return `${people}, ${route}, ${dates}${hours}, up to ${maximum} all-in — ${uses}${until}. ${outside}`;
}

function DraftSummary({ draft }: { draft: MandateChatDraft }) {
  return (
    <KeyValue
      dense
      items={[
        {
          label: 'Flight',
          value: `${draft.origin ?? '…'} → ${draft.destination ?? '…'} · economy`,
        },
        {
          label: 'Travel dates',
          value:
            draft.departureDateFrom && draft.departureDateTo
              ? `${draft.departureDateFrom} → ${draft.departureDateTo}`
              : 'Not specified',
        },
        { label: 'Passengers', value: draft.passengerCount ?? 'Not specified' },
        {
          label: 'Stopovers',
          value:
            draft.maxStops === 0
              ? 'Direct only'
              : draft.maxStops
                ? `At most ${draft.maxStops}`
                : 'Any',
        },
        {
          label: 'Travel time',
          value: draft.maxDurationMinutes
            ? `Under ${Math.round(draft.maxDurationMinutes / 60)} h`
            : 'Any',
        },
        {
          label: 'Departure time',
          value:
            draft.departureTimeFrom && draft.departureTimeTo
              ? `${draft.departureTimeFrom}–${draft.departureTimeTo} local`
              : 'Any time',
        },
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
      ]}
    />
  );
}

function AuthorizeDialog({
  open,
  draft,
  me,
  loading,
  onClose,
  onAuthorize,
}: {
  open: boolean;
  draft: MandateChatDraft | null;
  me: MeResponse | undefined;
  loading: boolean;
  onClose: () => void;
  onAuthorize: () => void;
}) {
  if (!draft) return null;
  const method = me?.paymentMethods[0];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Review before authorizing"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep editing
          </Button>
          <Button loading={loading} disabled={!method} onClick={onAuthorize}>
            <LockKeyhole className="h-4 w-4" aria-hidden /> Authorize this plan
          </Button>
        </>
      }
    >
      <Alert tone="info" title="This tap creates real authority">
        The conversation prepared a draft. Authera—not the AI—signs and independently enforces the
        exact limits below.
      </Alert>
      <div className="mt-4 rounded-lg border border-line bg-surface-muted/45 p-4">
        <DraftSummary draft={draft} />
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-lg border border-line p-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cobalt-soft text-cobalt">
          <LockKeyhole className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[12px] text-ink-muted">Tokenized payment method</p>
          <p className="truncate font-medium text-ink">
            {method ? `${method.brand} •••• ${method.last4}` : 'No payment method available'}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

function ChatSkeleton() {
  return (
    <div
      className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden bg-surface sm:rounded-lg sm:border sm:border-line"
      aria-label="Loading conversation"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <div className="flex-1 space-y-4 bg-ground px-4 py-5 sm:px-6">
        <Skeleton className="h-24 w-4/5 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" />
        <Skeleton className="h-24 w-4/5 rounded-2xl" />
      </div>
      <div className="border-t border-line p-3">
        <Skeleton className="mx-auto h-14 w-full max-w-3xl rounded-2xl" />
      </div>
    </div>
  );
}
