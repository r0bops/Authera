import { useState } from "react";
import { api } from "../api";
import MandateCard from "./MandateCard";
import StatusBadge from "./StatusBadge";

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

export default function HumanView({ human, agent, mandates, purchases, onRefresh }) {
  const [revokingId, setRevokingId] = useState(null);
  const [form, setForm] = useState({
    description: "",
    category: "flights",
    max_amount: 150,
    price_below: "",
    freq_count: "",
    freq_days: 30,
    valid_days: 30,
    card_name: "",
    card_number: "",
    card_expiry: "",
    card_cvv: "",
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function revoke(id) {
    setRevokingId(id);
    try {
      await api.revokeMandate(id);
      await onRefresh();
    } finally {
      setRevokingId(null);
    }
  }

  async function createMandate(e) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await api.createMandate({
        human_id: human.id,
        agent_id: agent.id,
        description: form.description || `Compra en categoría ${form.category} hasta $${form.max_amount}`,
        category: form.category,
        max_amount: Number(form.max_amount),
        price_condition: form.price_below ? { type: "price_below", value: Number(form.price_below) } : null,
        frequency_limit: form.freq_count ? { count: Number(form.freq_count), period_days: Number(form.freq_days) } : null,
        valid_days: Number(form.valid_days),
      });
      setForm({
        ...form,
        description: "",
        card_name: "",
        card_number: "",
        card_expiry: "",
        card_cvv: "",
      });
      await onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section>
        <h2 style={sectionTitle}>Crear un mandato nuevo</h2>
        <form onSubmit={createMandate} style={{ ...panel, display: "grid", gap: 14 }}>
          <div>
            <label style={label}>Descripción (lo que le dices a tu agente)</label>
            <input
              style={input}
              placeholder='ej. "comprar un vuelo a Córdoba si baja de $150, válido hasta fin de mes"'
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 14 }}>
            <div>
              <label style={label}>Categoría</label>
              <input style={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div>
              <label style={label}>Monto máximo (USD)</label>
              <input
                type="number"
                style={input}
                value={form.max_amount}
                onChange={(e) => setForm({ ...form, max_amount: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>Comprar solo si baja de (opcional)</label>
              <input
                type="number"
                style={input}
                placeholder="ej. 150"
                value={form.price_below}
                onChange={(e) => setForm({ ...form, price_below: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>Máx. veces</label>
              <input
                type="number"
                style={input}
                placeholder="ej. 3"
                value={form.freq_count}
                onChange={(e) => setForm({ ...form, freq_count: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>...cada (días)</label>
              <input
                type="number"
                style={input}
                value={form.freq_days}
                onChange={(e) => setForm({ ...form, freq_days: e.target.value })}
              />
            </div>
            <div>
              <label style={label}>Válido por (días)</label>
              <input
                type="number"
                style={input}
                value={form.valid_days}
                onChange={(e) => setForm({ ...form, valid_days: e.target.value })}
              />
            </div>
          </div>

          <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 14, display: "grid", gap: 12, background: "rgba(25,31,52,0.45)" }}>
            <div>
              <label style={label}>Método Yuno</label>
              <div style={{ fontSize: 12, color: "var(--cream-dim)" }}>Datos de la tarjeta para el flujo de demo. No se envían al agente ni al backend.</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 14 }}>
              <div>
                <label style={label}>Nombre del titular</label>
                <input
                  style={input}
                  value={form.card_name}
                  onChange={(e) => setForm({ ...form, card_name: e.target.value })}
                  placeholder="Marta López"
                />
              </div>
              <div>
                <label style={label}>Número de tarjeta</label>
                <input
                  style={input}
                  inputMode="numeric"
                  value={form.card_number}
                  onChange={(e) => setForm({ ...form, card_number: e.target.value.replace(/\D/g, "").slice(0, 16) })}
                  placeholder="4242 4242 4242 4242"
                />
              </div>
              <div>
                <label style={label}>Vencimiento</label>
                <input
                  style={input}
                  value={form.card_expiry}
                  onChange={(e) => setForm({ ...form, card_expiry: e.target.value })}
                  placeholder="MM/AA"
                />
              </div>
              <div>
                <label style={label}>CVV</label>
                <input
                  type="password"
                  style={input}
                  inputMode="numeric"
                  value={form.card_cvv}
                  onChange={(e) => setForm({ ...form, card_cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  placeholder="123"
                />
              </div>
            </div>
          </div>
          {error && <div style={{ color: "var(--rejected)", fontSize: 13 }}>{error}</div>}
          <button
            type="submit"
            disabled={creating}
            style={{
              justifySelf: "start",
              background: "var(--amber)",
              color: "var(--navy-950)",
              border: "none",
              borderRadius: 6,
              padding: "10px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: creating ? "default" : "pointer",
              opacity: creating ? 0.7 : 1,
            }}
          >
            {creating ? "Creando…" : "Autorizar a mi agente"}
          </button>
        </form>
      </section>

      <section>
        <h2 style={sectionTitle}>Tus mandatos</h2>
        <div style={{ display: "grid", gap: 12 }}>
          {mandates.length === 0 && <div style={{ color: "var(--cream-dim)" }}>Aún no tienes mandatos.</div>}
          {mandates.map((m) => (
            <MandateCard key={m.id} mandate={m} onRevoke={revoke} revoking={revokingId === m.id} />
          ))}
        </div>
      </section>

      <section>
        <h2 style={sectionTitle}>Tu registro de compras</h2>
        <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "var(--navy-700)" }}>
                {["Artículo", "Monto", "Comerciante", "Estado", "Motivo", "Fecha"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, color: "var(--cream-dim)", fontSize: 11 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px" }}>{p.item}</td>
                  <td className="mono" style={{ padding: "10px 14px" }}>
                    {p.currency} {Number(p.amount).toFixed(2)}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{p.merchant_name}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <StatusBadge status={p.status} />
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--cream-dim)", maxWidth: 280 }}>{p.reason}</td>
                  <td className="mono" style={{ padding: "10px 14px", color: "var(--cream-dim)" }}>
                    {new Date(p.created_at).toLocaleString("es-CO")}
                  </td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: "var(--cream-dim)" }}>
                    Sin compras todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
