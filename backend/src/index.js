import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import crypto from "node:crypto";
import { pool, initDb, readPrivateKey } from "./db.js";
import {
  createDigestHeader,
  createHttpSignature,
  signJwtEs256,
  sha256Base64Url,
  verifyHttpSignature,
  verifyJwtEs256,
} from "./crypto.js";
import { createClosedCheckoutMandate, createOpenCheckoutMandate, createPaymentMandate, AP2_VCT, verifyAp2Jwt } from "./ap2.js";
import { evaluatePolicy } from "./policy.js";
import { YunoGateway } from "./yuno.js";

const app = new Hono();
app.use("*", cors({ origin: "*" }));

const yuno = new YunoGateway();

function publicYunoResult(result) {
  if (!result || typeof result !== "object") return result;
  const copy = JSON.parse(JSON.stringify(result));
  if (copy.payment_method?.token) copy.payment_method.token = "[redacted]";
  if (copy.payment_method?.vaulted_token) copy.payment_method.vaulted_token = "[vaulted-token]";
  if (copy.transactions?.payment_method?.token) copy.transactions.payment_method.token = "[redacted]";
  if (copy.transactions?.payment_method?.vaulted_token) copy.transactions.payment_method.vaulted_token = "[vaulted-token]";
  return copy;
}

const port = Number(process.env.PORT || 8787);
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const UCP_VERSION = "2026-01-23";


async function logEvent({ event_type, actor_type, actor_id, mandate_id, purchase_id, request_id, details }) {
  // One transaction-level advisory lock keeps the append-only hash chain deterministic.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [9421]);
    const { rows: previousRows } = await client.query(
      "SELECT event_hash FROM audit_log ORDER BY sequence_number DESC LIMIT 1"
    );
    const previous_event_hash = previousRows[0]?.event_hash || null;
    const eventPayload = {
      event_type,
      actor_type,
      actor_id: actor_id || null,
      mandate_id: mandate_id || null,
      purchase_id: purchase_id || null,
      request_id: request_id || null,
      details: details || {},
      previous_event_hash,
    };
    const event_hash = sha256Base64Url(JSON.stringify(eventPayload));
    const { rows } = await client.query(
      `INSERT INTO audit_log
       (event_type, actor_type, actor_id, mandate_id, purchase_id, request_id, details, previous_event_hash, event_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [event_type, actor_type, actor_id || null, mandate_id || null, purchase_id || null, request_id || null, details || {}, previous_event_hash, event_hash]
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getMandate(id) {
  const { rows } = await pool.query("SELECT * FROM mandates WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getAgent(id) {
  const { rows } = await pool.query("SELECT * FROM agents WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getMerchant(id) {
  const { rows } = await pool.query("SELECT * FROM merchants WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getHuman(id) {
  const { rows } = await pool.query("SELECT * FROM humans WHERE id = $1", [id]);
  return rows[0] || null;
}

async function getPaymentInstrument(id) {
  const { rows } = await pool.query("SELECT * FROM payment_instruments WHERE id = $1", [id]);
  return rows[0] || null;
}

async function recentPurchaseCount(mandateId, periodDays) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM purchases
     WHERE mandate_id = $1 AND status = 'approved'
       AND created_at > now() - ($2 || ' days')::interval`,
    [mandateId, periodDays]
  );
  return rows[0].c;
}

async function reserveReplay(requestId, agentId, expiresAt = new Date(Date.now() + 2 * 60 * 1000)) {
  const { rowCount } = await pool.query(
    `INSERT INTO replay_nonces (request_id, agent_id, expires_at)
     VALUES ($1,$2,$3)
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, agentId, expiresAt]
  );
  return rowCount === 1;
}

async function verifyAgentRequest(agentId, request, bodyText) {
  const agent = await getAgent(agentId);
  if (!agent) return { ok: false, status: 401, reason: "Unknown agent" };
  if (agent.status !== "active") return { ok: false, status: 403, reason: "Agent inactive" };

  const digest = request.headers.get("content-digest") || createDigestHeader(bodyText);
  const expectedDigest = createDigestHeader(bodyText);
  if (digest !== expectedDigest) return { ok: false, status: 401, agent, reason: "Content-Digest does not match request body" };
  const headers = {
    "content-digest": digest,
    "content-type": request.headers.get("content-type") || "application/json",
    "signature-input": request.headers.get("signature-input") || "",
    signature: request.headers.get("signature") || "",
  };
  const verified = verifyHttpSignature({
    publicKeyPem: agent.public_key,
    headers,
    method: request.method,
    targetUri: request.url,
  });
  if (verified.valid && verified.keyId !== agent.key_id) {
    return { ok: false, status: 401, agent, reason: "HTTP signature keyid does not match registered agent key", verified };
  }
  return verified.valid
    ? { ok: true, agent, verified }
    : { ok: false, status: 401, agent, reason: verified.reason, verified };
}

function ucpAgentHeader(agentId) {
  return `profile="${BASE_URL}/agents/${agentId}/ucp-profile.json"`;
}

async function issueMerchantCheckoutJwt({ merchant, checkout }) {
  const privateKey = readPrivateKey("merchant", merchant.id);
  return signJwtEs256(privateKey, {
    iss: merchant.id,
    sub: checkout.id,
    ucp_version: UCP_VERSION,
    checkout,
    iat: Math.floor(Date.now() / 1000),
  });
}

function checkoutHash(checkoutJwt) {
  return sha256Base64Url(checkoutJwt);
}

// ---------- system / discovery ----------
app.get("/api/health", (c) => c.json({ ok: true, yuno_mode: yuno.mode, ucp_version: UCP_VERSION }));

app.get("/.well-known/ucp", (c) => c.json({
  ucp: {
    version: UCP_VERSION,
    services: {
      "dev.ucp.shopping": [{
        transport: "rest",
        endpoint: `${BASE_URL}/ucp/shopping`,
        spec: `https://ucp.dev/${UCP_VERSION}/specification/shopping`,
        schema: `https://ucp.dev/${UCP_VERSION}/services/shopping/openapi.json`,
      }],
    },
    capabilities: {
      "dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.order": [{ version: UCP_VERSION }],
      "dev.ucp.common.identity_linking": [{ version: UCP_VERSION }],
      "dev.ucp.shopping.ap2_mandates": [{ version: UCP_VERSION }],
    },
    payment_handlers: {
      "com.yuno": [{ id: "yuno-sandbox", version: "demo-1" }],
    },
  }, merchant: "VuelaYa",
}));

app.get("/agents/:id/ucp-profile.json", async (c) => {
  const agent = await getAgent(c.req.param("id"));
  if (!agent) return c.json({ error: "Agent not found" }, 404);
  return c.json({
    ucp: {
      version: UCP_VERSION,
      role: "platform",
      agent_id: agent.id,
      capabilities: ["dev.ucp.shopping.checkout"],
      signing: { algorithm: agent.algorithm, key_id: agent.key_id, public_key: agent.public_key },
    },
  });
});

// ---------- demo identity / principals ----------
app.get("/api/humans", async (c) => {
  const { rows } = await pool.query("SELECT id, name, email, trusted_surface_key_id, trusted_surface_key_version, created_at FROM humans ORDER BY created_at");
  return c.json(rows);
});

app.get("/api/agents", async (c) => {
  const { rows } = await pool.query("SELECT id, human_id, name, key_id, algorithm, status, created_at FROM agents ORDER BY created_at");
  return c.json(rows);
});

app.get("/api/agents/:id", async (c) => {
  const agent = await getAgent(c.req.param("id"));
  if (!agent) return c.json({ error: "Agente no encontrado" }, 404);
  return c.json({ ...agent, api_key: undefined, public_key: agent.public_key });
});

app.get("/api/merchants", async (c) => {
  const { rows } = await pool.query("SELECT id, name, key_id, algorithm, profile_url, created_at FROM merchants ORDER BY created_at");
  return c.json(rows);
});

app.get("/api/payment-instruments", async (c) => {
  const humanId = c.req.query("human_id");
  const { rows } = await pool.query(
    `SELECT id, human_id, provider, token_type, type, brand, last4, status, created_at FROM payment_instruments ${humanId ? "WHERE human_id = $1" : ""} ORDER BY created_at`,
    humanId ? [humanId] : []
  );
  return c.json(rows);
});

// ---------- mandates / AP2 ----------
app.get("/api/mandates", async (c) => {
  const { rows } = await pool.query(
    `SELECT m.*, h.name AS human_name, a.name AS agent_name,
            pi.provider, pi.brand, pi.last4
     FROM mandates m
     JOIN humans h ON h.id = m.human_id
     JOIN agents a ON a.id = m.agent_id
     LEFT JOIN payment_instruments pi ON pi.id = m.payment_instrument_id
     ORDER BY m.created_at DESC`
  );
  return c.json(rows);
});

app.get("/api/mandates/:id", async (c) => {
  const mandate = await getMandate(c.req.param("id"));
  if (!mandate) return c.json({ error: "Mandato no encontrado" }, 404);
  return c.json(mandate);
});

app.post("/api/mandates", async (c) => {
  const body = await c.req.json();
  const {
    human_id,
    agent_id,
    description,
    category,
    max_amount,
    currency = "USD",
    price_condition = null,
    frequency_limit = null,
    allowed_merchant_ids = null,
    payment_instrument_id = null,
    valid_days = 30,
  } = body;
  if (!human_id || !agent_id || !description || !category || max_amount == null) {
    return c.json({ error: "Faltan campos obligatorios" }, 400);
  }
  const human = await getHuman(human_id);
  const agent = await getAgent(agent_id);
  if (!human || !agent || agent.human_id !== human_id) return c.json({ error: "Human/agent inválidos" }, 400);
  const payment = payment_instrument_id ? await getPaymentInstrument(payment_instrument_id) : null;
  if (payment && payment.human_id !== human_id) return c.json({ error: "El método de pago no pertenece al humano" }, 400);

  const validUntil = new Date(Date.now() + Number(valid_days) * 86400 * 1000);
  const id = crypto.randomUUID();
  const snapshot = { id, human_id, agent_id, description, category, max_amount: Number(max_amount), currency, price_condition, frequency_limit, allowed_merchant_ids, payment_instrument_id, valid_until: validUntil.toISOString() };
  const humanPrivateKey = readPrivateKey("human", human.id);
  const openJwt = createOpenCheckoutMandate({ privateKey: humanPrivateKey, mandate: snapshot });

  const { rows } = await pool.query(
    `INSERT INTO mandates
     (id, human_id, agent_id, description, category, max_amount, currency, price_condition, frequency_limit,
      allowed_merchant_ids, payment_instrument_id, valid_until, ap2_open_mandate_jwt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [id, human_id, agent_id, description, category, Number(max_amount), currency, price_condition, frequency_limit, allowed_merchant_ids, payment_instrument_id, validUntil.toISOString(), openJwt]
  );
  const mandate = rows[0];
  await pool.query(
    `INSERT INTO mandate_versions (mandate_id, version, snapshot, signature) VALUES ($1,$2,$3,$4)`,
    [id, 1, snapshot, openJwt]
  );
  await logEvent({
    event_type: "mandate_created",
    actor_type: "human",
    actor_id: human_id,
    mandate_id: id,
    details: { version: 1, ap2_vct: AP2_VCT.CHECKOUT_OPEN, open_mandate_jwt: openJwt, constraints: snapshot },
  });
  return c.json(mandate, 201);
});

app.post("/api/mandates/:id/revoke", async (c) => {
  const id = c.req.param("id");
  const mandate = await getMandate(id);
  if (!mandate) return c.json({ error: "Mandato no encontrado" }, 404);
  if (mandate.status === "revoked") return c.json(mandate);
  const { rows } = await pool.query(
    `UPDATE mandates SET status = 'revoked', revoked_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
    [id]
  );
  await logEvent({ event_type: "mandate_revoked", actor_type: "human", actor_id: mandate.human_id, mandate_id: id, details: { version: rows[0].version, revoked_at: rows[0].revoked_at } });
  return c.json(rows[0]);
});

app.post("/api/mandates/:id/limit", async (c) => {
  const id = c.req.param("id");
  const { max_amount } = await c.req.json();
  const mandate = await getMandate(id);
  if (!mandate) return c.json({ error: "Mandato no encontrado" }, 404);
  if (mandate.status === "revoked") return c.json({ error: "No se puede cambiar un mandato revocado" }, 409);
  const human = await getHuman(mandate.human_id);
  const nextVersion = Number(mandate.version) + 1;
  const snapshot = {
    id: mandate.id,
    human_id: mandate.human_id,
    agent_id: mandate.agent_id,
    description: mandate.description,
    category: mandate.category,
    max_amount: Number(max_amount),
    currency: mandate.currency,
    price_condition: mandate.price_condition,
    frequency_limit: mandate.frequency_limit,
    allowed_merchant_ids: mandate.allowed_merchant_ids,
    payment_instrument_id: mandate.payment_instrument_id,
    valid_until: mandate.valid_until,
  };
  const openJwt = createOpenCheckoutMandate({ privateKey: readPrivateKey("human", human.id), mandate: snapshot });
  const { rows } = await pool.query(
    `UPDATE mandates SET max_amount = $1, version = $2, ap2_open_mandate_jwt = $3 WHERE id = $4 RETURNING *`,
    [Number(max_amount), nextVersion, openJwt, id]
  );
  await pool.query(`INSERT INTO mandate_versions (mandate_id, version, snapshot, signature) VALUES ($1,$2,$3,$4)`, [id, nextVersion, snapshot, openJwt]);
  await logEvent({ event_type: "mandate_updated", actor_type: "human", actor_id: mandate.human_id, mandate_id: id, details: { version: nextVersion, changed: { max_amount: Number(max_amount) }, open_mandate_jwt: openJwt } });
  return c.json(rows[0]);
});

// ---------- merchant verification ----------
app.post("/api/verify", async (c) => {
  const body = await c.req.json();
  const agent = await getAgent(body.agent_id);
  const mandate = body.mandate_id ? await getMandate(body.mandate_id) : null;
  const merchant = await getMerchant(body.merchant_id);
  const now = new Date();
  const verified = !!merchant && !!agent && !!mandate && mandate.agent_id === agent.id && mandate.status === "active" && new Date(mandate.valid_until) >= now;
  const result = {
    verified,
    merchant_found: !!merchant,
    agent_found: !!agent,
    mandate_found: !!mandate,
    mandate_status: mandate?.status || null,
    mandate_expired: mandate ? new Date(mandate.valid_until) < now : null,
    mandate_version: mandate?.version || null,
    cryptographic_identity: !!agent?.public_key,
    ap2_open_mandate: !!mandate?.ap2_open_mandate_jwt,
    checked_at: now.toISOString(),
  };
  await logEvent({ event_type: "merchant_verification", actor_type: "merchant", actor_id: body.merchant_id, mandate_id: body.mandate_id || null, details: result });
  return c.json(result);
});

// ---------- UCP catalog + checkout ----------
const catalog = [
  { id: "flight-cordoba-130", name: "Vuelo Bogotá → Córdoba", category: "flights", route: "BOG → COR", price: 130, currency: "USD" },
  { id: "flight-cordoba-300", name: "Vuelo Bogotá → Córdoba (premium)", category: "flights", route: "BOG → COR", price: 300, currency: "USD" },
  { id: "hotel-cordoba-100", name: "Hotel Córdoba", category: "hotels", route: "Córdoba", price: 100, currency: "USD" },
];

app.get("/ucp/shopping/catalog", (c) => c.json({ ucp: { version: UCP_VERSION }, products: catalog }));

app.post("/ucp/shopping/checkout-sessions", async (c) => {
  const bodyText = await c.req.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { return c.json({ error: "JSON inválido" }, 400); }

  const agentId = body.agent_id || body.agent?.id;
  if (!agentId) return c.json({ error: "agent_id required" }, 400);
  const sigCheck = await verifyAgentRequest(agentId, c.req.raw, bodyText);
  if (!sigCheck.ok) return c.json({ error: sigCheck.reason, security: sigCheck.verified || null }, sigCheck.status);

  const agent = sigCheck.agent;
  const product = catalog.find((p) => p.id === body.product_id);
  if (!product) return c.json({ error: "Producto no encontrado" }, 404);
  const quantity = Math.max(1, Number(body.quantity || 1));
  const total = product.price * quantity;
  const checkoutId = crypto.randomUUID();
  const checkout = {
    id: checkoutId,
    merchant: "VuelaYa",
    merchant_id: body.merchant_id,
    currency: product.currency,
    item: product.name,
    category: product.category,
    line_items: [{ id: product.id, name: product.name, quantity, unit_amount: product.price, category: product.category }],
    total,
    buyer: { human_id: body.human_id || null, agent_id: agent.id },
    status: "ready_for_complete",
  };

  const merchant = await getMerchant(body.merchant_id);
  if (!merchant) return c.json({ error: "Merchant not found" }, 404);
  if (Array.isArray(body.allowed_merchant_ids) && body.allowed_merchant_ids.length && !body.allowed_merchant_ids.includes(merchant.id)) {
    return c.json({ error: "Merchant not in requested scope" }, 403);
  }

  const checkoutJwt = await issueMerchantCheckoutJwt({ merchant, checkout });
  const hash = checkoutHash(checkoutJwt);
  await pool.query(
    `INSERT INTO ucp_checkout_sessions
     (id, merchant_id, agent_id, mandate_id, line_items, item, category, total, currency, buyer, checkout_jwt, checkout_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [checkoutId, merchant.id, agent.id, body.mandate_id || null, JSON.stringify(checkout.line_items), checkout.item, checkout.category, checkout.total, checkout.currency, checkout.buyer, checkoutJwt, hash]
  );

  await logEvent({
    event_type: "ucp_checkout_created",
    actor_type: "merchant",
    actor_id: merchant.id,
    mandate_id: body.mandate_id || null,
    details: { checkout_id: checkoutId, checkout_hash: hash, item: checkout.item, total, currency: checkout.currency, agent_id: agent.id },
  });

  return c.json({
    ucp: { version: UCP_VERSION },
    checkout,
    checkout_jwt: checkoutJwt,
    checkout_hash: hash,
    merchant_signature: { key_id: merchant.key_id, algorithm: merchant.algorithm },
  }, 201);
});

app.get("/ucp/shopping/checkout-sessions/:id", async (c) => {
  const { rows } = await pool.query("SELECT * FROM ucp_checkout_sessions WHERE id = $1", [c.req.param("id")]);
  if (!rows[0]) return c.json({ error: "Checkout no encontrado" }, 404);
  return c.json(rows[0]);
});

// ---------- Agent runner: actual signed request + complete purchase ----------
app.post("/api/agent/purchase", async (c) => {
  const body = await c.req.json();
  const agent = await getAgent(body.agent_id);
  const merchant = await getMerchant(body.merchant_id);
  const mandate = await getMandate(body.mandate_id);
  if (!agent || !merchant || !mandate) return c.json({ error: "agent, merchant o mandate inválido" }, 400);
  if (agent.human_id !== mandate.human_id || mandate.agent_id !== agent.id) return c.json({ error: "Agente y mandato no están vinculados" }, 403);

  const requestId = body.request_id || crypto.randomUUID();
  const agentPrivateKey = readPrivateKey("agent", agent.id);
  const checkoutRequest = {
    agent_id: agent.id,
    human_id: agent.human_id,
    merchant_id: merchant.id,
    mandate_id: mandate.id,
    product_id: body.product_id || "flight-cordoba-130",
    quantity: Number(body.quantity || 1),
    request_id: requestId,
  };
  const checkoutBody = JSON.stringify(checkoutRequest);
  const contentDigest = createDigestHeader(checkoutBody);
  const signatureHeaders = createHttpSignature({
    privateKeyPem: agentPrivateKey,
    keyId: agent.key_id,
    method: "POST",
    targetUri: `${BASE_URL}/ucp/shopping/checkout-sessions`,
    contentDigest,
  });
  const replayAvailable = await reserveReplay(requestId, agent.id);
  if (!replayAvailable) return c.json({ error: "Replay detected", request_id: requestId }, 409);

  // The agent makes a real HTTP request back to the UCP merchant endpoint.
  const response = await fetch(`${BASE_URL}/ucp/shopping/checkout-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Digest": contentDigest,
      ...signatureHeaders,
      "UCP-Agent": ucpAgentHeader(agent.id),
      "Idempotency-Key": requestId,
    },
    body: checkoutBody,
  });
  const checkoutPayload = await response.json();
  if (!response.ok) {
    await logEvent({ event_type: "agent_checkout_failed", actor_type: "agent", actor_id: agent.id, mandate_id: mandate.id, request_id: requestId, details: checkoutPayload });
    return c.json({ stage: "ucp_checkout", ...checkoutPayload }, response.status);
  }

  const checkout = checkoutPayload.checkout;
  const checkoutJwt = checkoutPayload.checkout_jwt;
  const checkoutHash = checkoutPayload.checkout_hash;

  // Re-read the mandate after the merchant checkout is created. This is the
  // authorization point for the payment and makes live revocation observable.
  const currentMandate = await getMandate(mandate.id);
  if (!currentMandate) return c.json({ stage: "policy", error: "Mandate disappeared before payment" }, 409);
  const liveMandate = currentMandate;
  const human = await getHuman(liveMandate.human_id);
  const payment = liveMandate.payment_instrument_id ? await getPaymentInstrument(liveMandate.payment_instrument_id) : null;

  // Merchant verifies its own signed checkout, then the trusted surface closes the AP2 checkout mandate.
  const merchantJwt = verifyJwtEs256(merchant.public_key, checkoutJwt);
  const closedCheckoutMandateJwt = createClosedCheckoutMandate({
    privateKey: readPrivateKey("human", human.id),
    checkoutJwt,
    mandate: liveMandate,
  });
  const closedMandateVerification = verifyAp2Jwt(human.trusted_surface_public_key, closedCheckoutMandateJwt, AP2_VCT.CHECKOUT);
  const checkoutHashMatches = closedMandateVerification.valid && closedMandateVerification.payload.checkout_hash === checkoutHash;

  const recentCount = liveMandate.frequency_limit ? await recentPurchaseCount(liveMandate.id, liveMandate.frequency_limit.period_days) : 0;
  const policy = evaluatePolicy({
    mandate: liveMandate,
    agent,
    merchantId: merchant.id,
    checkout: { item: checkout.item, category: checkout.category, total: checkout.total, currency: checkout.currency },
    recentPurchaseCount: recentCount,
    replayDetected: false,
  });
  policy.checks.merchant_checkout_signature = !!merchantJwt.valid;
  policy.checks.ap2_checkout_mandate_signature = !!closedMandateVerification.valid;
  policy.checks.checkout_hash_binding = checkoutHashMatches;

  let finalStatus = policy.status;
  let reason = policy.reason;
  if (!merchantJwt.valid || !checkoutHashMatches) {
    finalStatus = "rejected";
    reason = !merchantJwt.valid ? "La firma del checkout del comerciante no es válida." : "El AP2 Checkout Mandate no coincide con el checkout del comerciante.";
  }

  await pool.query(
    `INSERT INTO policy_decisions (request_id, mandate_id, agent_id, checkout_id, status, checks, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (request_id) DO NOTHING`,
    [requestId, liveMandate.id, agent.id, checkout.id, finalStatus, policy.checks, reason]
  );

  await logEvent({
    event_type: `policy_${finalStatus}`,
    actor_type: "system",
    actor_id: agent.id,
    mandate_id: liveMandate.id,
    request_id: requestId,
    details: { checkout_id: checkout.id, checks: policy.checks, reason },
  });

  if (finalStatus !== "approved") {
    const { rows } = await pool.query(
      `INSERT INTO purchases (mandate_id, agent_id, merchant_id, checkout_id, item, category, amount, currency, status, reason, policy_checks, ap2_checkout_mandate_jwt, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [liveMandate.id, agent.id, merchant.id, checkout.id, checkout.item, checkout.category, checkout.total, checkout.currency, finalStatus, reason, policy.checks, closedCheckoutMandateJwt, requestId]
    );
    await logEvent({ event_type: `purchase_${finalStatus}`, actor_type: "agent", actor_id: agent.id, mandate_id: mandate.id, purchase_id: rows[0].id, request_id: requestId, details: { checkout_id: checkout.id, reason } });
    return c.json({ purchase: rows[0], checkout, policy, security: { http_signature: "verified", merchant_checkout_signature: merchantJwt.valid, ap2_checkout_binding: checkoutHashMatches } });
  }

  if (!payment) {
    const escalated = "El mandato no tiene un instrumento de pago Yuno asociado; se requiere aprobación humana.";
    const { rows } = await pool.query(
      `INSERT INTO purchases (mandate_id, agent_id, merchant_id, checkout_id, item, category, amount, currency, status, reason, policy_checks, ap2_checkout_mandate_jwt, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [liveMandate.id, agent.id, merchant.id, checkout.id, checkout.item, checkout.category, checkout.total, checkout.currency, "escalated", escalated, policy.checks, closedCheckoutMandateJwt, requestId]
    );
    await logEvent({ event_type: "purchase_escalated", actor_type: "system", actor_id: agent.id, mandate_id: mandate.id, purchase_id: rows[0].id, request_id: requestId, details: { reason: escalated } });
    return c.json({ purchase: rows[0], checkout, policy, security: { http_signature: "verified", ap2_checkout_binding: checkoutHashMatches } });
  }

  const paymentMandateJwt = createPaymentMandate({
    privateKey: readPrivateKey("human", human.id),
    checkoutJwt,
    mandate: liveMandate,
    vaultedToken: payment.vaulted_token,
  });
  const paymentMandateVerified = verifyAp2Jwt(human.trusted_surface_public_key, paymentMandateJwt, AP2_VCT.PAYMENT);

  const yunoResult = await yuno.createPayment({
    orderId: `vuelya-${checkout.id}`,
    amount: checkout.total,
    currency: checkout.currency,
    country: "CO",
    customerId: payment.provider_customer_id,
    paymentToken: payment.vaulted_token,
    paymentTokenType: payment.token_type || "vaulted",
    description: checkout.item,
    metadata: [
      { key: "mandate_id", value: liveMandate.id },
      { key: "checkout_hash", value: checkoutHash },
      { key: "agent_id", value: agent.id },
      { key: "ap2_transaction_id", value: paymentMandateVerified.payload?.transaction_id || checkoutHash },
    ],
  });

  const approvedByYuno = yunoResult.status === "SUCCEEDED" || yunoResult.status === "APPROVED";
  finalStatus = approvedByYuno ? "approved" : "rejected";
  reason = approvedByYuno ? "Compra autorizada por política y procesada por Yuno." : `Yuno rechazó o no completó el pago (estado ${yunoResult.status}).`;

  const { rows } = await pool.query(
    `INSERT INTO purchases
     (mandate_id, agent_id, merchant_id, checkout_id, item, category, amount, currency, status, reason, policy_checks,
      yuno_payment_id, ap2_checkout_mandate_jwt, ap2_payment_mandate_jwt, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [liveMandate.id, agent.id, merchant.id, checkout.id, checkout.item, checkout.category, checkout.total, checkout.currency, finalStatus, reason, { ...policy.checks, ap2_payment_mandate_signature: paymentMandateVerified.valid }, yunoResult.id || null, closedCheckoutMandateJwt, paymentMandateJwt, requestId]
  );
  const purchase = rows[0];

  await pool.query(`UPDATE ucp_checkout_sessions SET status = $1, updated_at = now() WHERE id = $2`, [finalStatus === "approved" ? "completed" : "payment_failed", checkout.id]);
  await pool.query(`INSERT INTO ucp_orders (checkout_id, merchant_id, purchase_id, status) VALUES ($1,$2,$3,$4)`, [checkout.id, merchant.id, purchase.id, finalStatus === "approved" ? "paid" : "payment_failed"]);

  await logEvent({
    event_type: `payment_${finalStatus}`,
    actor_type: "payment_processor",
    actor_id: null,
    mandate_id: liveMandate.id,
    purchase_id: purchase.id,
    request_id: requestId,
    details: { provider: "YUNO", mode: yuno.mode, payment_id: yunoResult.id, status: yunoResult.status, ap2_payment_mandate_verified: paymentMandateVerified.valid },
  });
  await logEvent({
    event_type: `purchase_${finalStatus}`,
    actor_type: "agent",
    actor_id: agent.id,
    mandate_id: liveMandate.id,
    purchase_id: purchase.id,
    request_id: requestId,
    details: { checkout_id: checkout.id, checkout_hash: checkoutHash, amount: checkout.total, currency: checkout.currency, reason },
  });

  return c.json({
    purchase,
    checkout,
    order_id: (await pool.query("SELECT id FROM ucp_orders WHERE purchase_id = $1", [purchase.id])).rows[0]?.id || null,
    policy,
    ap2: {
      checkout_mandate: closedCheckoutMandateJwt,
      payment_mandate: paymentMandateJwt,
      checkout_hash: checkoutHash,
      payment_mandate_verified: paymentMandateVerified.valid,
    },
    yuno: publicYunoResult(yunoResult),
    security: {
      http_message_signature: "verified (RFC 9421 profile)",
      merchant_checkout_signature: merchantJwt.valid,
      ap2_checkout_binding: checkoutHashMatches,
      raw_card_exposed_to_agent: false,
    },
  }, finalStatus === "approved" ? 201 : 200);
});

// Legacy-compatible endpoint, now routed through the full secure flow.
app.post("/api/purchases/attempt", async (c) => {
  const body = await c.req.json();
  return c.json({ migrated_to: "/api/agent/purchase", note: "Use the secure agentic flow with UCP + AP2 + RFC 9421 + Yuno.", received: body }, 308);
});

app.get("/api/purchases", async (c) => {
  const humanId = c.req.query("human_id");
  let query = `
    SELECT p.*, m.description AS mandate_description, me.name AS merchant_name, a.name AS agent_name, m.human_id
    FROM purchases p
    LEFT JOIN mandates m ON m.id = p.mandate_id
    LEFT JOIN merchants me ON me.id = p.merchant_id
    LEFT JOIN agents a ON a.id = p.agent_id`;
  const params = [];
  if (humanId) { query += ` WHERE m.human_id = $1`; params.push(humanId); }
  query += " ORDER BY p.created_at DESC";
  const { rows } = await pool.query(query, params);
  return c.json(rows);
});

// ---------- orders ----------
app.get("/api/orders", async (c) => {
  const { rows } = await pool.query(
    `SELECT o.*, c.item, c.total, c.currency, c.checkout_hash, me.name AS merchant_name
     FROM ucp_orders o JOIN ucp_checkout_sessions c ON c.id = o.checkout_id
     JOIN merchants me ON me.id = o.merchant_id ORDER BY o.created_at DESC`
  );
  return c.json(rows);
});

// ---------- disputes ----------
app.post("/api/purchases/:id/dispute", async (c) => {
  const purchaseId = c.req.param("id");
  const { human_id, reason } = await c.req.json();
  const { rows: purchaseRows } = await pool.query("SELECT * FROM purchases WHERE id = $1", [purchaseId]);
  const purchase = purchaseRows[0];
  if (!purchase) return c.json({ error: "Compra no encontrada" }, 404);
  const human = await getHuman(human_id);
  if (!human) return c.json({ error: "Humano no encontrado" }, 400);
  const { rows: disputeRows } = await pool.query(`INSERT INTO disputes (purchase_id, human_id, reason) VALUES ($1,$2,$3) RETURNING *`, [purchaseId, human_id, reason]);
  const dispute = disputeRows[0];

  const upheldHuman = purchase.status !== "approved" || !purchase.policy_checks?.mandate_active || !purchase.policy_checks?.amount_allowed || !purchase.policy_checks?.category_allowed || !purchase.policy_checks?.merchant_checkout_signature || !purchase.policy_checks?.checkout_hash_binding;
  const status = upheldHuman ? "upheld_human" : "upheld_merchant";
  const resolution = upheldHuman
    ? "La evidencia de la transacción no demuestra una compra válida bajo el mandato en el momento de la decisión."
    : "La evidencia muestra agente autenticado, mandato vigente, checkout firmado y compra dentro de los límites; el comerciante queda respaldado.";
  const { rows: resolved } = await pool.query(`UPDATE disputes SET status = $1, resolution = $2, resolved_at = now() WHERE id = $3 RETURNING *`, [status, resolution, dispute.id]);
  await logEvent({ event_type: "dispute_resolved", actor_type: "system", mandate_id: purchase.mandate_id, purchase_id: purchase.id, details: { status, resolution, evidence: { policy_checks: purchase.policy_checks, ap2_checkout: !!purchase.ap2_checkout_mandate_jwt, ap2_payment: !!purchase.ap2_payment_mandate_jwt, yuno_payment_id: purchase.yuno_payment_id } } });
  return c.json(resolved[0]);
});

app.get("/api/disputes", async (c) => {
  const { rows } = await pool.query("SELECT * FROM disputes ORDER BY created_at DESC");
  return c.json(rows);
});

// ---------- audit ----------
app.get("/api/audit", async (c) => {
  const { rows } = await pool.query("SELECT * FROM audit_log ORDER BY sequence_number DESC LIMIT 300");
  return c.json(rows);
});

app.get("/api/audit/verify-chain", async (c) => {
  const { rows } = await pool.query("SELECT * FROM audit_log ORDER BY sequence_number ASC");
  let previous = null;
  const failures = [];
  for (const event of rows) {
    const payload = {
      event_type: event.event_type,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      mandate_id: event.mandate_id,
      purchase_id: event.purchase_id,
      request_id: event.request_id,
      details: event.details || {},
      previous_event_hash: event.previous_event_hash,
    };
    const expected = sha256Base64Url(JSON.stringify(payload));
    if (expected !== event.event_hash || event.previous_event_hash !== previous) {
      failures.push({ sequence_number: event.sequence_number, expected, actual: event.event_hash, expected_previous: previous, actual_previous: event.previous_event_hash });
    }
    previous = event.event_hash;
  }
  return c.json({ valid: failures.length === 0, events: rows.length, failures });
});

app.notFound((c) => c.json({ error: "Ruta no encontrada" }, 404));

initDb()
  .then(() => {
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`Agentic Pay escuchando en ${BASE_URL}`);
      console.log(`Yuno mode: ${yuno.mode}`);
      console.log(`UCP discovery: ${BASE_URL}/.well-known/ucp`);
    });
  })
  .catch((error) => {
    console.error("Error inicializando la base de datos:", error);
    process.exit(1);
  });
