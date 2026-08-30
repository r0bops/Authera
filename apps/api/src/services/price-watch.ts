import { effectiveFlightDateWindow, type MandatePolicyV1 } from '@authera/contracts';
import type { Clock } from '../clock.js';
import type { Logger } from '../logger.js';
import type { CheckoutService } from './checkout-service.js';

/** The slice of a mandate the watcher needs: identity, live status, and what to look for. */
export interface WatchedMandate {
  id: string;
  status: string;
  policy: Pick<MandatePolicyV1, 'intent' | 'validUntil'>;
}

export interface PriceWatchDependencies {
  checkout: Pick<CheckoutService, 'searchFlights'>;
  listMandates: () => Promise<WatchedMandate[]>;
  clock: Clock;
  logger: Logger;
  /** How often a mandate's market is re-queried. */
  refreshMs: number;
  /** How often the watcher looks for mandates that are due (new mandates are picked up here). */
  tickMs?: number;
  /** Parallel market searches per pass (default 3). */
  concurrency?: number;
  /** Stop starting new searches after this long; the rest wait for the next tick (default 25 s). */
  tickBudgetMs?: number;
  /** How long to wait before retrying an intent whose market failed (default 20 s). */
  retryMs?: number;
}

/**
 * "Aria watches prices": discovery on a schedule for every ACTIVE mandate, so the catalog and
 * the price chart reflect the live market without a purchase attempt. Discovery only — the
 * watcher never prepares a checkout and never calls the gateway; buying stays an explicit act.
 */
export class PriceWatcher {
  /** intent key → when its market was last searched successfully (or a backoff marker). */
  private readonly lastRun = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private nudgeTimer: NodeJS.Timeout | undefined;
  private running = false;
  private rerun = false;

  constructor(private readonly deps: PriceWatchDependencies) {}

  start(): void {
    if (this.timer) return;
    const tickMs = this.deps.tickMs ?? 30_000;
    this.timer = setInterval(() => void this.tick(), tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.timer = undefined;
    this.nudgeTimer = undefined;
  }

  /** A plan was just created: look at its market now instead of waiting for the next tick. */
  nudge(delayMs = 500): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.nudgeTimer) return;
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = undefined;
      void this.tick();
    }, delayMs);
    this.nudgeTimer.unref();
  }

  /**
   * One pass. Mandates that share an intent share one market search; never-searched mandates
   * go first; a few searches run in parallel; the pass stops after its time budget so a new
   * plan is never stuck behind a long queue.
   */
  async tick(): Promise<{ searched: number; skipped: number; failed: number }> {
    if (this.running) return { searched: 0, skipped: 0, failed: 0 };
    this.running = true;
    const counts = { searched: 0, skipped: 0, failed: 0 };
    try {
      const now = this.deps.clock.now().getTime();
      const mandates = await this.deps.listMandates();
      // intent key -> mandate ids (one search serves all of them)
      const groups = new Map<
        string,
        { key: string; intent: MandatePolicyV1['intent']; ids: string[]; last: number }
      >();
      for (const mandate of mandates) {
        if (mandate.status !== 'ACTIVE' || Date.parse(mandate.policy.validUntil) <= now) continue;
        if (mandate.policy.intent.type !== 'flight') continue; // no live market for other kinds
        const key = intentKey(mandate.policy.intent);
        const group = groups.get(key);
        if (group) group.ids.push(mandate.id);
        else
          groups.set(key, {
            key,
            intent: mandate.policy.intent,
            ids: [mandate.id],
            last: this.lastRun.get(key) ?? -1,
          });
      }
      const due = [...groups.values()]
        .filter((g) => g.last < 0 || now - g.last >= this.deps.refreshMs)
        .sort((a, b) => a.last - b.last); // never searched (-1) first, then oldest
      counts.skipped = groups.size - due.length;

      const budgetMs = this.deps.tickBudgetMs ?? 25_000;
      const started = Date.now();
      const concurrency = this.deps.concurrency ?? 3;
      let index = 0;
      const worker = async () => {
        while (index < due.length && Date.now() - started < budgetMs) {
          const group = due[index++]!;
          try {
            const found = await this.search(group.intent);
            this.lastRun.set(group.key, this.deps.clock.now().getTime());
            counts.searched += 1;
            this.deps.logger.info(
              { intent: group.key, mandates: group.ids.length, offers: found },
              'price watch searched the market',
            );
          } catch (error) {
            counts.failed += 1;
            // Back off instead of hammering a market that just said no (rate limit, outage).
            const retryMs = this.deps.retryMs ?? 20_000;
            this.lastRun.set(
              group.key,
              this.deps.clock.now().getTime() - this.deps.refreshMs + retryMs,
            );
            this.deps.logger.warn(
              { err: error, intent: group.key, retryInMs: retryMs },
              'price watch search failed; will retry',
            );
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
      for (const key of this.lastRun.keys()) if (!groups.has(key)) this.lastRun.delete(key);
    } finally {
      this.running = false;
      if (this.rerun) {
        this.rerun = false;
        this.nudge();
      }
    }
    return counts;
  }

  private async search(intent: MandatePolicyV1['intent']): Promise<number> {
    if (intent.type !== 'flight') return 0;
    const dates = effectiveFlightDateWindow(intent);
    const offers = await this.deps.checkout.searchFlights(
      {
        origin: intent.origin,
        destination: intent.destination,
        from: dates.from,
        to: dates.to,
        passengers: intent.passengerCount,
      },
      { strict: true },
    );
    return offers.length;
  }
}

/** Two mandates with the same intent need one search, not two. */
function intentKey(intent: MandatePolicyV1['intent']): string {
  if (intent.type === 'goods') return `goods:${intent.query.trim().toLowerCase()}`;
  const dates = effectiveFlightDateWindow(intent);
  return `flight:${intent.origin}-${intent.destination}:${dates.from}:${dates.to}:${intent.passengerCount}`;
}
