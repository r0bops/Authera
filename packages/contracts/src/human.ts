import { z } from 'zod';
import { AuditEventSchema } from './audit.js';
import {
  IntentSchema,
  MandateEscalationSchema,
  MandateLimitsSchema,
  MandatePolicyV1Schema,
  MandateStateSchema,
} from './mandate.js';

export const CreateMandateRequestSchema = z.strictObject({
  /** Defaults to the user's first active agent. */
  agentId: z.uuid().optional(),
  paymentMethodId: z.uuid(),
  /** Defaults to every active merchant on the platform. */
  allowedMerchantIds: z.array(z.uuid()).min(1).optional(),
  intent: IntentSchema,
  limits: MandateLimitsSchema,
  validUntil: z.iso.datetime(),
  escalation: MandateEscalationSchema.default('block'),
});
export type CreateMandateRequest = z.infer<typeof CreateMandateRequestSchema>;

export const ReviseMandateRequestSchema = z
  .strictObject({
    intent: IntentSchema.optional(),
    limits: MandateLimitsSchema.optional(),
    validUntil: z.iso.datetime().optional(),
    escalation: MandateEscalationSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field must change' });
export type ReviseMandateRequest = z.infer<typeof ReviseMandateRequestSchema>;

export const RevokeMandateRequestSchema = z.strictObject({
  reason: z.string().trim().max(200).optional(),
});
export type RevokeMandateRequest = z.infer<typeof RevokeMandateRequestSchema>;

export const MandateVersionSummarySchema = z.object({
  version: z.number().int(),
  status: MandateStateSchema,
  policyHash: z.string(),
  signingKid: z.string(),
  createdAt: z.iso.datetime(),
});

export const MandateViewSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: MandateStateSchema,
  policy: MandatePolicyV1Schema,
  policyHash: z.string(),
  jws: z.string(),
  signingKid: z.string(),
  summary: z.string(),
  usage: z.object({
    reservedMinor: z.number().int(),
    consumedMinor: z.number().int(),
    reservedCount: z.number().int(),
    consumedCount: z.number().int(),
    remainingMinor: z.number().int(),
    remainingCount: z.number().int(),
  }),
  revokedAt: z.iso.datetime().nullable(),
  revokeReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  agent: z.object({ id: z.uuid(), displayName: z.string(), keyThumbprint: z.string() }),
  paymentMethod: z.object({ id: z.uuid(), brand: z.string(), last4: z.string() }).nullable(),
  merchants: z.array(z.object({ id: z.uuid(), displayName: z.string(), market: z.string() })),
  versions: z.array(MandateVersionSummarySchema),
  timeline: z.array(AuditEventSchema),
});
export type MandateView = z.infer<typeof MandateViewSchema>;
