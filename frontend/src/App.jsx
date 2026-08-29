import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const TABS = [
  ["human", "Humano", "Marta"],
  ["agent", "Agente", "Compra segura"],
  ["merchant", "Comerciante", "VuelaYa"],
  ["audit", "Auditor", "Evidencia"],
];

const card = { background: "var(--navy-800)", border: "1px solid var(--line)", borderRadius: 10, padding: 18 };
const mono = { fontFamily: "var(--font-mono, monospace)" };
const input = { width: "100%", boxSizing: "border-box", background: "var(--navy-900)", color: "var(--cream)", border: "1px solid var(--line)", borderRadius: 7, padding: "9px 10px" };
const label = { fontSize: 11, color: "var(--cream-dim)", marginBottom: 5, display: "block", letterSpacing: ".04em" };

export default function App() {
  const [tab, setTab] = useState("human");
  const [online, setOnline] = useState(null);
  const [data, setData] = useState({ humans: [], agents: [], merchants: [], mandates: [], purchases: [], audit: [], orders: [] });
  const [selectedProduct, setSelectedProduct] = useState("flight-cordoba-130");
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const refresh = useCallback(async () => {
    const [health, humans, agents, merchants, mandates, purchases, audit, orders] = await Promise.all([
      api.health(), api.humans(), api.agents(), api.merchants(), api.mandates(), api.purchases(), api.audit(), api.orders(),
    ]);
    setData({ humans, agents, merchants, mandates, purchases, audit, orders });
    setOnline(!!health.ok);
  }, []);

  useEffect(() => {
    refresh().catch(() => setOnline(false));
    const id = setInterval(() => refresh().catch(() => setOnline(false)), 3500);
    return () => clearInterval(id);
  }, [refresh]);

  const human = data.humans[0];
  const agent = data.agents[0];
  const merchant = data.merchants[0];
  const mandate = data.mandates.find((m) => m.agent_id === agent?.id) || data.mandates[0];

  async function buy(product_id = selectedProduct) {
    if (!agent || !merchant || !mandate) return;
    setBusy(true); setLastResult(null);
    try {
      const result = await api.agentPurchase({ agent_id: agent.id, merchant_id: merchant.id, mandate_id: mandate.id, product_id });
      setLastResult(result); await refresh();
    } catch (error) {
      setLastResult({ error: error.message });
      await refresh();
    } finally { setBusy(false); }
  }

  const activeMandates = useMemo(() => data.mandates.filter((m) => m.status === "active"), [data.mandates]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--navy-950)", color: "var(--cream)" }}>
      <header style={{ borderBottom: "1px solid var(--line)", padding: "18px 28px", background: "var(--navy-900)", display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 800 }}>AGENTIC PAY <span style={{ color: "var(--amber)" }}>· VuelaYa</span></div>
          <div style={{ ...mono, fontSize: 11, color: "var(--cream-dim)", marginTop: 3 }}>UCP · AP2 · RFC 9421 · Policy Engine · Yuno · Audit</div>
        </div>
        <div style={{ ...mono, fontSize: 11, color: online ? "var(--approved)" : "var(--rejected)" }}>{online ? "● backend conectado" : "● backend no disponible"}</div>
      </header>

      <nav style={{ display: "flex", borderBottom: "1px solid var(--line)", overflowX: "auto" }}>
        {TABS.map(([id, title, sub]) => (
          <button key={id} onClick={() => setTab(id)} style={{ background: "transparent", color: tab === id ? "var(--cream)" : "var(--cream-dim)", border: "none", borderBottom: tab === id ? "2px solid var(--amber)" : "2px solid transparent", padding: "14px 22px", cursor: "pointer", minWidth: 150, textAlign: "left" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 13 }}>{title.toUpperCase()}</div>
            <div style={{ ...mono, fontSize: 10, marginTop: 2 }}>{sub}</div>
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 1120, margin: "0 auto", padding: 28 }}>
        {!online && online !== null && <div style={{ ...card, borderColor: "var(--rejected)", marginBottom: 18 }}>No se pudo conectar con {import.meta.env.VITE_API_URL || "http://localhost:8787"}.</div>}
        {online && human && agent && merchant && mandate && (
          <>
            {tab === "human" && <HumanPanel human={human} agent={agent} mandates={data.mandates} onRefresh={refresh} />}
            {tab === "agent" && <AgentPanel agent={agent} merchant={merchant} mandate={mandate} busy={busy} buy={buy} selectedProduct={selectedProduct} setSelectedProduct={setSelectedProduct} lastResult={lastResult} />}
            {tab === "merchant" && <MerchantPanel merchant={merchant} agent={agent} mandates={data.mandates} catalog={api.catalog} />}
            {tab === "audit" && <AuditPanel audit={data.audit} verifyChain={api.verifyChain} result={lastResult} />}
          </>
        )}
      </main>

      <footer style={{ borderTop: "1px solid var(--line)", padding: 12, textAlign: "center", ...mono, fontSize: 11, color: "var(--cream-dim)" }}>
        Prototipo académico · pagos reales desactivados por defecto (YUNO_MODE=mock)
      </footer>
    </div>
  );
}

function HumanPanel({ human, agent, mandates, onRefresh }) {
  const [form, setForm] = useState({ description: "", category: "flights", max_amount: 150, price_below: 150, freq_count: 3, freq_days: 30, valid_days: 30, card_name: "", card_number: "", card_expiry: "", card_cvv: "" });
  const [message, setMessage] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [paymentMethods, setPaymentMethods] = useState([]);
  useEffect(() => { api.paymentInstruments(human.id).then(setPaymentMethods).catch(() => {}); }, [human.id]);

  async function create(e) {
    e.preventDefault(); setMessage("");
    try {
      await api.createMandate({ human_id: human.id, agent_id: agent.id, description: form.description || `Compra ${form.category} hasta ${form.max_amount}`, category: form.category, max_amount: Number(form.max_amount), currency: "USD", price_condition: form.price_below ? { type: "price_below", value: Number(form.price_below) } : null, frequency_limit: form.freq_count ? { count: Number(form.freq_count), period_days: Number(form.freq_days) } : null, payment_instrument_id: paymentId || paymentMethods[0]?.id || null, valid_days: Number(form.valid_days) });
      setMessage("Mandato creado y firmado por la Trusted Surface."); await onRefresh();
    } catch (e) { setMessage(e.message); }
  }
  async function revoke(id) { await api.revokeMandate(id); await onRefresh(); }
  async function changeLimit(id) { const value = prompt("Nuevo límite USD", "100"); if (value) { await api.updateMandateLimit(id, Number(value)); await onRefresh(); } }

  return <div style={{ display: "grid", gap: 20 }}>
    <section>
      <h2 style={sectionTitle}>Trusted Surface / Humano</h2>
      <p style={desc}>Marta crea un mandato de gasto sin entregar la tarjeta al agente. La demo usa un instrumento Yuno tokenizado.</p>
      <form onSubmit={create} style={{ ...card, display: "grid", gap: 12 }}>
        <div><label style={label}>Descripción</label><input style={input} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder='comprar vuelo a Córdoba si baja de $150' /></div>
        <div style={grid3}>
          <div><label style={label}>Categoría</label><input style={input} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
          <div><label style={label}>Límite</label><input style={input} type="number" value={form.max_amount} onChange={e => setForm({ ...form, max_amount: e.target.value })} /></div>
          <div><label style={label}>Precio <</label><input style={input} type="number" value={form.price_below} onChange={e => setForm({ ...form, price_below: e.target.value })} /></div>
        </div>
        <div style={grid3}>
          <div><label style={label}>Máximo de compras</label><input style={input} type="number" value={form.freq_count} onChange={e => setForm({ ...form, freq_count: e.target.value })} /></div>
          <div><label style={label}>Periodo (días)</label><input style={input} type="number" value={form.freq_days} onChange={e => setForm({ ...form, freq_days: e.target.value })} /></div>
          <div><label style={label}>Vigencia (días)</label><input style={input} type="number" value={form.valid_days} onChange={e => setForm({ ...form, valid_days: e.target.value })} /></div>
        </div>
        <div style={{ ...card, padding: 14, display: "grid", gap: 12 }}>
          <div>
            <label style={label}>Método Yuno</label>
            <div style={{ ...mono, fontSize: 11, color: "var(--cream-dim)" }}>Datos de tarjeta para el flujo de demo. No se comparten con el agente.</div>
          </div>
          <div style={grid3}>
            <div><label style={label}>Titular</label><input style={input} value={form.card_name} onChange={e => setForm({ ...form, card_name: e.target.value })} placeholder="Marta López" /></div>
            <div><label style={label}>Número</label><input style={input} inputMode="numeric" value={form.card_number} onChange={e => setForm({ ...form, card_number: e.target.value.replace(/\D/g, "").slice(0, 16) })} placeholder="4242 4242 4242 4242" /></div>
            <div><label style={label}>Vencimiento</label><input style={input} value={form.card_expiry} onChange={e => setForm({ ...form, card_expiry: e.target.value })} placeholder="MM/AA" /></div>
            <div><label style={label}>CVV</label><input style={input} type="password" inputMode="numeric" value={form.card_cvv} onChange={e => setForm({ ...form, card_cvv: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="123" /></div>
          </div>
          <select style={input} value={paymentId} onChange={e => setPaymentId(e.target.value)}><option value="">Predeterminado ({paymentMethods[0]?.brand || "VISA"} •••• {paymentMethods[0]?.last4 || "4242"})</option>{paymentMethods.map(p => <option key={p.id} value={p.id}>{p.provider} · {p.brand} •••• {p.last4}</option>)}</select>
        </div>
        <button style={primary}>Firmar y crear mandato</button>
        {message && <div style={{ ...mono, fontSize: 12, color: message.includes("creado") ? "var(--approved)" : "var(--rejected)" }}>{message}</div>}
      </form>
    </section>
    <section><h2 style={sectionTitle}>Mandatos</h2><div style={{ display: "grid", gap: 10 }}>{mandates.map(m => <div key={m.id} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}><strong>{m.description}</strong><Status status={m.status} /></div>
      <div style={{ ...mono, fontSize: 11, color: "var(--cream-dim)", marginTop: 8 }}>v{m.version} · {m.category} · ≤ {m.currency} {m.max_amount} · Yuno {m.brand || "VISA"} •••• {m.last4 || "4242"}</div>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {m.status === "active" && <><button onClick={() => revoke(m.id)} style={danger}>Revocar en vivo</button><button onClick={() => changeLimit(m.id)} style={secondary}>Cambiar límite</button></>}
        <span style={{ ...mono, fontSize: 10, color: "var(--cream-dim)", alignSelf: "center" }}>AP2 open mandate: {m.ap2_open_mandate_jwt ? "✓" : "—"}</span>
      </div>
    </div>)}</div></section>
  </div>;
}

function AgentPanel({ agent, merchant, mandate, busy, buy, selectedProduct, setSelectedProduct, lastResult }) {
  return <div style={{ display: "grid", gap: 20 }}>
    <section><h2 style={sectionTitle}>Shopping Agent</h2><p style={desc}>El agente firma su request HTTP con ES256. El servidor UCP verifica la firma antes de crear el checkout.</p>
      <div style={{ ...card, display: "grid", gap: 12 }}>
        <div style={{ ...mono, fontSize: 12 }}>agent_id = {agent.id}<br />key_id = {agent.key_id}<br />algorithm = {agent.algorithm}<br />mandate = {mandate.id} · v{mandate.version} · {mandate.status}</div>
        <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} style={input}>
          <option value="flight-cordoba-130">Vuelo Córdoba · USD 130 · permitido</option>
          <option value="flight-cordoba-300">Vuelo Córdoba Premium · USD 300 · excede límite</option>
          <option value="hotel-cordoba-100">Hotel Córdoba · USD 100 · categoría prohibida</option>
        </select>
        <button disabled={busy} onClick={() => buy()} style={{ ...primary, opacity: busy ? .6 : 1 }}>{busy ? "Ejecutando UCP → AP2 → Policy → Yuno…" : "Ejecutar compra agéntica"}</button>
        {lastResult && <ResultCard result={lastResult} />}
      </div>
    </section>
    <section><h2 style={sectionTitle}>Prueba de adversario</h2><div style={card}><p style={desc}>La implementación rechaza una firma si el request declara el ID de otro agente. También bloquea replay mediante <code>request_id</code> único.</p><div style={{ ...mono, fontSize: 11, color: "var(--cream-dim)" }}>Raw PAN/CVV reaches agent: <b style={{ color: "var(--approved)" }}>NO</b><br />Replay protection: <b style={{ color: "var(--approved)" }}>YES</b><br />Live revocation checked before payment: <b style={{ color: "var(--approved)" }}>YES</b></div></div></section>
  </div>;
}

function ResultCard({ result }) {
  if (result.error) return <div style={{ ...card, borderColor: "var(--rejected)", color: "var(--rejected)" }}>{result.error}</div>;
  const p = result.purchase;
  const checks = result.policy?.checks || p?.policy_checks || {};
  return <div style={{ ...card, padding: 14, borderColor: p?.status === "approved" ? "var(--approved)" : "var(--rejected)" }}>
    <div style={{ display: "flex", justifyContent: "space-between" }}><strong>Resultado: {String(p?.status || "?").toUpperCase()}</strong><span className="mono">{p?.currency} {p?.amount}</span></div>
    <div style={{ ...mono, fontSize: 11, marginTop: 10, display: "grid", gap: 4 }}>{Object.entries(checks).map(([k, v]) => <div key={k}><span style={{ color: "var(--cream-dim)" }}>{k}</span> <b style={{ color: v ? "var(--approved)" : "var(--rejected)" }}>{v ? "✓" : "✕"}</b></div>)}</div>
    <p style={{ fontSize: 12, marginBottom: 0, color: "var(--cream-dim)" }}>{p?.reason}</p>
    {result.security && <div style={{ ...mono, fontSize: 10, marginTop: 10, color: "var(--cream-dim)" }}>RFC 9421: {result.security.http_message_signature}<br />AP2 binding: {String(result.security.ap2_checkout_binding)}<br />Raw card exposed: {String(result.security.raw_card_exposed_to_agent)}</div>}
  </div>;
}

function MerchantPanel({ merchant, agent, mandates, catalog }) {
  const [selected, setSelected] = useState(mandates[0]?.id || "");
  const [result, setResult] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [products, setProducts] = useState([]);
  useEffect(() => { api.ucpDiscovery().then(setDiscovery).catch(() => {}); api.catalog().then(r => setProducts(r.products || [])).catch(() => {}); }, []);
  async function verify() { setResult(await api.verify({ agent_id: agent.id, mandate_id: selected, merchant_id: merchant.id })); }
  return <div style={{ display: "grid", gap: 20 }}>
    <section><h2 style={sectionTitle}>VuelaYa · UCP Discovery</h2><div style={card}><pre style={{ ...mono, whiteSpace: "pre-wrap", fontSize: 11, color: "var(--cream-dim)" }}>{JSON.stringify(discovery, null, 2)}</pre></div></section>
    <section><h2 style={sectionTitle}>Verificación del agente</h2><div style={{ ...card, display: "grid", gap: 12 }}><select style={input} value={selected} onChange={e => setSelected(e.target.value)}>{mandates.map(m => <option key={m.id} value={m.id}>{m.description.slice(0, 60)} · {m.status}</option>)}</select><button onClick={verify} style={primary}>Verificar mandato</button>{result && <div style={{ ...mono, fontSize: 12 }}>{Object.entries(result).map(([k,v]) => <div key={k}><span style={{ color: "var(--cream-dim)" }}>{k}</span>: {typeof v === "object" ? JSON.stringify(v) : String(v)}</div>)}</div>}</div></section>
    <section><h2 style={sectionTitle}>Catálogo</h2><div style={{ display: "grid", gap: 8 }}>{products.map(p => <div key={p.id} style={{ ...card, padding: 12, display: "flex", justifyContent: "space-between" }}><span>{p.name}<small style={{ color: "var(--cream-dim)", display: "block" }}>{p.category}</small></span><strong>{p.currency} {p.price}</strong></div>)}</div></section>
  </div>;
}

function AuditPanel({ audit, verifyChain }) {
  const [chain, setChain] = useState(null);
  return <div style={{ display: "grid", gap: 16 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}><div><h2 style={sectionTitle}>Append-only audit trail</h2><p style={desc}>Cada evento encadena el hash del evento anterior.</p></div><button onClick={() => verifyChain().then(setChain)} style={secondary}>Verificar hash chain</button></div>{chain && <div style={{ ...card, color: chain.valid ? "var(--approved)" : "var(--rejected)", ...mono, fontSize: 12 }}>{chain.valid ? `✓ Cadena íntegra (${chain.events} eventos)` : `✕ Cadena inválida (${chain.failures.length} fallos)`}</div>}<div style={{ display: "grid", gap: 8 }}>{audit.map(e => <div key={e.id} style={{ ...card, padding: 12, borderLeft: "3px solid var(--amber)" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{e.event_type}</strong><span style={{ ...mono, fontSize: 10, color: "var(--cream-dim)" }}>#{e.sequence_number} · {new Date(e.created_at).toLocaleString("es-CO")}</span></div><div style={{ ...mono, fontSize: 10, marginTop: 7, color: "var(--cream-dim)", wordBreak: "break-word" }}>hash {e.event_hash}<br />prev {e.previous_event_hash || "GENESIS"}<br />request {e.request_id || "—"}</div><pre style={{ ...mono, fontSize: 10, whiteSpace: "pre-wrap", color: "var(--cream-dim)" }}>{JSON.stringify(e.details || {}, null, 2)}</pre></div>)}</div></div>;
}

const grid3 = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 };
const primary = { background: "var(--amber)", color: "var(--navy-950)", border: 0, borderRadius: 7, padding: "10px 14px", fontWeight: 800, cursor: "pointer" };
const secondary = { background: "var(--navy-700)", color: "var(--cream)", border: "1px solid var(--line)", borderRadius: 7, padding: "8px 12px", cursor: "pointer" };
const danger = { ...secondary, color: "var(--rejected)" };
const sectionTitle = { fontFamily: "var(--font-display)", fontSize: 14, color: "var(--amber)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 };
const desc = { fontSize: 13, color: "var(--cream-dim)", lineHeight: 1.5 };

function Status({ status }) { const color = status === "active" || status === "approved" ? "var(--approved)" : status === "revoked" || status === "rejected" ? "var(--rejected)" : "var(--escalated)"; return <span style={{ ...mono, fontSize: 10, color, border: `1px solid ${color}`, padding: "3px 7px", borderRadius: 999 }}>{status}</span>; }
