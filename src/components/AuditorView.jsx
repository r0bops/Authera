import { useState } from "react";

const EVENT_LABEL = {
  mandate_created: "Mandato creado",
  mandate_revoked: "Mandato revocado",
  merchant_verification: "Verificación de comerciante",
  purchase_approved: "Compra aprobada",
  purchase_rejected: "Compra rechazada",
  purchase_escalated: "Compra escalada",
  dispute_resolved: "Disputa resuelta",
};

const EVENT_COLOR = {
  mandate_created: "var(--amber)",
  mandate_revoked: "var(--rejected)",
  merchant_verification: "var(--cream-dim)",
  purchase_approved: "var(--approved)",
  purchase_rejected: "var(--rejected)",
  purchase_escalated: "var(--escalated)",
  dispute_resolved: "var(--amber)",
};

export default function AuditorView({ audit }) {
  const [filter, setFilter] = useState("all");
  const types = ["all", ...new Set(audit.map((a) => a.event_type))];
  const rows = filter === "all" ? audit : audit.filter((a) => a.event_type === filter);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={sectionTitle}>Rastro de auditoría</h2>
        <p style={{ color: "var(--cream-dim)", fontSize: 13, marginTop: -4 }}>
          Cada decisión — creación, verificación, compra, revocación, disputa — queda registrada de forma legible
          para el humano, el comerciante y un auditor externo.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {types.map((t) => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              background: filter === t ? "var(--amber)" : "var(--navy-700)",
              color: filter === t ? "var(--navy-950)" : "var(--cream)",
              border: "1px solid var(--line)",
              borderRadius: 20,
              padding: "5px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontWeight: filter === t ? 700 : 400,
            }}
          >
            {t === "all" ? "Todos" : EVENT_LABEL[t] || t}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((e) => (
          <div
            key={e.id}
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 16,
              padding: "12px 16px",
              background: "var(--navy-800)",
              border: "1px solid var(--line)",
              borderLeft: `3px solid ${EVENT_COLOR[e.event_type] || "var(--line)"}`,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, color: EVENT_COLOR[e.event_type] || "var(--cream)" }}>
                {EVENT_LABEL[e.event_type] || e.event_type}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--cream-dim)", marginTop: 2 }}>
                {new Date(e.created_at).toLocaleString("es-CO")}
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--cream-dim)" }}>
                actor: {e.actor_type}
              </div>
            </div>
            <div className="mono" style={{ color: "var(--cream-dim)", fontSize: 12, wordBreak: "break-word" }}>
              {Object.entries(e.details || {}).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: "var(--cream)" }}>{k}</span>: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                </div>
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <div style={{ color: "var(--cream-dim)" }}>Sin eventos todavía.</div>}
      </div>
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
  marginBottom: 6,
};
