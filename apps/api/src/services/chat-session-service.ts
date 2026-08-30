import { randomUUID } from 'node:crypto';
import {
  ChatSessionViewSchema,
  MandateChatDraftSchema,
  type ChatSessionSummary,
  type ChatSessionView,
  type MandateChatDraft,
  type MandateChatMessage,
  type MandateView,
} from '@authera/contracts';
import {
  appendAssistantChatMessage,
  appendChatTurn,
  chatSessionLifecycle,
  createChatSession,
  getChatSessionForUser,
  linkChatSessionToMandate,
  listChatMessages,
  listChatSessionsForUser,
  replaceChatSessionDraft,
  type ChatSessionRow,
  type Database,
  type UserRow,
} from '@authera/db';
import { ApiProblem } from '../http/problem.js';
import {
  describeRevision,
  draftFromPolicy,
  pendingRevisionFor,
  pinSignedDraft,
} from './chat-revision.js';
import type { MandateChatService } from './mandate-chat.js';
import type { MandateService } from './mandate-service.js';

export class ChatSessionService {
  constructor(
    private readonly deps: {
      db: Database;
      chat: MandateChatService;
      mandates: MandateService;
    },
  ) {}

  async create(user: UserRow, message: string): Promise<ChatSessionView> {
    const result = await this.deps.chat.interpret(
      { messages: [{ role: 'user', content: message }], draft: null },
      { personName: firstNameOf(user) },
    );
    const id = randomUUID();
    await createChatSession(this.deps.db, {
      id,
      userId: user.id,
      title: titleFor(result.draft),
      draft: result.draft,
      userMessage: message,
      assistantMessage: result.reply,
    });
    return this.get(user, id);
  }

  async send(user: UserRow, id: string, message: string): Promise<ChatSessionView> {
    const session = await this.row(user, id);
    const lifecycle = await chatSessionLifecycle(this.deps.db, session.mandateId);
    if (lifecycle === 'BOOKED' || lifecycle === 'REVOKED') {
      throw new ApiProblem(
        409,
        'CHAT_ENDED',
        lifecycle === 'BOOKED'
          ? 'This chat ended when the flight was booked'
          : 'This chat ended when its plan was revoked',
      );
    }
    const messages = await listChatMessages(this.deps.db, session.id);
    const draft = session.draft ? MandateChatDraftSchema.parse(session.draft) : null;
    const transcript = messages.slice(-15).map<MandateChatMessage>((item) => ({
      role: item.role as MandateChatMessage['role'],
      content: item.content,
    }));
    transcript.push({ role: 'user', content: message });
    if (session.mandateId && draft) {
      const result = await this.deps.chat.interpret(
        { messages: transcript.slice(-16), draft },
        { signedPlan: true, lifecycle, personName: firstNameOf(user) },
      );
      // The model may capture a requested change, but code decides what a signed plan may touch,
      // and nothing is in force until the person confirms the re-signed version on the plan card.
      const proposed = pinSignedDraft(draft, result.draft);
      const mandate = await this.deps.mandates.get(user, session.mandateId);
      const pending = pendingRevisionFor(proposed, mandate.policy);
      let reply = result.reply;
      if (pending && !/confirm/i.test(reply)) {
        reply = `${reply} Nothing changes until you confirm the update on the plan card.`;
      }
      await appendChatTurn(this.deps.db, {
        sessionId: session.id,
        userId: user.id,
        title: titleFor(draft),
        draft: pending ? proposed : draft,
        userMessage: message,
        assistantMessage: reply,
      });
      return this.get(user, id);
    }
    const result = await this.deps.chat.interpret(
      { messages: transcript.slice(-16), draft },
      { personName: firstNameOf(user) },
    );
    await appendChatTurn(this.deps.db, {
      sessionId: session.id,
      userId: user.id,
      title: titleFor(result.draft),
      draft: result.draft,
      userMessage: message,
      assistantMessage: result.reply,
    });
    return this.get(user, id);
  }

  async list(user: UserRow): Promise<ChatSessionSummary[]> {
    const rows = await listChatSessionsForUser(this.deps.db, user.id);
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  async get(user: UserRow, id: string): Promise<ChatSessionView> {
    const row = await this.row(user, id);
    const messages = await listChatMessages(this.deps.db, row.id);
    const summary = await this.summary(row, messages);
    const draft = row.draft ? MandateChatDraftSchema.parse(row.draft) : null;
    return ChatSessionViewSchema.parse({
      ...summary,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
      draft,
      pendingRevision: await this.pendingRevision(user, row, draft, summary.state),
    });
  }

  /** The person confirms (re-sign as a new version) or discards a change captured in the chat. */
  async revision(
    user: UserRow,
    id: string,
    action: 'confirm' | 'discard',
  ): Promise<ChatSessionView> {
    const session = await this.row(user, id);
    if (!session.mandateId) {
      throw new ApiProblem(409, 'CHAT_HAS_NO_MANDATE', 'This chat has no signed plan to update');
    }
    const mandate = await this.deps.mandates.get(user, session.mandateId);
    const draft = session.draft ? MandateChatDraftSchema.parse(session.draft) : null;
    const pending = pendingRevisionFor(draft, mandate.policy);
    if (!pending) {
      throw new ApiProblem(409, 'CHAT_NO_PENDING_REVISION', 'There is no change waiting');
    }
    if (action === 'discard') {
      const current = draftFromPolicy(mandate.policy);
      if (current) {
        await replaceChatSessionDraft(this.deps.db, {
          sessionId: session.id,
          userId: user.id,
          draft: current,
          assistantMessage: `Kept as signed: ${describeSigned(mandate.policy)}. Nothing changed.`,
        });
      }
      return this.get(user, id);
    }
    const revised = await this.deps.mandates.revise(user, mandate.id, pending.request);
    const current = draftFromPolicy(revised.policy);
    if (current) {
      await replaceChatSessionDraft(this.deps.db, {
        sessionId: session.id,
        userId: user.id,
        draft: current,
        assistantMessage: `Plan updated and re-signed as version ${revised.version}: ${describeRevision(pending.changes)}. The previous version can no longer authorize anything; everything else stays the same.`,
      });
    }
    return this.get(user, id);
  }

  private async pendingRevision(
    user: UserRow,
    row: ChatSessionRow,
    draft: MandateChatDraft | null,
    state: 'ACTIVE' | 'BOOKED' | 'REVOKED',
  ) {
    if (!row.mandateId || state !== 'ACTIVE' || !draft) return null;
    const mandate = await this.deps.mandates.get(user, row.mandateId);
    return pendingRevisionFor(draft, mandate.policy);
  }

  async linkMandate(user: UserRow, id: string, mandateId: string): Promise<ChatSessionView> {
    const linked = await linkChatSessionToMandate(this.deps.db, {
      sessionId: id,
      userId: user.id,
      mandateId,
      assistantMessage:
        "Signed and active — I'm on it. I'll keep checking live fares and tell you here the moment one fits your rules, or if I need your call.",
    });
    if (!linked) throw ApiProblem.notFound('chat or mandate');
    return this.get(user, id);
  }

  async revokeMandate(user: UserRow, id: string): Promise<ChatSessionView> {
    const session = await this.row(user, id);
    if (!session.mandateId) {
      throw new ApiProblem(409, 'CHAT_HAS_NO_MANDATE', 'This chat has no signed plan to revoke');
    }
    await this.deps.mandates.revoke(user, session.mandateId, 'Stopped from the flight chat');
    await appendAssistantChatMessage(this.deps.db, {
      sessionId: session.id,
      userId: user.id,
      content:
        'The plan is revoked. Every later purchase attempt under this mandate will fail. Your conversation and booking records remain available.',
    });
    return this.get(user, id);
  }

  private async row(user: UserRow, id: string): Promise<ChatSessionRow> {
    const session = await getChatSessionForUser(this.deps.db, user.id, id);
    if (!session) throw ApiProblem.notFound('chat');
    return session;
  }

  private async summary(
    row: ChatSessionRow,
    knownMessages?: Awaited<ReturnType<typeof listChatMessages>>,
  ): Promise<ChatSessionSummary> {
    const messages = knownMessages ?? (await listChatMessages(this.deps.db, row.id));
    const draft: MandateChatDraft | null = row.draft
      ? MandateChatDraftSchema.parse(row.draft)
      : null;
    return {
      id: row.id,
      title: row.title,
      state: await chatSessionLifecycle(this.deps.db, row.mandateId),
      mandateId: row.mandateId,
      route:
        draft?.origin && draft.destination
          ? { origin: draft.origin, destination: draft.destination }
          : null,
      lastMessage: messages.at(-1)?.content ?? '',
      messageCount: row.messageCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function describeSigned(policy: MandateView['policy']): string {
  const max = `${policy.limits.currency} ${(policy.limits.maxPerPurchaseMinor / 100).toFixed(2)}`;
  return `up to ${max} per purchase, ${policy.limits.maxFulfillments} purchase(s), valid until ${policy.validUntil.slice(0, 10)}`;
}

function titleFor(draft: MandateChatDraft): string {
  return draft.origin && draft.destination
    ? `${draft.origin} → ${draft.destination}`
    : 'New flight';
}

function firstNameOf(user: UserRow): string | undefined {
  return user.displayName.trim().split(/\s+/)[0] || undefined;
}
