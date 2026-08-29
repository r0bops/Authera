const LABELS = {
  approved: "APROBADA",
  rejected: "RECHAZADA",
  escalated: "ESCALADA",
  active: "ACTIVO",
  revoked: "REVOCADO",
  expired: "EXPIRADO",
  open: "ABIERTA",
  upheld_human: "A FAVOR DEL HUMANO",
  upheld_merchant: "A FAVOR DEL COMERCIANTE",
};

const COLORS = {
  approved: "var(--approved)",
  active: "var(--approved)",
  rejected: "var(--rejected)",
  revoked: "var(--rejected)",
  expired: "var(--rejected)",
  escalated: "var(--escalated)",
  open: "var(--escalated)",
  upheld_human: "var(--approved)",
  upheld_merchant: "var(--amber)",
};

export default function StatusBadge({ status }) {
  const color = COLORS[status] || "var(--cream-dim)";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 3,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.06em",
        color,
        border: `1px solid ${color}`,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
      {LABELS[status] || status}
    </span>
  );
}
