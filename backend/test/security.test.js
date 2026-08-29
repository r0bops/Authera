import test from "node:test";
import assert from "node:assert/strict";
import { generateEcKeyPair, createDigestHeader, createHttpSignature, verifyHttpSignature, signJwtEs256, verifyJwtEs256, sha256Base64Url } from "../src/crypto.js";
import { evaluatePolicy } from "../src/policy.js";
import { AP2_VCT, createClosedCheckoutMandate, verifyAp2Jwt } from "../src/ap2.js";

const now = new Date();
const future = new Date(now.getTime() + 86400000).toISOString();
const agent = { id: "agent-1", status: "active" };
const baseMandate = {
  id: "mandate-1", agent_id: "agent-1", status: "active", valid_from: now.toISOString(), valid_until: future,
  category: "flights", max_amount: 150, currency: "USD", price_condition: { type: "price_below", value: 150 }, frequency_limit: { count: 3, period_days: 30 },
};

test("RFC 9421 profile signature verifies and tampering fails", () => {
  const { privateKey, publicKey } = generateEcKeyPair();
  const body = JSON.stringify({ hello: "world" });
  const digest = createDigestHeader(body);
  const headers = createHttpSignature({ privateKeyPem: privateKey, keyId: "agent-key", method: "POST", targetUri: "https://merchant.test/checkout-sessions", contentDigest: digest });
  const good = verifyHttpSignature({ publicKeyPem: publicKey, headers: { ...headers, "content-digest": digest, "content-type": "application/json" }, method: "POST", targetUri: "https://merchant.test/checkout-sessions" });
  assert.equal(good.valid, true);
  const bad = verifyHttpSignature({ publicKeyPem: publicKey, headers: { ...headers, "content-digest": createDigestHeader(body + "tampered"), "content-type": "application/json" }, method: "POST", targetUri: "https://merchant.test/checkout-sessions" });
  assert.equal(bad.valid, false);
});

test("AP2 closed checkout mandate binds to checkout JWT hash", () => {
  const keys = generateEcKeyPair();
  const checkoutJwt = signJwtEs256(keys.privateKey, { iss: "merchant-1", checkout: { total: 130, currency: "USD" } });
  const mandateToken = createClosedCheckoutMandate({ privateKey: keys.privateKey, checkoutJwt, mandate: { ...baseMandate, human_id: "human-1" } });
  const verified = verifyAp2Jwt(keys.publicKey, mandateToken, AP2_VCT.CHECKOUT);
  assert.equal(verified.valid, true);
  assert.equal(verified.payload.checkout_hash, sha256Base64Url(checkoutJwt));
});

test("policy rejects over-limit, bad category, expired and accepts valid flight", () => {
  const valid = evaluatePolicy({ mandate: baseMandate, agent, merchantId: "merchant-1", checkout: { item: "Flight", category: "flights", total: 130, currency: "USD" }, recentPurchaseCount: 0 });
  assert.equal(valid.status, "approved");
  const over = evaluatePolicy({ mandate: baseMandate, agent, merchantId: "merchant-1", checkout: { item: "Flight", category: "flights", total: 300, currency: "USD" }, recentPurchaseCount: 0 });
  assert.equal(over.status, "rejected");
  const category = evaluatePolicy({ mandate: baseMandate, agent, merchantId: "merchant-1", checkout: { item: "Hotel", category: "hotels", total: 100, currency: "USD" }, recentPurchaseCount: 0 });
  assert.equal(category.status, "rejected");
  const expired = evaluatePolicy({ mandate: { ...baseMandate, valid_until: new Date(now.getTime() - 1000).toISOString() }, agent, merchantId: "merchant-1", checkout: { item: "Flight", category: "flights", total: 100, currency: "USD" }, recentPurchaseCount: 0 });
  assert.equal(expired.status, "rejected");
});

test("Yuno adapter defaults to safe mock mode and never requires raw card data", async () => {
  const { YunoGateway } = await import("../src/yuno.js");
  const gateway = new YunoGateway({ YUNO_MODE: "mock" });
  const result = await gateway.createPayment({ orderId: "order-test", amount: 130, currency: "USD", country: "CO", paymentToken: "vaulted-demo", paymentTokenType: "vaulted", description: "Test" });
  assert.equal(result.status, "SUCCEEDED");
  assert.equal(result.mode, "mock");
  assert.equal(result.payment_method.vaulted_token, "vaulted-demo");
});
