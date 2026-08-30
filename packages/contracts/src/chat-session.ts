import { z } from 'zod';
import { MandateChatDraftSchema } from './chat.js';

export const ChatSessionStateSchema = z.enum(['ACTIVE', 'BOOKED', 'REVOKED']);
export type ChatSessionState = z.infer<typeof ChatSessionStateSchema>;

export const ChatSessionMessageViewSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatSessionMessageView = z.infer<typeof ChatSessionMessageViewSchema>;

export const ChatSessionSummarySchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  state: ChatSessionStateSchema,
  mandateId: z.uuid().nullable(),
  route: z.strictObject({ origin: z.string(), destination: z.string() }).nullable(),
  lastMessage: z.string(),
  messageCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ChatSessionSummary = z.infer<typeof ChatSessionSummarySchema>;

export const ChatSessionViewSchema = ChatSessionSummarySchema.extend({
  messages: z.array(ChatSessionMessageViewSchema),
  draft: MandateChatDraftSchema.nullable(),
});
export type ChatSessionView = z.infer<typeof ChatSessionViewSchema>;

export const SendChatMessageRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(1_000),
});
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;

export const LinkChatMandateRequestSchema = z.strictObject({ mandateId: z.uuid() });
export type LinkChatMandateRequest = z.infer<typeof LinkChatMandateRequestSchema>;
