import { z } from 'zod';
import { ReasonCodeSchema } from './policy.js';

export const AUDIT_EVENT_TYPES = [
  'MANDATE_CREATED',
  'MANDATE_ACTIVATED',
  'MANDATE_REVISED',
  'MANDATE_REVOKED',
  'AGENT_REQUEST_RECEIVED',
  'AGENT_SIGNATURE_VERIFIED',
  'AGENT_SIGNATURE_REJECTED',
  'NONCE_ACCEPTED',
  'REPLAY_REJECTED',
  'POLICY_EVALUATED',
  'APPROVAL_REQUESTED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'USAGE_RESERVED',
  'USAGE_CONSUMED',
  'USAGE_RELEASED',
  'PAYMENT_REQUESTED',
  'PAYMENT_PENDING',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'BOOKING_REQUESTED',
  'BOOKING_PENDING',
  'BOOKING_CONFIRMED',
  'BOOKING_FAILED',
  'WEBHOOK_RECEIVED',
  'WEBHOOK_DUPLICATE',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
] as const;
export const AuditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const ActorTypeSchema = z.enum(['HUMAN', 'AGENT', 'MERCHANT', 'SYSTEM', 'PROVIDER', 'DEMO']);
export type ActorType = z.infer<typeof ActorTypeSchema>;

/** One appended, hash-chained audit event (CLAUDE_IMPLEMENTATION_SPEC.md §15). */
export const AuditEventSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().min(1),
  eventType: AuditEventTypeSchema,
  occurredAt: z.iso.datetime(),
  actorType: ActorTypeSchema,
  actorId: z.string().nullable(),
  mandateId: z.uuid().nullable(),
  mandateVersion: z.number().int().nullable(),
  executionId: z.uuid().nullable(),
  checkoutId: z.uuid().nullable(),
  paymentId: z.uuid().nullable(),
  reasonCode: ReasonCodeSchema.nullable(),
  summary: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  previousHash: z.string(),
  hash: z.string().min(1),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
