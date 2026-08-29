import { signJwtEs256, verifyJwtEs256, sha256Base64Url } from "./crypto.js";

export const AP2_VCT = {
  CHECKOUT_OPEN: "mandate.checkout.open.1",
  CHECKOUT: "mandate.checkout.1",
  PAYMENT_OPEN: "mandate.payment.open.1",
  PAYMENT: "mandate.payment.1",
};

export function createOpenCheckoutMandate({ privateKey, mandate, now = new Date() }) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = Math.floor(new Date(mandate.valid_until).getTime() / 1000);
  const constraints = {
    category: mandate.category,
    max_amount: Number(mandate.max_amount),
    currency: mandate.currency,
    price_condition: mandate.price_condition || null,
    frequency_limit: mandate.frequency_limit || null,
    allowed_merchant_ids: mandate.allowed_merchant_ids || null,
  };
  return signJwtEs256(privateKey, {
    vct: AP2_VCT.CHECKOUT_OPEN,
    iss: "agentic-pay.trusted-surface",
    sub: mandate.human_id,
    agent_id: mandate.agent_id,
    mandate_id: mandate.id,
    constraints,
    iat,
    exp,
  });
}

export function createClosedCheckoutMandate({ privateKey, checkoutJwt, mandate, now = new Date() }) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = Math.floor(new Date(mandate.valid_until).getTime() / 1000);
  return signJwtEs256(privateKey, {
    vct: AP2_VCT.CHECKOUT,
    iss: "agentic-pay.trusted-surface",
    sub: mandate.human_id,
    agent_id: mandate.agent_id,
    mandate_id: mandate.id,
    checkout_jwt: checkoutJwt,
    checkout_hash: sha256Base64Url(checkoutJwt),
    iat,
    exp,
  });
}

export function createPaymentMandate({ privateKey, checkoutJwt, mandate, vaultedToken, now = new Date() }) {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = Math.floor(new Date(mandate.valid_until).getTime() / 1000);
  return signJwtEs256(privateKey, {
    vct: AP2_VCT.PAYMENT,
    iss: "agentic-pay.trusted-surface",
    sub: mandate.human_id,
    agent_id: mandate.agent_id,
    mandate_id: mandate.id,
    transaction_id: sha256Base64Url(checkoutJwt),
    payment_instrument: {
      type: "yuno-vaulted-token",
      reference: vaultedToken,
    },
    iat,
    exp,
  });
}

export function verifyAp2Jwt(publicKey, token, expectedVct) {
  const result = verifyJwtEs256(publicKey, token);
  if (!result.valid) return result;
  if (result.payload.vct !== expectedVct) return { valid: false, payload: result.payload, error: `Unexpected vct: ${result.payload.vct}` };
  const now = Math.floor(Date.now() / 1000);
  if (result.payload.exp && now > Number(result.payload.exp)) return { valid: false, payload: result.payload, error: "AP2 credential expired" };
  if (result.payload.iat && now + 60 < Number(result.payload.iat)) return { valid: false, payload: result.payload, error: "AP2 credential issued in the future" };
  return result;
}
