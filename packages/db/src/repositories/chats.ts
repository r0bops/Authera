import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { MandateChatDraft } from '@authera/contracts';
import type { Database, DbExecutor } from '../client.js';
import { chatMessages, chatSessions, executions, mandates, mandateRuntime } from '../schema.js';

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;

export async function createChatSession(
  db: Database,
  input: {
    id: string;
    userId: string;
    title: string;
    draft: MandateChatDraft;
    userMessage: string;
    assistantMessage: string;
  },
): Promise<ChatSessionRow> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .insert(chatSessions)
      .values({
        id: input.id,
        userId: input.userId,
        title: input.title,
        draft: input.draft as unknown as Record<string, unknown>,
        messageCount: 2,
      })
      .returning();
    if (!session) throw new Error('chat session insert returned no row');
    await tx.insert(chatMessages).values([
      {
        id: randomUUID(),
        sessionId: session.id,
        role: 'user',
        content: input.userMessage,
        position: 1,
      },
      {
        id: randomUUID(),
        sessionId: session.id,
        role: 'assistant',
        content: input.assistantMessage,
        position: 2,
      },
    ]);
    return session;
  });
}

export async function listChatSessionsForUser(
  db: DbExecutor,
  userId: string,
): Promise<ChatSessionRow[]> {
  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt));
}

export async function getChatSessionForUser(
  db: DbExecutor,
  userId: string,
  id: string,
): Promise<ChatSessionRow | undefined> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)));
  return session;
}

export async function listChatMessages(
  db: DbExecutor,
  sessionId: string,
): Promise<ChatMessageRow[]> {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.position));
}

export async function appendChatTurn(
  db: Database,
  input: {
    sessionId: string;
    userId: string;
    title: string;
    draft: MandateChatDraft;
    userMessage: string;
    assistantMessage: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: chatSessions.id, messageCount: chatSessions.messageCount })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.userId, input.userId)))
      .for('update');
    if (!session) return;
    await tx.insert(chatMessages).values([
      {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: 'user',
        content: input.userMessage,
        position: session.messageCount + 1,
      },
      {
        id: randomUUID(),
        sessionId: input.sessionId,
        role: 'assistant',
        content: input.assistantMessage,
        position: session.messageCount + 2,
      },
    ]);
    await tx
      .update(chatSessions)
      .set({
        title: input.title,
        draft: input.draft as unknown as Record<string, unknown>,
        messageCount: session.messageCount + 2,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessions.id, input.sessionId));
  });
}

export async function linkChatSessionToMandate(
  db: Database,
  input: { sessionId: string; userId: string; mandateId: string; assistantMessage: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: chatSessions.id, messageCount: chatSessions.messageCount })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.userId, input.userId)))
      .for('update');
    const [mandate] = await tx
      .select({ id: mandates.id })
      .from(mandates)
      .where(and(eq(mandates.id, input.mandateId), eq(mandates.userId, input.userId)));
    if (!session || !mandate) return false;
    await tx
      .update(chatSessions)
      .set({
        mandateId: input.mandateId,
        messageCount: session.messageCount + 1,
        updatedAt: sql`now()`,
      })
      .where(eq(chatSessions.id, input.sessionId));
    await tx.insert(chatMessages).values({
      id: randomUUID(),
      sessionId: input.sessionId,
      role: 'assistant',
      content: input.assistantMessage,
      position: session.messageCount + 1,
    });
    return true;
  });
}

export async function appendAssistantChatMessage(
  db: Database,
  input: { sessionId: string; userId: string; content: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: chatSessions.id, messageCount: chatSessions.messageCount })
      .from(chatSessions)
      .where(and(eq(chatSessions.id, input.sessionId), eq(chatSessions.userId, input.userId)))
      .for('update');
    if (!session) return false;
    await tx.insert(chatMessages).values({
      id: randomUUID(),
      sessionId: input.sessionId,
      role: 'assistant',
      content: input.content,
      position: session.messageCount + 1,
    });
    await tx
      .update(chatSessions)
      .set({ messageCount: session.messageCount + 1, updatedAt: sql`now()` })
      .where(eq(chatSessions.id, input.sessionId));
    return true;
  });
}

export async function chatSessionLifecycle(
  db: DbExecutor,
  mandateId: string | null,
): Promise<'ACTIVE' | 'BOOKED' | 'REVOKED'> {
  if (!mandateId) return 'ACTIVE';
  const [runtime] = await db
    .select({ status: mandateRuntime.status })
    .from(mandateRuntime)
    .innerJoin(
      mandates,
      and(
        eq(mandates.id, mandateRuntime.mandateId),
        eq(mandates.currentVersion, mandateRuntime.version),
      ),
    )
    .where(eq(mandateRuntime.mandateId, mandateId));
  if (runtime?.status === 'REVOKED') return 'REVOKED';
  const [booked] = await db
    .select({ id: executions.id })
    .from(executions)
    .where(and(eq(executions.mandateId, mandateId), eq(executions.state, 'SUCCEEDED')))
    .limit(1);
  if (booked) return 'BOOKED';
  return 'ACTIVE';
}
