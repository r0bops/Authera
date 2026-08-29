import { z } from 'zod';
import { MoneySchema } from './money.js';
import { DecisionSchema, ReasonCodeSchema } from './policy.js';

export const AP2_ALIGNED_VERSION = '0.2' as const;
export const AP2_ALIGNMENT_LABEL = 'AP2 v0.2-aligned subset (not certified)' as const;

const Base64UrlSha256Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const Ap2AlignmentSchema = z.strictObject({
  protocol: z.literal('AP2'),
  version: z.literal(AP2_ALIGNED_VERSION),
  label: z.literal(AP2_ALIGNMENT_LABEL),
  certified: z.literal(false),
  supported: z.tuple([
    z.literal('checkout_hash_binding'),
    z.literal('mandate_reference'),
    z.literal('payment_reference'),
    z.literal('signed_evidence_envelope'),
  ]),
  unsupported: z.tuple([
    z.literal('sd_jwt_selective_disclosure'),
    z.literal('ap2_checkout_receipt'),
    z.literal('ap2_payment_receipt'),
    z.literal('credential_provider_interop'),
  ]),
});

export const Ap2ClosedCheckoutEvidenceSchema = z.strictObject({
  vct: z.literal('mandate.checkout.1'),
  checkout_jwt: z.string().min(1),
  checkout_hash: Base64UrlSha256Schema,
  mandate_id: z.uuid(),
  mandate_version: z.number().int().positive(),
  policy_hash: z.string().min(1),
});

export const Ap2PaymentEvidenceSchema = z.strictObject({
  vct: z.literal('mandate.payment.1'),
  transaction_id: z.string().min(1),
  checkout_hash: Base64UrlSha256Schema,
  amount: MoneySchema,
  payment_method_reference_hash: Base64UrlSha256Schema,
});

export const Ap2AlignedEvidencePayloadSchema = z.strictObject({
  schema: z.literal('agentcerta.ap2-aligned-evidence.v1'),
  alignment: Ap2AlignmentSchema,
  evidence_id: z.string().min(1),
  execution_id: z.uuid(),
  issued_at: z.iso.datetime(),
  checkout: Ap2ClosedCheckoutEvidenceSchema,
  authorization: z.strictObject({
    decision: DecisionSchema,
    reason_code: ReasonCodeSchema,
    agent_key_thumbprint: z.string().min(1),
  }),
  payment: Ap2PaymentEvidenceSchema.nullable(),
  audit_root_hash: z.string().min(1),
});
export type Ap2AlignedEvidencePayload = z.infer<typeof Ap2AlignedEvidencePayloadSchema>;

export const Ap2AlignedEvidenceEnvelopeSchema = z.strictObject({
  payload: Ap2AlignedEvidencePayloadSchema,
  jws: z.string().min(1),
  signing_kid: z.string().min(1),
});
export type Ap2AlignedEvidenceEnvelope = z.infer<typeof Ap2AlignedEvidenceEnvelopeSchema>;
