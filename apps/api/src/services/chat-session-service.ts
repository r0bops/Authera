import { randomUUID } from 'node:crypto';
import {
  ChatSessionViewSchema,
  MandateChatDraftSchema,
  type ChatSessionSummary,
  type ChatSessionView,
  type MandateChatDraft,
  type MandateChatMessage,
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
  type ChatSessionRow,
  type Database,
  type UserRow,
} from '@authera/db';
import { ApiProblem } from '../http/problem.js';
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
      await appendChatTurn(this.deps.db, {
        sessionId: session.id,
        userId: user.id,
        title: titleFor(draft),
        draft,
        userMessage: message,
        assistantMessage: result.reply,
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
    return ChatSessionViewSchema.parse({
      ...summary,
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
      draft: row.draft ? MandateChatDraftSchema.parse(row.draft) : null,
    });
  }

  async linkMandate(user: UserRow, id: string, mandateId: string): Promise<ChatSessionView> {
    const linked = await linkChatSessionToMandate(this.deps.db, {
      sessionId: id,
      userId: user.id,
      mandateId,
      assistantMessage:
        'The plan is signed and active. I will watch for verified flights inside those exact rules.',
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

function titleFor(draft: MandateChatDraft): string {
  return draft.origin && draft.destination
    ? `${draft.origin} → ${draft.destination}`
    : 'New flight';
}

function firstNameOf(user: UserRow): string | undefined {
  return user.displayName.trim().split(/\s+/)[0] || undefined;
}
