import crypto from "node:crypto";

export function evaluatePolicy({ mandate, agent, checkout, recentPurchaseCount, replayDetected = false, merchantId }) {
  const checks = {
    agent_exists: !!agent,
    agent_active: !!agent && agent.status === "active",
    mandate_exists: !!mandate,
    mandate_agent_match: !!mandate && !!agent && mandate.agent_id === agent.id,
    mandate_active: !!mandate && mandate.status === "active",
    mandate_not_expired: !!mandate && new Date(mandate.valid_until) >= new Date(),
    mandate_started: !!mandate && new Date(mandate.valid_from) <= new Date(),
    merchant_allowed: true,
    category_allowed: true,
    amount_allowed: true,
    currency_allowed: true,
    price_condition: true,
    frequency_allowed: true,
    replay_detected: !replayDetected,
  };

  const reasons = [];
  const decision = (status, reason) => ({ status, reason, checks, evaluated_at: new Date().toISOString() });

  if (!agent) return decision("rejected", "El agente no existe.");
  if (agent.status !== "active") return decision("rejected", "El agente está inactivo.");
  if (!mandate) return decision("rejected", "No existe un mandato válido asociado a la compra.");
  if (mandate.agent_id !== agent.id) return decision("rejected", "El mandato no pertenece al agente que intenta comprar.");
  if (mandate.status !== "active") return decision("rejected", `El mandato está en estado ${mandate.status}.`);
  if (new Date(mandate.valid_until) < new Date()) {
    checks.mandate_not_expired = false;
    return decision("rejected", "El mandato está expirado.");
  }
  if (new Date(mandate.valid_from) > new Date()) {
    checks.mandate_started = false;
    return decision("rejected", "El mandato todavía no está vigente.");
  }
  if (replayDetected) return decision("rejected", "Se detectó una solicitud repetida (replay)." );

  if (Array.isArray(mandate.allowed_merchant_ids) && mandate.allowed_merchant_ids.length && !mandate.allowed_merchant_ids.includes(merchantId)) {
    checks.merchant_allowed = false;
    return decision("rejected", "El comercio no está dentro del alcance del mandato.");
  }

  if (checkout.category !== mandate.category) {
    checks.category_allowed = false;
    return decision("rejected", `La categoría \"${checkout.category}\" no está autorizada.`);
  }
  if (checkout.currency !== mandate.currency) {
    checks.currency_allowed = false;
    return decision("rejected", `La moneda ${checkout.currency} no coincide con la moneda autorizada ${mandate.currency}.`);
  }
  if (Number(checkout.total) > Number(mandate.max_amount)) {
    checks.amount_allowed = false;
    return decision("rejected", `El monto ${checkout.currency} ${checkout.total} excede el límite ${mandate.currency} ${mandate.max_amount}.`);
  }

  if (mandate.price_condition?.type === "price_below") {
    const threshold = Number(mandate.price_condition.value);
    if (Number(checkout.total) >= threshold) {
      checks.price_condition = false;
      return decision("rejected", `El precio ${checkout.total} no está por debajo de ${threshold}.`);
    }
  }

  if (mandate.frequency_limit) {
    const { count, period_days } = mandate.frequency_limit;
    if (Number(recentPurchaseCount) >= Number(count)) {
      checks.frequency_allowed = false;
      return decision("rejected", `Se alcanzó el límite de ${count} compras cada ${period_days} días.`);
    }
  }

  if (checkout.total == null || !checkout.item || !checkout.category) {
    return decision("escalated", "El checkout no contiene datos suficientes; se requiere aprobación humana.");
  }

  reasons.push("Identidad del agente, mandato, estado de revocación, límites y checkout verificados.");
  return decision("approved", reasons.join(" "));
}

export function makeRequestId() {
  return crypto.randomUUID();
}
