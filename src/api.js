const BASE = import.meta.env.VITE_API_URL || "http://localhost:8787";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.message || `Error ${res.status}`);
  return data;
}

export const api = {
  health: () => request("/api/health"),
  humans: () => request("/api/humans"),
  agents: () => request("/api/agents"),
  merchants: () => request("/api/merchants"),
  paymentInstruments: (humanId) => request(`/api/payment-instruments?human_id=${encodeURIComponent(humanId)}`),
  mandates: () => request("/api/mandates"),
  mandate: (id) => request(`/api/mandates/${id}`),
  createMandate: (body) => request("/api/mandates", { method: "POST", body: JSON.stringify(body) }),
  revokeMandate: (id) => request(`/api/mandates/${id}/revoke`, { method: "POST" }),
  updateMandateLimit: (id, max_amount) => request(`/api/mandates/${id}/limit`, { method: "POST", body: JSON.stringify({ max_amount }) }),
  verify: (body) => request("/api/verify", { method: "POST", body: JSON.stringify(body) }),
  agentPurchase: (body) => request("/api/agent/purchase", { method: "POST", body: JSON.stringify(body) }),
  purchases: (humanId) => request(`/api/purchases${humanId ? `?human_id=${encodeURIComponent(humanId)}` : ""}`),
  orders: () => request("/api/orders"),
  dispute: (purchaseId, body) => request(`/api/purchases/${purchaseId}/dispute`, { method: "POST", body: JSON.stringify(body) }),
  audit: () => request("/api/audit"),
  verifyChain: () => request("/api/audit/verify-chain"),
  ucpDiscovery: () => request("/.well-known/ucp"),
  catalog: () => request("/ucp/shopping/catalog"),
};
