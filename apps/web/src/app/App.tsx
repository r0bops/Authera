import { useEffect, useState } from 'react';
import type { HealthLiveResponse, HealthReadyResponse } from '@agentcerta/contracts';
import { fetchLive, fetchReady } from '../api/health';

type Probe<T> =
  | { state: 'loading' }
  | { state: 'ok'; value: T; checkedAt: Date }
  | { state: 'unreachable'; error: string; checkedAt: Date };

const POLL_INTERVAL_MS = 2_000;

function useProbe<T>(load: (signal: AbortSignal) => Promise<T>): Probe<T> {
  const [probe, setProbe] = useState<Probe<T>>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let controller = new AbortController();

    const run = async () => {
      controller.abort();
      controller = new AbortController();
      try {
        const value = await load(controller.signal);
        if (!cancelled) setProbe({ state: 'ok', value, checkedAt: new Date() });
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'request failed';
        setProbe({ state: 'unreachable', error: message, checkedAt: new Date() });
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [load]);

  return probe;
}

type Tone = 'verified' | 'attention' | 'destructive' | 'neutral';

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

function describeLive(probe: Probe<HealthLiveResponse>): {
  tone: Tone;
  label: string;
  detail: string;
} {
  if (probe.state === 'loading')
    return { tone: 'neutral', label: 'Checking', detail: 'Contacting the API…' };
  if (probe.state === 'unreachable')
    return { tone: 'destructive', label: 'Unreachable', detail: probe.error };
  if (probe.value.ok)
    return {
      tone: 'verified',
      label: 'Live',
      detail: `Process up for ${probe.value.data.uptimeSeconds}s · request ${probe.value.requestId}`,
    };
  return { tone: 'destructive', label: probe.value.error.code, detail: probe.value.error.message };
}

function describeReady(probe: Probe<HealthReadyResponse>): {
  tone: Tone;
  label: string;
  detail: string;
} {
  if (probe.state === 'loading')
    return { tone: 'neutral', label: 'Checking', detail: 'Probing PostgreSQL…' };
  if (probe.state === 'unreachable')
    return { tone: 'destructive', label: 'Unreachable', detail: probe.error };
  if (probe.value.ok) {
    const db = probe.value.data.checks.database;
    return {
      tone: 'verified',
      label: 'Ready',
      detail: db.ok ? `PostgreSQL answered in ${db.latencyMs} ms` : db.error,
    };
  }
  const details = probe.value.error.details as
    { checks?: { database?: { ok: boolean; error?: string } } } | undefined;
  return {
    tone: 'attention',
    label: probe.value.error.code,
    detail: details?.checks?.database?.error ?? probe.value.error.message,
  };
}

export function App() {
  const live = useProbe(fetchLive);
  const ready = useProbe(fetchReady);
  const liveView = describeLive(live);
  const readyView = describeReady(ready);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">AgentCerta</span>
          <span className="brand__tagline">The mandate gateway for agentic commerce</span>
        </div>
        <StatusPill tone={liveView.tone}>API {liveView.label}</StatusPill>
      </header>

      <main className="content">
        <section className="panel" aria-labelledby="foundation-title">
          <h1 id="foundation-title">Phase 0 · Foundation</h1>
          <p className="muted">
            The deployable vertical slice: React console, Hono API, PostgreSQL readiness. Mandates,
            the deterministic gateway, and the role views arrive in the following phases.
          </p>
        </section>

        <section className="grid" aria-label="System status">
          <article className="card">
            <div className="card__header">
              <h2>API process</h2>
              <StatusPill tone={liveView.tone}>{liveView.label}</StatusPill>
            </div>
            <p className="card__detail">{liveView.detail}</p>
            <p className="card__meta">GET /health/live</p>
          </article>

          <article className="card">
            <div className="card__header">
              <h2>Database</h2>
              <StatusPill tone={readyView.tone}>{readyView.label}</StatusPill>
            </div>
            <p className="card__detail">{readyView.detail}</p>
            <p className="card__meta">GET /health/ready</p>
          </article>
        </section>
      </main>
    </div>
  );
}
