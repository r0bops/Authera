import { z } from 'zod';
import { AuditEventSchema } from './audit.js';
import { CheckoutCartSchema } from './checkout.js';
import { ExecutionStateSchema } from './execution.js';
import { BookingViewSchema, FlightOfferViewSchema, PaymentViewSchema } from './gateway.js';
import { MandatePolicyV1Schema, MandateStateSchema } from './mandate.js';
import { MoneySchema } from './money.js';
import { DecisionSchema, PolicyCheckSchema, ReasonCodeSchema } from './policy.js';
import { ApprovalStateSchema } from './execution.js';

export const ApprovalViewSchema = z.object({
  id: z.uuid(),
  state: ApprovalStateSchema,
  executionId: z.uuid(),
  mandateId: z.uuid(),
  mandateVersion: z.number().int(),
  checkoutId: z.uuid(),
  checkoutHash: z.string(),
  reasonCode: ReasonCodeSchema,
  explanation: z.string(),
  requested: MoneySchema,
  limit: MoneySchema,
  difference: MoneySchema,
  offer: FlightOfferViewSchema.nullable(),
  mandateSummary: z.string(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  consumedByExecutionId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type ApprovalView = z.infer<typeof ApprovalViewSchema>;

export const ApprovalDecisionRequestSchema = z.strictObject({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().trim().max(200).optional(),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequestSchema>;

export const DISPUTE_REASONS = [
  'DID_NOT_CREATE_MANDATE',
  'PURCHASE_DID_NOT_MATCH_MANDATE',
  'REVOKED_BEFORE_PURCHASE',
  'UNRECOGNIZED_AGENT',
  'OTHER',
] as const;
export const DisputeReasonSchema = z.enum(DISPUTE_REASONS);
export type DisputeReason = z.infer<typeof DisputeReasonSchema>;

export const CreateDisputeRequestSchema = z.strictObject({
  executionId: z.uuid(),
  reason: DisputeReasonSchema,
  description: z.string().trim().max(1000).optional(),
});
export type CreateDisputeRequest = z.infer<typeof CreateDisputeRequestSchema>;

export const DisputeOutcomeSchema = z.enum(['AUTHORIZED', 'CUSTOMER_SUPPORTED', 'UNRESOLVED']);
export type DisputeOutcome = z.infer<typeof DisputeOutcomeSchema>;

export const DisputeResolutionSchema = z.object({
  outcome: DisputeOutcomeSchema,
  headline: z.string(),
  explanation: z.string(),
  findings: z.array(
    z.object({ label: z.string(), ok: z.boolean().nullable(), detail: z.string() }),
  ),
  timeline: z.array(
    z.object({ at: z.iso.datetime().nullable(), label: z.string(), detail: z.string().nullable() }),
  ),
  evidenceRefs: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type DisputeResolution = z.infer<typeof DisputeResolutionSchema>;

export const DisputeViewSchema = z.object({
  id: z.uuid(),
  executionId: z.uuid(),
  reason: DisputeReasonSchema,
  description: z.string().nullable(),
  state: z.enum(['OPEN', 'RESOLVED', 'ESCALATED']),
  resolution: DisputeResolutionSchema.nullable(),
  evidenceBundleId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
});
export type DisputeView = z.infer<typeof DisputeViewSchema>;

export const EvidenceRoleSchema = z.enum(['human', 'merchant', 'auditor']);
export type EvidenceRole = z.infer<typeof EvidenceRoleSchema>;

export const EvidenceBundleSchema = z.object({
  schema: z.literal('authera.evidence.v1'),
  evidenceId: z.string(),
  executionId: z.uuid(),
  generatedAt: z.iso.datetime(),
  role: EvidenceRoleSchema,
  execution: z.object({
    state: ExecutionStateSchema,
    decision: DecisionSchema.nullable(),
    reasonCode: ReasonCodeSchema.nullable(),
    explanation: z.string().nullable(),
    createdAt: z.iso.datetime(),
    amount: MoneySchema.nullable(),
  }),
  human: z
    .object({
      id: z.uuid(),
      displayName: z.string(),
      email: z.string().nullable(),
      authorization: z.object({
        mandateId: z.uuid(),
        version: z.number().int(),
        policyHash: z.string(),
        signingKid: z.string(),
        jws: z.string().nullable(),
        issuedAt: z.iso.datetime(),
      }),
    })
    .nullable(),
  mandate: z
    .object({
      policy: MandatePolicyV1Schema,
      status: MandateStateSchema,
      revokedAt: z.iso.datetime().nullable(),
      /** The stored JWS re-verified against the trusted-surface key at bundle time. */
      signatureValid: z.boolean(),
      versions: z.array(
        z.object({
          version: z.number().int(),
          policyHash: z.string(),
          createdAt: z.iso.datetime(),
        }),
      ),
    })
    .nullable(),
  agent: z.object({
    id: z.uuid().nullable(),
    displayName: z.string().nullable(),
    keyThumbprint: z.string().nullable(),
    profileUri: z.string().nullable(),
    signatureVerified: z.boolean(),
    requestDigest: z.string().nullable(),
    nonce: z.string().nullable(),
  }),
  offer: FlightOfferViewSchema.nullable(),
  checkout: z
    .object({
      id: z.uuid(),
      cart: CheckoutCartSchema,
      cartHash: z.string(),
      computedHash: z.string(),
      bound: z.boolean(),
      total: MoneySchema,
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
  policyChecks: z.array(PolicyCheckSchema),
  approval: z
    .object({
      id: z.uuid(),
      state: ApprovalStateSchema,
      checkoutHash: z.string(),
      decidedAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  reservation: z
    .object({
      state: z.string(),
      amount: MoneySchema,
      createdAt: z.iso.datetime(),
      settledAt: z.iso.datetime().nullable(),
    })
    .nullable(),
  payment: PaymentViewSchema.nullable(),
  booking: BookingViewSchema.nullable(),
  webhooks: z.array(
    z.object({
      provider: z.string(),
      providerEventId: z.string(),
      processingState: z.string(),
      receivedAt: z.iso.datetime(),
    }),
  ),
  audit: z.object({
    events: z.array(AuditEventSchema),
    chain: z.object({
      valid: z.boolean(),
      events: z.number().int(),
      reason: z.string().nullable(),
      brokenAtSequence: z.number().int().nullable(),
    }),
  }),
  disputes: z.array(DisputeViewSchema),
  bundleHash: z.string(),
});
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
