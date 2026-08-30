import type { DemoDirectAttemptResult, FlightOfferView, MandateView } from '@authera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client.js';
import { useDemoState, useMe } from '../api/hooks.js';
import { formatMoney } from '../lib/format.js';
import { reasonLabel } from '../lib/labels.js';

/**
 * "Try a case" on Marta's own screens (demo mode only). Every button fires the same real requests
 * the judge terminal does — an injected offer on the plan's route, then the agent or the gateway
 * does the rest. Nothing here can approve anything; it only creates the situation.
 */
export function TryCase({ plan, compact = false }: { plan: MandateView; compact?: boolean }) {
  const demo = useDemoState();
  const me = useMe();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const live = plan.status === 'ACTIVE' && plan.usage.remainingCount > 0;
  const intent = plan.policy.intent;
  if (!demo.data || intent.type !== 'flight' || !live) return null;

  const cap = plan.policy.limits.maxPerPurchaseMinor;
  const usd = (minor: number) => formatMoney({ currency: plan.policy.limits.currency, minor });

  async function inject(amountMinor: number): Promise<FlightOfferView> {
    if (intent.type !== 'flight') throw new Error('flight plan required');
    const merchant = (me.data?.merchants ?? []).find((m) => m.slug === 'duffel');
    return api<FlightOfferView>('/api/demo/offers', {
      method: 'POST',
      body: {
        ...(merchant ? { merchantId: merchant.id } : {}),
        amountMinor,
        origin: intent.origin,
        destination: intent.destination,
        departureAt: `${intent.departureDateFrom}T09:00:00.000Z`,
        expiresInMinutes: 1440,
      },
    });
  }

  async function attempt(offerId: string) {
    return api<DemoDirectAttemptResult>('/api/demo/attempts/direct', {
      method: 'POST',
      body: { mandateId: plan.id, offerId },
    });
  }

  const cases: Array<{ key: string; label: string; hint: string; run: () => Promise<string> }> = [
    {
      key: 'drop',
      label: 'Price drop',
      hint: `${usd(Math.max(100, cap - 2000))} appears — Aria buys it by herself`,
      run: async () => {
        const offer = await inject(Math.max(100, cap - 2000));
        return `${offer.summary} is on the market — Aria is on it; the purchase shows here in a few seconds.`;
      },
    },
    {
      key: 'near',
      label: 'Near miss',
      hint: `${usd(Math.round(cap * 1.03))} — 3 % over, your call`,
      run: async () => {
        const offer = await inject(Math.round(cap * 1.03));
        const r = await attempt(offer.id);
        const p = r.purchase;
        return p
          ? `${reasonLabel(p.reasonCode) ?? p.decision} — ${p.decision === 'REQUIRE_HUMAN' ? 'decide in the chat.' : p.state.toLowerCase()}.`
          : 'No purchase was created.';
      },
    },
    {
      key: 'over',
      label: 'Over the limit',
      hint: `${usd(cap * 2)} — twice your limit`,
      run: async () => {
        const offer = await inject(cap * 2);
        const r = await attempt(offer.id);
        const p = r.purchase;
        return p
          ? `${reasonLabel(p.reasonCode) ?? p.decision} — ${p.state.toLowerCase()}.`
          : 'No purchase was created.';
      },
    },
  ];

  async function run(c: (typeof cases)[number]) {
    if (busy) return;
    setBusy(c.key);
    setNote(null);
    try {
      setNote(await c.run());
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
      await client.invalidateQueries();
    }
  }

  return (
    <section
      aria-label="Try a case"
      className={
        compact
          ? 'mt-3'
          : 'mt-3 rounded-lg border border-dashed border-line bg-surface-muted/40 p-3'
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wide text-ink-muted">
          <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Try a case
        </span>
        <span className="text-[11.5px] text-ink-muted">
          demo only — real requests, same gateway
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {cases.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={busy !== null}
            title={c.hint}
            onClick={() => void run(c)}
            className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink hover:border-cobalt hover:text-cobalt disabled:opacity-50"
          >
            {busy === c.key ? '…' : c.label}
          </button>
        ))}
      </div>
      {note ? <p className="mt-2 text-[12.5px] text-ink">{note}</p> : null}
    </section>
  );
}
