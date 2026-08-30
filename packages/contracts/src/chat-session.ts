import { z } from 'zod';
import { MandateChatDraftSchema } from './chat.js';
import { ReviseMandateRequestSchema } from './human.js';

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

/** One rule the person asked to change on a signed plan, in their words (from → to). */
export const ChatRevisionChangeSchema = z.strictObject({
  field: z.enum([
    'maximumPrice',
    'purchaseCount',
    'validUntil',
    'outsideRules',
    'departureDates',
    'dateFlexibility',
    'passengerCount',
    'departureTime',
  ]),
  from: z.string(),
  to: z.string(),
});
export type ChatRevisionChange = z.infer<typeof ChatRevisionChangeSchema>;

/**
 * A change the chat has captured but that is NOT in force: the signed policy stays exactly as it
 * is until the person confirms on the plan card, which re-signs the plan as a new version.
 */
export const ChatPendingRevisionSchema = z.strictObject({
  changes: z.array(ChatRevisionChangeSchema).min(1),
  request: ReviseMandateRequestSchema,
});
export type ChatPendingRevision = z.infer<typeof ChatPendingRevisionSchema>;

export const ChatSessionViewSchema = ChatSessionSummarySchema.extend({
  messages: z.array(ChatSessionMessageViewSchema),
  draft: MandateChatDraftSchema.nullable(),
  pendingRevision: ChatPendingRevisionSchema.nullable(),
});
export type ChatSessionView = z.infer<typeof ChatSessionViewSchema>;

export const ChatRevisionActionRequestSchema = z.strictObject({
  action: z.enum(['confirm', 'discard']),
});
export type ChatRevisionActionRequest = z.infer<typeof ChatRevisionActionRequestSchema>;

export const SendChatMessageRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(1_000),
});
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequestSchema>;

export const LinkChatMandateRequestSchema = z.strictObject({ mandateId: z.uuid() });
export type LinkChatMandateRequest = z.infer<typeof LinkChatMandateRequestSchema>;
