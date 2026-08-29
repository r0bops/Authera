import { useState } from "react";
import { api } from "../api";
import DepartureRow from "./DepartureRow";

const panel = { background: "var(--navy-800)", border: "1px solid var(--line)", borderRadius: 8, padding: 20 };
const input = {
  width: "100%",
  background: "var(--navy-900)",
  border: "1px solid var(--line)",
  borderRadius: 6,
  padding: "9px 10px",
  color: "var(--cream)",
  fontSize: 13,
  fontFamily: "inherit",
};
const label = { fontSize: 11, color: "var(--cream-dim)", letterSpacing: "0.06em", marginBottom: 5, display: "block" };

const PRESETS = [
  { name: "Vuelo a $130 (dentro del mandato)", item: "Vuelo Bogotá–Córdoba", category: "flights", amount: 130 },
  { name: "Vuelo a $300 (excede el monto)", item: "Vuelo Bogotá–Córdoba, clase ejecutiva", category: "flights", amount: 300 },
  { name: "Hotel a $90 (categoría no autorizada)", item: "Hotel en Córdoba, 2 noches", category: "hotels", amount: 90 },
];

export default function AgentView({ agent, merchant, mandates, onRefresh }) {
  const activeMandate = mandates.find((m) => m.status === "active") || mandates[0];
  const [mandateId, setMandateId] = useState(activeMandate?.id || "");
  const [form, setForm] = useState({ item: "Vuelo Bogotá–Córdoba", category: "flights", amount: 130 });
  const [pending, setPending] = useState(false);
  const [attempts, setAttempts] = useState([]);

  const mandate = mandates.find((m) => m.id === mandateId) || mandates.find((m) => m.id === activeMandate?.id);

  async function attempt(e) {
    e?.preventDefault();
    setPending(true);
    const placeholderId = `pending-${Date.now()}`;
    setAttempts((prev) => [{ id: placeholderId, item: form.item, category: form.category, amount: form.amount, currency: "USD" }, ...prev]);
    try {
      const purchase = await api.attemptPurchase({
        agent_id: agent.id,
        merchant_id: merchant.id,
        mandate_id: mandateId || mandate?.id || null,
        item: form.item,
        category: form.category,
        amount: Number(form.amount),
      });
      setAttempts((prev) => [purchase, ...prev.filter((a) => a.id !== placeholderId)]);
      await onRefresh();
    } finally {
      setPending(false);
    }
  }

  function usePreset(p) {
    setForm({ item: p.item, category: p.category, amount: p.amount });
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section>
        <h2 style={sectionTitle}>Simular un intento de compra</h2>
        <p style={{ color: "var(--cream-dim)", fontSize: 13, marginTop: -4, marginBottom: 14 }}>
          Este panel actúa como el agente de {agent?.name.replace("Agente de viajes de ", "")}: elige qué intenta comprar
          y contra qué mandato, y observa la decisión en vivo.
        </p>
        <form onSubmit={attempt} style={{ ...panel, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => usePreset(p)}
                style={{
                  background: "var(--navy-700)",
                  color: "var(--cream)",
                  border: "1px solid var(--line)",
                  borderRadius: 20,
                  padding: "6px 12px",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 14 }}>
            <div>
              <label style={label}>Mandato a usar</label>
              <select style={input} value={mandateId} onChange={(e) => setMandateId(e.target.value)}>
                {mandates.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.status === "active" ? "🟢" : "🔴"} {m.description.slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Artículo</label>
              <input style={input} value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} />
            </div>
            <div>
              <label style={label}>Categoría</label>
              <input style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div>
              <label style={label}>Monto (USD)</label>
              <input
                type="number"
                style={input}
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
          </div>

          {mandate && mandate.status !== "active" && (
            <div className="mono" style={{ fontSize: 12, color: "var(--rejected)" }}>
              Este mandato está {mandate.status === "revoked" ? "revocado" : "expirado"} — el intento debería fallar.
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            style={{
              justifySelf: "start",
              background: "var(--amber)",
              color: "var(--navy-950)",
              border: "none",
              borderRadius: 6,
              padding: "10px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: pending ? "default" : "pointer",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {pending ? "Intentando…" : "Intentar compra"}
          </button>
        </form>
      </section>

      <section>
        <h2 style={sectionTitle}>Tablero de intentos</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {attempts.length === 0 && <div style={{ color: "var(--cream-dim)" }}>Sin intentos todavía.</div>}
          {attempts.map((a) => (
            <DepartureRow key={a.id} purchase={a} pending={a.id.toString().startsWith("pending")} />
          ))}
        </div>
      </section>
    </div>
  );
}

const sectionTitle = {
  fontFamily: "var(--font-display)",
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: "var(--amber)",
  textTransform: "uppercase",
  marginBottom: 10,
};
