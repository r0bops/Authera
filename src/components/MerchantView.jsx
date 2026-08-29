import { useState } from "react";
import { api } from "../api";

const panel = { background: "var(--navy-800)", border: "1px solid var(--line)", borderRadius: 8, padding: 20 };

export default function MerchantView({ merchant, agent, mandates, purchases }) {
  const [mandateId, setMandateId] = useState(mandates[0]?.id || "");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function runVerify() {
    setLoading(true);
    try {
      const r = await api.verify({ agent_id: agent.id, mandate_id: mandateId, merchant_id: merchant.id });
      setResult(r);
    } finally {
      setLoading(false);
    }
  }

  const incoming = purchases.filter((p) => p.merchant_name === merchant.name);

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section>
        <h2 style={sectionTitle}>Verificación previa a la compra</h2>
        <p style={{ color: "var(--cream-dim)", fontSize: 13, marginTop: -4, marginBottom: 14 }}>
          Así es como {merchant.name} confirma que el agente que se presenta representa a un humano real, con un
          mandato vigente, antes de aceptar el pago.
        </p>
        <div style={{ ...panel, display: "grid", gap: 14 }}>
          <select
            value={mandateId}
            onChange={(e) => setMandateId(e.target.value)}
            style={{
              background: "var(--navy-900)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: "9px 10px",
              color: "var(--cream)",
              fontSize: 13,
            }}
          >
            {mandates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.description.slice(0, 50)}
              </option>
            ))}
          </select>
          <button
            onClick={runVerify}
            disabled={loading}
            style={{
              justifySelf: "start",
              background: "var(--amber)",
              color: "var(--navy-950)",
              border: "none",
              borderRadius: 6,
              padding: "10px 18px",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Verificando…" : "Verificar agente y mandato"}
          </button>

          {result && (
            <div
              className="mono"
              style={{
                marginTop: 4,
                borderTop: "1px solid var(--line)",
                paddingTop: 14,
                display: "grid",
                gap: 6,
                fontSize: 13,
              }}
            >
              <Row label="Agente encontrado" value={result.agent_found ? "sí" : "no"} good={result.agent_found} />
              <Row label="Mandato encontrado" value={result.mandate_found ? "sí" : "no"} good={result.mandate_found} />
              <Row label="Estado del mandato" value={result.mandate_status || "-"} good={result.mandate_status === "active"} />
              <Row label="Mandato expirado" value={result.mandate_expired ? "sí" : "no"} good={!result.mandate_expired} />
              <Row
                label="Resultado"
                value={result.verified ? "VERIFICADO — puede proceder a comprar" : "NO VERIFICADO — rechazar"}
                good={result.verified}
                strong
              />
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 style={sectionTitle}>Pagos recibidos por {merchant.name}</h2>
        <div style={{ ...panel, padding: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", background: "var(--navy-700)" }}>
                {["Artículo", "Monto", "Estado", "Fecha"].map((h) => (
                  <th key={h} style={{ padding: "10px 14px", fontWeight: 600, color: "var(--cream-dim)", fontSize: 11 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {incoming.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "10px 14px" }}>{p.item}</td>
                  <td className="mono" style={{ padding: "10px 14px" }}>
                    {p.currency} {Number(p.amount).toFixed(2)}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{p.status}</td>
                  <td className="mono" style={{ padding: "10px 14px", color: "var(--cream-dim)" }}>
                    {new Date(p.created_at).toLocaleString("es-CO")}
                  </td>
                </tr>
              ))}
              {incoming.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 16, color: "var(--cream-dim)" }}>
                    Sin pagos todavía.
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

function Row({ label, value, good, strong }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--cream-dim)" }}>{label}</span>
      <span style={{ color: good ? "var(--approved)" : "var(--rejected)", fontWeight: strong ? 700 : 500 }}>{value}</span>
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
