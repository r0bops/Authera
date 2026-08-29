// Pure decision logic: given a mandate row (from Postgres) and a purchase
// attempt, decide approved | rejected | escalated, with a human-readable reason.
//
// Kept dependency-free and pure so it's easy to test and to reason about
// during the "trial by fire" (live revocation / limit changes).

export function evaluatePurchase({ mandate, attempt, recentPurchaseCount }) {
  const now = new Date();

  if (!mandate) {
    return reject("No existe un mandato para este agente. No se puede verificar autorización.");
  }

  if (mandate.status === "revoked") {
    return reject(`El mandato fue revocado el ${formatDate(mandate.revoked_at)}. Toda compra posterior debe fallar.`);
  }

  if (mandate.status === "expired" || new Date(mandate.valid_until) < now) {
    return reject(`El mandato expiró el ${formatDate(mandate.valid_until)}.`);
  }

  if (new Date(mandate.valid_from) > now) {
    return reject(`El mandato aún no es válido (empieza el ${formatDate(mandate.valid_from)}).`);
  }

  if (attempt.category !== mandate.category) {
    return reject(`Categoría "${attempt.category}" no está autorizada. El mandato solo cubre "${mandate.category}".`);
  }

  if (Number(attempt.amount) > Number(mandate.max_amount)) {
    return reject(`Monto $${attempt.amount} excede el límite del mandato ($${mandate.max_amount}).`);
  }

  if (mandate.price_condition) {
    const cond = mandate.price_condition;
    if (cond.type === "price_below" && Number(attempt.amount) >= Number(cond.value)) {
      return reject(`El precio ($${attempt.amount}) no bajó del umbral requerido ($${cond.value}).`);
    }
  }

  if (mandate.frequency_limit) {
    const freq = mandate.frequency_limit;
    if (typeof recentPurchaseCount === "number" && recentPurchaseCount >= freq.count) {
      return reject(`Se alcanzó el límite de frecuencia (${freq.count} compras cada ${freq.period_days} días).`);
    }
  }

  if (attempt.amount == null || attempt.category == null || !attempt.item) {
    return escalate("Faltan datos claros de la compra; se requiere aprobación humana antes de continuar.");
  }

  return approve("Compra dentro de los límites del mandato: categoría, monto y condiciones verificadas.");
}

function approve(reason) {
  return { status: "approved", reason };
}
function reject(reason) {
  return { status: "rejected", reason };
}
function escalate(reason) {
  return { status: "escalated", reason };
}
function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toISOString().slice(0, 10);
}
