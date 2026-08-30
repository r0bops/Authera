import { z } from 'zod';
import { DecisionSchema, ReasonCodeSchema } from './policy.js';

export const ExecutionStateSchema = z.enum([
  'RECEIVED',
  'AUTHENTICATED',
  'EVALUATED',
  'BLOCKED',
  'REQUIRES_HUMAN',
  'RESERVED',
  'PAYMENT_PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;

export const ReservationStateSchema = z.enum(['RESERVED', 'CONSUMED', 'RELEASED']);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

export const ApprovalStateSchema = z.enum([
  'PENDING',
  'APPROVED',
  'CONSUMED',
  'REJECTED',
  'EXPIRED',
  'REVOKED',
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

/** The only fields an agent may submit (CLAUDE_IMPLEMENTATION_SPEC.md §12). */
export const PurchaseAttemptRequestSchema = z.strictObject({
  executionId: z.uuid(),
  mandateId: z.uuid(),
  offerId: z.uuid(),
  checkoutId: z.uuid(),
  /**
   * The agent's closed Checkout Mandate: a compact JWS signed with the same key as the HTTP
   * signature, binding mandate, offer, checkout, canonical cart hash and total. Required by the
   * gateway; optional in the schema only so a missing one is a policy BLOCK with evidence rather
   * than a 400.
   */
  closedCheckoutJws: z.string().min(1).optional(),
});
export type PurchaseAttemptRequest = z.infer<typeof PurchaseAttemptRequestSchema>;

export const PurchaseAttemptResponseSchema = z.object({
  executionId: z.uuid(),
  decision: DecisionSchema,
  reasonCode: ReasonCodeSchema,
  state: ExecutionStateSchema,
  approvalRequestId: z.uuid().optional(),
  paymentId: z.uuid().optional(),
  evidenceId: z.string().min(1),
});
export type PurchaseAttemptResponse = z.infer<typeof PurchaseAttemptResponseSchema>;
