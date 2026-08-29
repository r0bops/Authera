import { useEffect, useState } from "react";

const LABELS = { approved: "APROBADA", rejected: "RECHAZADA", escalated: "ESCALADA" };
const COLORS = { approved: "var(--approved)", rejected: "var(--rejected)", escalated: "var(--escalated)" };

export default function DepartureRow({ purchase, pending }) {
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    if (!pending) {
      const t = setTimeout(() => setFlipped(true), 60);
      return () => clearTimeout(t);
    }
    setFlipped(false);
  }, [pending, purchase?.id]);

  const status = purchase?.status;
  const color = COLORS[status] || "var(--cream-dim)";

  return (
    <div
      className="mono"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        alignItems: "center",
        gap: 16,
        padding: "14px 18px",
        background: "var(--navy-800)",
        border: "1px solid var(--line)",
        borderRadius: 6,
      }}
    >
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "var(--font-display)" }}>
          {purchase ? purchase.item : "Esperando intento…"}
        </div>
        {purchase && (
          <div style={{ fontSize: 12, color: "var(--cream-dim)", marginTop: 3 }}>
            {purchase.category} · {purchase.currency} {Number(purchase.amount).toFixed(2)}
          </div>
        )}
        {purchase && (
          <div style={{ fontSize: 12, color: "var(--cream-dim)", marginTop: 6, maxWidth: 480 }}>
            {purchase.reason}
          </div>
        )}
      </div>

      <div style={{ perspective: 400 }}>
        <div
          style={{
            minWidth: 128,
            textAlign: "center",
            padding: "8px 14px",
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: "0.08em",
            color: pending ? "var(--cream-dim)" : color,
            border: `1px solid ${pending ? "var(--line)" : color}`,
            background: pending ? "var(--navy-700)" : `color-mix(in srgb, ${color} 14%, var(--navy-800))`,
            transform: flipped ? "rotateX(0deg)" : "rotateX(90deg)",
            transition: "transform 320ms cubic-bezier(.2,.8,.2,1), color 200ms, border-color 200ms",
            transformStyle: "preserve-3d",
          }}
        >
          {pending ? "VERIFICANDO…" : LABELS[status] || status}
        </div>
      </div>
    </div>
  );
}
