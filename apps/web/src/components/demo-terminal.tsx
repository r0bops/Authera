import type {
  ApprovalView,
  DemoAttemptResult,
  DemoDirectAttemptResult,
  DisputeView,
  FlightOfferView,
  MandateView,
} from '@authera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api/client.js';
import { useMandates, useMe } from '../api/hooks.js';
import { formatMoney } from '../lib/format.js';
import { intentTitle } from '../lib/intent.js';

type LineKind = 'cmd' | 'out' | 'ok' | 'warn' | 'err' | 'muted';
type Line = { id: number; kind: LineKind; text: string };

/** One judge scenario: a name, what it proves, and the steps it runs against the real API. */
const SCENARIOS: Array<{ cmd: string; label: string; proves: string }> = [
  { cmd: 'inject 130', label: 'Price drop', proves: 'a USD 130 offer appears on the plan route' },
  {
    cmd: 'run',
    label: 'Agent buys',
    proves: 'the agent searches, chooses, explains, the gateway decides',
  },
  {
    cmd: 'over 300',
    label: 'Over the limit',
    proves: 'USD 300 is blocked or paused — never silently approved',
  },
  { cmd: 'revoke', label: 'Live revocation', proves: 'revoke, then the very next attempt fails' },
  {
    cmd: 'expire',
    label: 'Expired mandate',
    proves: 'move the clock past validity; attempt fails',
  },
  {
    cmd: 'forge',
    label: 'Forged agent key',
    proves: 'an impostor is rejected before any policy runs',
  },
  { cmd: 'replay', label: 'Replay attack', proves: 'a captured signed request cannot be re-sent' },
  { cmd: 'race', label: 'Race two attempts', proves: 'a one-use mandate allows exactly one' },
  {
    cmd: 'approve',
    label: 'Human approval',
    proves: 'an over-limit offer waits for you, then completes once',
  },
  { cmd: 'tamper', label: 'Tampered cart', proves: 'a cart changed after approval is blocked' },
  { cmd: 'dispute', label: 'Dispute', proves: 'the evidence decides who is right' },
];

const HELP = [
  'inject <usd> [merchant]   put an offer on the plan route at that price',
  'run                       let the agent search, choose and request a purchase',
  'over <usd>                inject above the limit and attempt it directly',
  'revoke                    revoke the plan, then retry a purchase',
  'expire                    push the demo clock past validity, attempt, restore',
  'forge · replay · race     signature, nonce and concurrency defences',
  'approve · tamper          approval bound to one exact cart',
  'dispute [reason]          dispute the last paid purchase',
  'clock <±minutes|0>        move or reset the demo clock',
  'mandate                   show the selected plan · reset · clear · help',
];

export function DemoTerminal() {
  const me = useMe();
  const mandates = useMandates();
  const client = useQueryClient();
  const [lines, setLines] = useState<Line[]>([
    {
      id: 0,
      kind: 'muted',
      text: 'Authera trial-by-fire terminal. Pick a case above or type a command. `help` lists them.',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [mandateId, setMandateId] = useState('');
  const seq = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = (mandates.data ?? []).filter((m) => m.status === 'ACTIVE');
  const selected: MandateView | undefined =
    active.find((m) => m.id === mandateId) ?? active[0] ?? mandates.data?.[0];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  const print = (kind: LineKind, text: string) =>
    setLines((prev) => [...prev, { id: seq.current++, kind, text }]);

  const usd = (minor: number) => formatMoney({ currency: 'USD', minor });

  async function refresh() {
    await client.invalidateQueries();
  }

  async function offersOnRoute(plan: MandateView): Promise<FlightOfferView[]> {
    const all = await api<FlightOfferView[]>('/api/offers');
    return all.filter((o) =>
      plan.policy.intent.type === 'flight'
        ? o.kind === 'flight' &&
          o.origin === plan.policy.intent.origin &&
          o.destination === plan.policy.intent.destination
        : o.kind === 'goods',
    );
  }

  async function inject(plan: MandateView, amountMinor: number, merchantSlug?: string) {
    const merchants = me.data?.merchants ?? [];
    const merchant =
      merchants.find((m) => m.slug === merchantSlug) ??
      merchants.find((m) => m.slug === 'duffel') ??
      merchants[0];
    if (plan.policy.intent.type !== 'flight') throw new Error('inject works on flight plans');
    const offer = await api<FlightOfferView>('/api/demo/offers', {
      method: 'POST',
      body: {
        ...(merchant ? { merchantId: merchant.id } : {}),
        amountMinor,
        origin: plan.policy.intent.origin,
        destination: plan.policy.intent.destination,
        departureAt: `${plan.policy.intent.departureDateFrom}T09:00:00.000Z`,
        expiresInMinutes: 1440,
      },
    });
    print('ok', `injected ${offer.summary}`);
    return offer;
  }

  function verdict(value: DemoDirectAttemptResult | DemoAttemptResult['purchase'] | undefined) {
    const isDirect = (v: unknown): v is DemoDirectAttemptResult =>
      typeof v === 'object' && v !== null && 'status' in v;
    const purchase = isDirect(value) ? value.purchase : value;
    if (!purchase) {
      const err = isDirect(value)
        ? (value.response as { error?: { code?: string; message?: string } } | undefined)?.error
        : undefined;
      print(
        'err',
        `HTTP ${isDirect(value) ? value.status : '?'} ${err?.code ?? 'rejected'} — ${err?.message ?? 'no purchase created'}`,
      );
      return undefined;
    }
    const kind: LineKind =
      purchase.decision === 'ALLOW' ? 'ok' : purchase.decision === 'REQUIRE_HUMAN' ? 'warn' : 'err';
    print(
      kind,
      `${purchase.decision} · ${purchase.reasonCode} · ${purchase.state} · execution ${purchase.executionId.slice(0, 8)}`,
    );
    return purchase;
  }

  async function direct(
    plan: MandateView,
    offerId: string,
    extra: { checkoutId?: string; impersonate?: boolean } = {},
  ) {
    const r = await api<DemoDirectAttemptResult>('/api/demo/attempts/direct', {
      method: 'POST',
      body: { mandateId: plan.id, offerId, ...extra },
    });
    return { result: r, purchase: verdict(r) };
  }

  async function cheapestEligible(plan: MandateView) {
    const offers = (await offersOnRoute(plan))
      .filter(
        (o) => o.status === 'AVAILABLE' && o.total.minor <= plan.policy.limits.maxPerPurchaseMinor,
      )
      .sort((a, b) => a.total.minor - b.total.minor);
    return offers[0];
  }

  async function ensureEligible(plan: MandateView) {
    const existing = await cheapestEligible(plan);
    if (existing) return existing;
    print('muted', 'no eligible offer on the route yet — injecting one under the limit');
    return inject(plan, Math.max(100, plan.policy.limits.maxPerPurchaseMinor - 2000));
  }

  async function run(cmdline: string) {
    const [cmd = '', ...args] = cmdline.trim().split(/\s+/);
    if (!cmd) return;
    print('cmd', cmdline.trim());
    if (cmd === 'help') return HELP.forEach((h) => print('muted', h));
    if (cmd === 'clear') return setLines([]);
    if (cmd === 'reset') {
      await api('/api/demo/reset', { method: 'POST', body: {} });
      print('ok', 'scenario reset: catalog, plans, executions and ledger cleared');
      return refresh();
    }
    if (cmd === 'clock') {
      const minutes = args[0] === '0' ? 0 : Number(args[0]);
      if (!Number.isFinite(minutes)) throw new Error('clock <±minutes|0>');
      await api('/api/demo/time', { method: 'POST', body: { offsetMinutes: minutes } });
      print('ok', minutes === 0 ? 'demo clock restored' : `demo clock moved by ${minutes} minutes`);
      return refresh();
    }
    const plan = selected;
    if (!plan) throw new Error('no plan to test — create one in the chat first');
    const cap = plan.policy.limits.maxPerPurchaseMinor;
    if (cmd === 'mandate') {
      return print(
        'out',
        `${intentTitle(plan.policy.intent)} · up to ${usd(cap)} · ${plan.usage.remainingCount} use(s) left · ${plan.status} · escalation ${plan.policy.escalation} · ${plan.id}`,
      );
    }
    if (cmd === 'inject') {
      const dollars = Number(args[0] ?? '130');
      if (!Number.isFinite(dollars) || dollars <= 0) throw new Error('inject <usd> [merchant]');
      await inject(plan, Math.round(dollars * 100), args[1]);
      return refresh();
    }
    if (cmd === 'run') {
      print('muted', 'agent searching every market, comparing, then asking the gateway…');
      const r = await api<DemoAttemptResult>('/api/demo/attempts', {
        method: 'POST',
        body: { mandateId: plan.id },
      });
      print(
        'out',
        `${r.mode}${r.fallbackUsed ? ' (fallback)' : ''} · considered ${r.consideredOfferIds.length} offers across ${r.marketsSearched.join(', ') || '—'}`,
      );
      if (r.selectionReason) print('out', `reason: ${r.selectionReason}`);
      if (r.outcome === 'NO_MATCH')
        print('warn', 'NO_MATCH — nothing inside the plan; no purchase requested');
      verdict(r.purchase);
      return refresh();
    }
    if (cmd === 'over') {
      const dollars = Number(args[0] ?? '300');
      const offer = await inject(plan, Math.round(dollars * 100));
      await direct(plan, offer.id);
      return refresh();
    }
    if (cmd === 'revoke') {
      const offer = await ensureEligible(plan);
      await api(`/api/mandates/${plan.id}/revoke`, {
        method: 'POST',
        body: { reason: 'Revoked from the trial-by-fire terminal' },
      });
      print('ok', 'plan revoked — retrying a purchase right away');
      await direct(plan, offer.id);
      return refresh();
    }
    if (cmd === 'expire') {
      const offer = await ensureEligible(plan);
      const state = await api<{ now: string }>('/api/demo/state');
      const minutes =
        Math.ceil((Date.parse(plan.policy.validUntil) - Date.parse(state.now)) / 60000) + 60;
      await api('/api/demo/time', { method: 'POST', body: { offsetMinutes: minutes } });
      print(
        'warn',
        `demo clock moved ${minutes} minutes ahead — past ${plan.policy.validUntil.slice(0, 16)}`,
      );
      try {
        await direct(plan, offer.id);
      } finally {
        await api('/api/demo/time', { method: 'POST', body: { offsetMinutes: 0 } });
        print('muted', 'demo clock restored');
      }
      return refresh();
    }
    if (cmd === 'forge') {
      const offer = await ensureEligible(plan);
      print(
        'muted',
        'signing with a key the directory never issued, claiming the real agent’s key id…',
      );
      await direct(plan, offer.id, { impersonate: true });
      return refresh();
    }
    if (cmd === 'replay') {
      const offer = await ensureEligible(plan);
      const first = await direct(plan, offer.id);
      const executionId = first.purchase?.executionId;
      if (!executionId)
        throw new Error(
          'nothing captured to replay (the first attempt was rejected before the gateway)',
        );
      print('muted', 're-sending the same signed bytes…');
      const r = await api<DemoDirectAttemptResult>('/api/demo/attempts/replay', {
        method: 'POST',
        body: { executionId },
      });
      verdict(r);
      return refresh();
    }
    if (cmd === 'race') {
      const offer = await ensureEligible(plan);
      const results = await api<DemoDirectAttemptResult[]>('/api/demo/concurrent-attempts', {
        method: 'POST',
        body: { mandateId: plan.id, offerId: offer.id, attempts: 2 },
      });
      results.forEach((r, i) => {
        print('muted', `attempt ${i + 1}:`);
        verdict(r);
      });
      const allowed = results.filter((r) => r.purchase?.decision === 'ALLOW').length;
      print(allowed === 1 ? 'ok' : 'err', `${allowed} of ${results.length} allowed`);
      return refresh();
    }
    if (cmd === 'approve' || cmd === 'tamper') {
      if (plan.policy.escalation !== 'require_human')
        print(
          'warn',
          'this plan blocks instead of asking — expect BLOCK rather than an approval request',
        );
      const offer = await inject(plan, cap + 1800);
      const first = await direct(plan, offer.id);
      if (first.purchase?.decision !== 'REQUIRE_HUMAN') return refresh();
      const approvals = await api<ApprovalView[]>('/api/approvals');
      const pending = approvals.find((a) => a.executionId === first.purchase?.executionId);
      if (!pending) throw new Error('no approval request found');
      await api(`/api/approvals/${pending.id}/decision`, {
        method: 'POST',
        body: { decision: 'APPROVED', note: 'Approved from the terminal' },
      });
      print('ok', `approved once for checkout ${first.result.checkoutId?.slice(0, 8) ?? '?'} only`);
      if (cmd === 'tamper' && first.result.checkoutId) {
        await api(`/api/demo/checkouts/${first.result.checkoutId}/tamper`, {
          method: 'POST',
          body: {},
        });
        print('warn', 'cart modified after approval (price +0.01, hash unchanged)');
      }
      await direct(
        plan,
        offer.id,
        first.result.checkoutId ? { checkoutId: first.result.checkoutId } : {},
      );
      return refresh();
    }
    if (cmd === 'dispute') {
      const purchases =
        await api<Array<{ id: string; state: string; mandateId: string }>>('/api/purchases');
      const paid = purchases.find((p) => p.state === 'SUCCEEDED');
      if (!paid)
        throw new Error('no paid purchase to dispute — run `run` or `inject 130` + `run` first');
      const reason = (args[0] ?? 'REVOKED_BEFORE_PURCHASE').toUpperCase();
      const d = await api<DisputeView>('/api/disputes', {
        method: 'POST',
        body: {
          executionId: paid.id,
          reason,
          description: 'Opened from the trial-by-fire terminal',
        },
      });
      print(
        d.resolution?.outcome === 'AUTHORIZED'
          ? 'ok'
          : d.resolution?.outcome === 'CUSTOMER_SUPPORTED'
            ? 'warn'
            : 'err',
        `${d.state} · ${d.resolution?.outcome ?? 'pending'} — ${d.resolution?.headline ?? ''}`,
      );
      return refresh();
    }
    throw new Error(`unknown command: ${cmd} (try help)`);
  }

  async function submit(cmdline: string) {
    if (busy) return;
    setBusy(true);
    setInput('');
    try {
      await run(cmdline);
    } catch (error) {
      print('err', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(input);
  };

  const tone: Record<LineKind, string> = {
    cmd: 'text-[#9fb4ff]',
    out: 'text-[#d7dde8]',
    ok: 'text-[#7ee2b0]',
    warn: 'text-[#ffd479]',
    err: 'text-[#ff8f86]',
    muted: 'text-[#8a93a6]',
  };

  return (
    <section
      className="rounded-xl border border-line bg-surface"
      aria-label="Trial-by-fire terminal"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[13.5px] font-semibold text-ink">Trial by fire · terminal</h2>
          <p className="text-[11.5px] text-ink-muted">
            Pick a case or type it. Every step is a real signed request; the log prints the
            gateway’s verdict.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
          Plan
          <select
            className="min-h-9 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] text-ink"
            value={selected?.id ?? ''}
            onChange={(e) => setMandateId(e.target.value)}
          >
            {(mandates.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {intentTitle(m.policy.intent)} · {usd(m.policy.limits.maxPerPurchaseMinor)} ·{' '}
                {m.status.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        {SCENARIOS.map((s) => (
          <button
            key={s.cmd}
            type="button"
            disabled={busy}
            title={s.proves}
            onClick={() => void submit(s.cmd)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-cobalt hover:text-cobalt disabled:opacity-50"
          >
            {s.label} <span className="font-mono text-[11px] text-ink-faint">{s.cmd}</span>
          </button>
        ))}
      </div>
      <div
        className="bg-[#0f1420] px-4 py-3 font-mono text-[12.5px] leading-[1.6]"
        role="log"
        aria-live="polite"
      >
        <div className="h-72 overflow-y-auto">
          {lines.map((l) => (
            <div key={l.id} className={tone[l.kind]}>
              {l.kind === 'cmd' ? <span className="text-[#6f7c99]">judge@authera:~$ </span> : null}
              {l.text}
            </div>
          ))}
          {busy ? <div className="text-[#8a93a6]">…</div> : null}
          <div ref={endRef} />
        </div>
        <form
          onSubmit={onSubmit}
          className="mt-2 flex items-center gap-2 border-t border-[#232a3d] pt-2"
        >
          <span className="text-[#6f7c99]">judge@authera:~$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal command"
            placeholder="inject 130 · run · revoke · forge · replay · race · dispute"
            className="min-w-0 flex-1 bg-transparent text-[#e8ecf5] outline-none placeholder:text-[#4f5872]"
          />
        </form>
      </div>
    </section>
  );
}
