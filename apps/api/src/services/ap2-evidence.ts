import { createHash, randomUUID } from 'node:crypto';
import { importJWK, SignJWT } from 'jose';
import {
  AP2_ALIGNMENT_LABEL,
  AP2_ALIGNED_VERSION,
  Ap2AlignedEvidenceEnvelopeSchema,
  type Ap2AlignedEvidenceEnvelope,
  type Ap2AlignedEvidencePayload,
  type EvidenceBundle,
} from '@authera/contracts';
import type { KeyPair } from '@authera/domain';
import type { Clock } from '../clock.js';
import { ApiProblem } from '../http/problem.js';

const AP2_EVIDENCE_TYPE = 'authera-ap2-aligned+jwt';
const UCP_CHECKOUT_TYPE = 'ucp-checkout+jwt';

export interface EvidenceBundleProvider {
  bundle(executionId: string, role: 'auditor'): Promise<EvidenceBundle>;
}

/** Signed AP2 v0.2-aligned evidence subset. It deliberately does not claim AP2 conformance. */
export class Ap2EvidenceService {
  constructor(
    private readonly deps: {
      evidence: EvidenceBundleProvider;
      merchantKey: KeyPair;
      clock: Clock;
    },
  ) {}

  async envelope(executionId: string): Promise<Ap2AlignedEvidenceEnvelope> {
    const bundle = await this.deps.evidence.bundle(executionId, 'auditor');
    if (
      !bundle.checkout ||
      !bundle.mandate ||
      !bundle.execution.decision ||
      !bundle.execution.reasonCode ||
      !bundle.agent.keyThumbprint
    ) {
      throw ApiProblem.conflict(
        'AP2_EVIDENCE_INCOMPLETE',
        'Execution does not contain enough verified evidence for an AP2-aligned envelope',
      );
    }
    if (!bundle.checkout.bound || !bundle.audit.chain.valid) {
      throw ApiProblem.conflict(
        'AP2_EVIDENCE_UNVERIFIED',
        'Checkout binding and audit chain must verify before evidence can be signed',
      );
    }

    const now = this.deps.clock.now();
    const key = await importJWK(
      this.deps.merchantKey.privateJwk as unknown as Record<string, string>,
      'EdDSA',
    );
    // A random jti prevents equal carts from producing equal signed checkout values. This remains
    // an aligned subset because AP2 v0.2's SD-JWT/ECDSA receipt profile is not implemented.
    const checkoutJwt = await new SignJWT({
      checkout: bundle.checkout.cart,
      checkout_id: bundle.checkout.id,
      cart_hash: bundle.checkout.cartHash,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.deps.merchantKey.kid, typ: UCP_CHECKOUT_TYPE })
      .setIssuer('authera:merchant')
      .setAudience('ap2:shopping-agent')
      .setSubject(bundle.checkout.id)
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .sign(key);
    const checkoutHash = sha256Base64Url(checkoutJwt);
    const payment = bundle.payment
      ? {
          vct: 'mandate.payment.1' as const,
          transaction_id:
            bundle.payment.providerTransactionId ??
            bundle.payment.providerPaymentId ??
            bundle.payment.id,
          checkout_hash: checkoutHash,
          amount: bundle.payment.amount,
          payment_method_reference_hash: sha256Base64Url(bundle.mandate.policy.paymentMethodRef),
        }
      : null;
    const payload: Ap2AlignedEvidencePayload = {
      schema: 'authera.ap2-aligned-evidence.v1',
      alignment: {
        protocol: 'AP2',
        version: AP2_ALIGNED_VERSION,
        label: AP2_ALIGNMENT_LABEL,
        certified: false,
        supported: [
          'checkout_hash_binding',
          'mandate_reference',
          'payment_reference',
          'signed_evidence_envelope',
        ],
        unsupported: [
          'sd_jwt_selective_disclosure',
          'ap2_checkout_receipt',
          'ap2_payment_receipt',
          'credential_provider_interop',
        ],
      },
      evidence_id: bundle.evidenceId,
      execution_id: bundle.executionId,
      issued_at: now.toISOString(),
      checkout: {
        vct: 'mandate.checkout.1',
        checkout_jwt: checkoutJwt,
        checkout_hash: checkoutHash,
        mandate_id: bundle.mandate.policy.mandateId,
        mandate_version: bundle.mandate.policy.version,
        policy_hash: bundle.human?.authorization.policyHash ?? bundle.bundleHash,
      },
      authorization: {
        decision: bundle.execution.decision,
        reason_code: bundle.execution.reasonCode,
        agent_key_thumbprint: bundle.agent.keyThumbprint,
      },
      payment,
      audit_root_hash: bundle.audit.events.at(-1)?.hash ?? bundle.bundleHash,
    };
    const jws = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'EdDSA', kid: this.deps.merchantKey.kid, typ: AP2_EVIDENCE_TYPE })
      .setIssuer('authera:merchant')
      .setAudience('ap2:dispute-evidence')
      .setSubject(bundle.executionId)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .sign(key);
    return Ap2AlignedEvidenceEnvelopeSchema.parse({
      payload,
      jws,
      signing_kid: this.deps.merchantKey.kid,
    });
  }
}

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}
