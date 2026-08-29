import StatusBadge from "./StatusBadge";

function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MandateCard({ mandate, onRevoke, revoking }) {
  const cond = mandate.price_condition;
  const freq = mandate.frequency_limit;

  return (
    <div
      style={{
        background: "var(--navy-800)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        opacity: mandate.status === "active" ? 1 : 0.55,
      }}
    >
      <div style={{ flex: 1, padding: "18px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div className="mono" style={{ fontSize: 11, color: "var(--cream-dim)", letterSpacing: "0.08em" }}>
              MANDATO #{mandate.id.slice(0, 8).toUpperCase()}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, marginTop: 4 }}>
              {mandate.description}
            </div>
          </div>
          <StatusBadge status={mandate.status} />
        </div>

        <div
          className="mono"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 14,
            marginTop: 16,
            fontSize: 12,
          }}
        >
          <div>
            <div style={{ color: "var(--cream-dim)" }}>CATEGORÍA</div>
            <div style={{ marginTop: 3, fontWeight: 600 }}>{mandate.category}</div>
          </div>
          <div>
            <div style={{ color: "var(--cream-dim)" }}>LÍMITE</div>
            <div style={{ marginTop: 3, fontWeight: 600 }}>
              {mandate.currency} {Number(mandate.max_amount).toFixed(2)}
            </div>
          </div>
          {cond && (
            <div>
              <div style={{ color: "var(--cream-dim)" }}>CONDICIÓN</div>
              <div style={{ marginTop: 3, fontWeight: 600 }}>
                {cond.type === "price_below" ? `si baja de $${cond.value}` : cond.type}
              </div>
            </div>
          )}
          {freq && (
            <div>
              <div style={{ color: "var(--cream-dim)" }}>FRECUENCIA</div>
              <div style={{ marginTop: 3, fontWeight: 600 }}>
                hasta {freq.count}x / {freq.period_days}d
              </div>
            </div>
          )}
          <div>
            <div style={{ color: "var(--cream-dim)" }}>VÁLIDO HASTA</div>
            <div style={{ marginTop: 3, fontWeight: 600 }}>{fmtDate(mandate.valid_until)}</div>
          </div>
          <div>
            <div style={{ color: "var(--cream-dim)" }}>MÉTODO DE PAGO</div>
            <div style={{ marginTop: 3, fontWeight: 600 }}>{mandate.payment_method}</div>
          </div>
        </div>

        {mandate.status === "active" && onRevoke && (
          <button
            onClick={() => onRevoke(mandate.id)}
            disabled={revoking}
            style={{
              marginTop: 16,
              background: "transparent",
              color: "var(--rejected)",
              border: "1px solid var(--rejected)",
              borderRadius: 6,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: revoking ? "default" : "pointer",
              opacity: revoking ? 0.6 : 1,
            }}
          >
            {revoking ? "Revocando…" : "Revocar mandato ahora"}
          </button>
        )}
        {mandate.status === "revoked" && (
          <div className="mono" style={{ marginTop: 14, fontSize: 12, color: "var(--rejected)" }}>
            Revocado el {fmtDate(mandate.revoked_at)} — toda compra posterior fallará.
          </div>
        )}
      </div>

      {/* perforated boarding-pass stub */}
      <div
        aria-hidden
        style={{
          width: 96,
          borderLeft: "2px dashed var(--line)",
          background: "var(--navy-700)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "12px 8px",
        }}
      >
        <div className="mono" style={{ fontSize: 10, color: "var(--cream-dim)", writingMode: "vertical-rl" }}>
          {mandate.agent_name}
        </div>
      </div>
    </div>
  );
}
