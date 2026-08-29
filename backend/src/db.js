import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { generateEcKeyPair, signJwtEs256 } from "./crypto.js";
import { createOpenCheckoutMandate } from "./ap2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/agentic_pay",
});

const privateKeyDir = process.env.PRIVATE_KEY_DIR || path.resolve(__dirname, "../.keys");

export function getPrivateKeyPath(kind, id) {
  return path.join(privateKeyDir, `${kind}-${id}.pem`);
}

export function savePrivateKey(kind, id, privateKey) {
  fs.mkdirSync(privateKeyDir, { recursive: true, mode: 0o700 });
  const file = getPrivateKeyPath(kind, id);
  fs.writeFileSync(file, privateKey, { mode: 0o600 });
  return file;
}

export function readPrivateKey(kind, id) {
  return fs.readFileSync(getPrivateKeyPath(kind, id), "utf8");
}

export async function initDb() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  await seed();
  await ensureSecurityMaterial();
}

async function ensureSecurityMaterial() {
  // Upgrade a database created by Agentic Pay 1.x without silently storing raw secrets.
  const { rows: humans } = await pool.query("SELECT id, trusted_surface_public_key FROM humans ORDER BY created_at");
  for (const human of humans) {
    const keyPath = getPrivateKeyPath("human", human.id);
    if (!human.trusted_surface_public_key || !fs.existsSync(keyPath)) {
      const keys = generateEcKeyPair();
      savePrivateKey("human", human.id, keys.privateKey);
      await pool.query(`UPDATE humans SET trusted_surface_key_id = COALESCE(trusted_surface_key_id, $1), trusted_surface_public_key = $2 WHERE id = $3`, [`ts-${human.id}-v1`, keys.publicKey, human.id]);
    }
  }

  const { rows: agents } = await pool.query("SELECT id, key_id, public_key FROM agents ORDER BY created_at");
  for (const agent of agents) {
    const keyPath = getPrivateKeyPath("agent", agent.id);
    if (!agent.public_key || !fs.existsSync(keyPath)) {
      const keys = generateEcKeyPair();
      savePrivateKey("agent", agent.id, keys.privateKey);
      await pool.query(`UPDATE agents SET key_id = COALESCE(key_id, $1), public_key = $2, algorithm = 'ES256' WHERE id = $3`, [`agent-${agent.id}-v1`, keys.publicKey, agent.id]);
    }
  }

  const { rows: merchants } = await pool.query("SELECT id, key_id, public_key FROM merchants ORDER BY created_at");
  for (const merchant of merchants) {
    const keyPath = getPrivateKeyPath("merchant", merchant.id);
    if (!merchant.public_key || !fs.existsSync(keyPath)) {
      const keys = generateEcKeyPair();
      savePrivateKey("merchant", merchant.id, keys.privateKey);
      await pool.query(`UPDATE merchants SET key_id = COALESCE(key_id, $1), public_key = $2, algorithm = 'ES256', profile_url = COALESCE(profile_url, $3) WHERE id = $4`, [`merchant-${merchant.id}-v1`, keys.publicKey, `http://localhost:${process.env.PORT || 8787}/.well-known/ucp`, merchant.id]);
    }
  }

  const { rows: legacyMandates } = await pool.query(`SELECT m.*, h.trusted_surface_public_key FROM mandates m JOIN humans h ON h.id = m.human_id WHERE m.ap2_open_mandate_jwt IS NULL`);
  for (const mandate of legacyMandates) {
    if (!fs.existsSync(getPrivateKeyPath("human", mandate.human_id))) continue;
    const jwt = createOpenCheckoutMandate({ privateKey: readPrivateKey("human", mandate.human_id), mandate });
    await pool.query("UPDATE mandates SET ap2_open_mandate_jwt = $1 WHERE id = $2", [jwt, mandate.id]);
  }

  const { rows: missingPayments } = await pool.query(`SELECT h.id AS human_id FROM humans h LEFT JOIN payment_instruments pi ON pi.human_id = h.id WHERE pi.id IS NULL`);
  for (const row of missingPayments) {
    await pool.query(`INSERT INTO payment_instruments (human_id, provider, provider_customer_id, token_type, vaulted_token, type, brand, last4) VALUES ($1,'YUNO',CONCAT('legacy-demo-customer-', $1),'vaulted','yuno_demo_vaulted_4242','CARD','VISA','4242')`, [row.human_id]);
  }
  await pool.query(`UPDATE mandates m SET payment_instrument_id = pi.id FROM payment_instruments pi WHERE m.payment_instrument_id IS NULL AND pi.human_id = m.human_id`);
}

async function seed() {
  const { rows } = await pool.query("SELECT id FROM humans LIMIT 1");
  if (rows.length > 0) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const humanKeys = generateEcKeyPair();
    const agentKeys = generateEcKeyPair();
    const merchantKeys = generateEcKeyPair();

    const human = await client.query(
      `INSERT INTO humans (name, email, trusted_surface_key_id, trusted_surface_public_key)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      ["Marta Gómez", "marta@example.com", "ts-marta-v1", humanKeys.publicKey]
    );
    const humanId = human.rows[0].id;
    savePrivateKey("human", humanId, humanKeys.privateKey);

    const agent = await client.query(
      `INSERT INTO agents (human_id, name, api_key, key_id, public_key, algorithm)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [humanId, "Agente de viajes de Marta", crypto.randomUUID(), "agent-marta-v1", agentKeys.publicKey, "ES256"]
    );
    const agentId = agent.rows[0].id;
    savePrivateKey("agent", agentId, agentKeys.privateKey);

    const merchant = await client.query(
      `INSERT INTO merchants (name, api_key, key_id, public_key, algorithm, profile_url)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      ["VuelaYa", crypto.randomUUID(), "merchant-vuelaya-v1", merchantKeys.publicKey, "ES256", "http://localhost:8787/.well-known/ucp"]
    );
    const merchantId = merchant.rows[0].id;
    savePrivateKey("merchant", merchantId, merchantKeys.privateKey);

    const token = process.env.DEMO_YUNO_VAULTED_TOKEN || "yuno_demo_vaulted_4242";
    const payment = await client.query(
      `INSERT INTO payment_instruments (human_id, provider, provider_customer_id, token_type, vaulted_token, type, brand, last4)
       VALUES ($1,$2,$3,'vaulted',$4,$5,$6,$7) RETURNING id`,
      [humanId, "YUNO", "demo-customer-marta", token, "CARD", "VISA", "4242"]
    );
    const paymentId = payment.rows[0].id;

    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + 1);
    validUntil.setDate(0);

    const mandateSnapshot = {
      id: crypto.randomUUID(),
      human_id: humanId,
      agent_id: agentId,
      description: "Comprar un vuelo a Córdoba si baja de $150, válido hasta fin de mes",
      category: "flights",
      max_amount: 150,
      currency: "USD",
      price_condition: { type: "price_below", value: 150 },
      frequency_limit: { count: 3, period_days: 30 },
      valid_until: validUntil.toISOString(),
      payment_instrument_id: paymentId,
    };

    const openJwt = createOpenCheckoutMandate({ privateKey: humanKeys.privateKey, mandate: mandateSnapshot });

    const mandate = await client.query(
      `INSERT INTO mandates
        (id, human_id, agent_id, description, category, max_amount, currency, price_condition, frequency_limit,
         payment_instrument_id, valid_until, ap2_open_mandate_jwt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        mandateSnapshot.id,
        humanId,
        agentId,
        mandateSnapshot.description,
        mandateSnapshot.category,
        mandateSnapshot.max_amount,
        mandateSnapshot.currency,
        JSON.stringify(mandateSnapshot.price_condition),
        JSON.stringify(mandateSnapshot.frequency_limit),
        paymentId,
        validUntil.toISOString(),
        openJwt,
      ]
    );
    const mandateId = mandate.rows[0].id;

    await client.query(
      `INSERT INTO mandate_versions (mandate_id, version, snapshot, signature) VALUES ($1,$2,$3,$4)`,
      [mandateId, 1, JSON.stringify({ ...mandateSnapshot, id: mandateId }), openJwt]
    );

    await client.query("COMMIT");
    console.log("Seed inicial creado: Marta / agente firmado / VuelaYa / Yuno demo / mandato AP2");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
