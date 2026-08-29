const base = process.env.API_BASE_URL || "http://localhost:8787";

async function get(path) {
  const response = await fetch(base + path);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error || response.status}`);
  return data;
}
async function post(path, body) {
  const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${data.error || response.status}`);
  return data;
}

const [{ id: humanId }] = await get("/api/humans");
const [{ id: agentId }] = await get("/api/agents");
const [{ id: merchantId }] = await get("/api/merchants");
let mandates = await get("/api/mandates");
let mandate = mandates.find((m) => m.agent_id === agentId && m.status === "active");
if (!mandate) throw new Error("No active mandate found");

console.log("\n1) HAPPY PATH — $130");
const ok = await post("/api/agent/purchase", { agent_id: agentId, merchant_id: merchantId, mandate_id: mandate.id, product_id: "flight-cordoba-130" });
console.log(ok.purchase.status, ok.purchase.reason);

console.log("\n2) OVER LIMIT — $300");
const over = await post("/api/agent/purchase", { agent_id: agentId, merchant_id: merchantId, mandate_id: mandate.id, product_id: "flight-cordoba-300" });
console.log(over.purchase.status, over.purchase.reason);

console.log("\n3) FORBIDDEN CATEGORY — hotel");
const hotel = await post("/api/agent/purchase", { agent_id: agentId, merchant_id: merchantId, mandate_id: mandate.id, product_id: "hotel-cordoba-100" });
console.log(hotel.purchase.status, hotel.purchase.reason);

console.log("\n4) LIVE REVOCATION");
await post(`/api/mandates/${mandate.id}/revoke`, {});
const revoked = await post("/api/agent/purchase", { agent_id: agentId, merchant_id: merchantId, mandate_id: mandate.id, product_id: "flight-cordoba-130" });
console.log(revoked.purchase.status, revoked.purchase.reason);

console.log("\n5) AUDIT CHAIN");
const chain = await get("/api/audit/verify-chain");
console.log(chain.valid ? `VALID (${chain.events} events)` : JSON.stringify(chain.failures, null, 2));
console.log(`\nHuman: ${humanId}\nAgent: ${agentId}\nMerchant: ${merchantId}\nMandate: ${mandate.id}`);
