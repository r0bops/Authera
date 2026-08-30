import {
  departureTimeAllowed,
  effectiveFlightDateWindow,
  flightDurationMinutes,
  type MandatePolicyV1,
} from '@authera/contracts';
import { approvalTolerance } from '@authera/domain';
import type { Clock } from '../clock.js';
import type { Logger } from '../logger.js';
import type { CheckoutService } from './checkout-service.js';

/** The slice of a mandate the watcher needs: identity, live status, and what to look for. */
export interface WatchedMandate {
  id: string;
  status: string;
  policy: Pick<MandatePolicyV1, 'intent' | 'validUntil' | 'limits'>;
  /** Purchases the plan can still make; 0 means the watcher only keeps the catalog fresh. */
  remainingCount?: number;
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
  /** Routes searched on the same schedule with no plan behind them: fares before anyone asks. */
  warmRoutes?: Array<{ origin: string; destination: string }>;
  /**
   * "Buy when it drops": called once per (mandate, offer) when a search finds an AVAILABLE offer
   * inside the plan's per-purchase limit. The agent still goes through the gateway; the watcher
   * never buys by itself.
   */
  autoBuy?: (mandateId: string, offerId: string, withinLimit: boolean) => Promise<unknown>;
}

/**
 * "Aria watches prices": discovery on a schedule for every ACTIVE mandate, so the catalog and
 * the price chart reflect the live market without a purchase attempt. Discovery only — the
 * watcher never prepares a checkout and never calls the gateway; buying stays an explicit act.
 */
export class PriceWatcher {
  /** intent key → when its market was last searched successfully (or a backoff marker). */
  private readonly lastRun = new Map<string, number>();
  /** `${mandateId}:${offerId}` pairs already handed to the agent — one attempt per offer. */
  private readonly attempted = new Set<string>();
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

  /** The catalog changed under every route (a judge injected an offer): look again everywhere. */
  refreshNow(): void {
    this.lastRun.clear();
    this.nudge();
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
        {
          key: string;
          intent: MandatePolicyV1['intent'];
          ids: string[];
          mandates: WatchedMandate[];
          last: number;
        }
      >();
      for (const mandate of mandates) {
        if (mandate.status !== 'ACTIVE' || Date.parse(mandate.policy.validUntil) <= now) continue;
        if (mandate.policy.intent.type !== 'flight') continue; // no live market for other kinds
        const key = intentKey(mandate.policy.intent);
        const group = groups.get(key);
        if (group) {
          group.ids.push(mandate.id);
          group.mandates.push(mandate);
        } else
          groups.set(key, {
            key,
            intent: mandate.policy.intent,
            ids: [mandate.id],
            mandates: [mandate],
            last: this.lastRun.get(key) ?? -1,
          });
      }
      // Warm routes: a 30-day window from tomorrow, one passenger, no hand-off (there is no plan).
      const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
      for (const route of this.deps.warmRoutes ?? []) {
        const covered = [...groups.values()].some(
          (g) =>
            g.intent.type === 'flight' &&
            g.intent.origin === route.origin &&
            g.intent.destination === route.destination,
        );
        if (covered) continue;
        const key = `warm:${route.origin}-${route.destination}`;
        groups.set(key, {
          key,
          intent: {
            type: 'flight',
            origin: route.origin,
            destination: route.destination,
            cabin: 'economy',
            departureDateFrom: iso(now + 86_400_000),
            departureDateTo: iso(now + 31 * 86_400_000),
            passengerCount: 1,
          },
          ids: [],
          mandates: [],
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
            const offers = await this.search(group.intent);
            const found = offers.length;
            this.lastRun.set(group.key, this.deps.clock.now().getTime());
            counts.searched += 1;
            await this.handOffToAgent(group.mandates, offers);
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

  /** The moment the brief describes: a flight appears inside the plan → the agent tries to buy. */
  private async handOffToAgent(
    mandates: WatchedMandate[],
    offers: Awaited<ReturnType<CheckoutService['searchFlights']>>,
  ): Promise<void> {
    const autoBuy = this.deps.autoBuy;
    if (!autoBuy) return;
    for (const mandate of mandates) {
      if ((mandate.remainingCount ?? 0) <= 0) continue;
      const cap = mandate.policy.limits.maxPerPurchaseMinor;
      // Inside the limit the agent buys; a near miss (progressive tolerance, or the plan's own
      // approval ceiling) is attempted too, so the human gets the decision instead of silence.
      const reach = Math.max(
        approvalTolerance(cap).ceilingMinor,
        mandate.policy.limits.approvalCeilingMinor ?? 0,
      );
      const intent = mandate.policy.intent;
      const available = offers
        .filter((o) => o.status === 'AVAILABLE' && o.total.minor <= reach)
        .filter(
          (o) =>
            intent.type !== 'flight' ||
            !o.departureAt ||
            departureTimeAllowed(intent, o.departureAt),
        )
        .filter((o) => {
          if (intent.type !== 'flight') return true;
          if (intent.maxStops !== undefined && (o.stops === undefined || o.stops > intent.maxStops))
            return false;
          if (intent.maxDurationMinutes !== undefined) {
            const minutes = flightDurationMinutes(o.departureAt, o.arrivalAt);
            if (minutes === null || minutes > intent.maxDurationMinutes) return false;
          }
          return true;
        })
        .sort((a, b) => a.total.minor - b.total.minor);
      const cheapest = available[0];
      if (!cheapest) continue;
      const key = `${mandate.id}:${cheapest.id}`;
      if (this.attempted.has(key)) continue;
      this.attempted.add(key);
      try {
        await autoBuy(mandate.id, cheapest.id, cheapest.total.minor <= cap);
        this.deps.logger.info(
          { mandateId: mandate.id, offerId: cheapest.id, total: cheapest.total },
          'price watch handed an eligible offer to the agent',
        );
      } catch (error) {
        this.deps.logger.warn(
          { err: error, mandateId: mandate.id, offerId: cheapest.id },
          'agent attempt after price watch failed',
        );
      }
    }
  }

  private async search(
    intent: MandatePolicyV1['intent'],
  ): Promise<Awaited<ReturnType<CheckoutService['searchFlights']>>> {
    if (intent.type !== 'flight') return [];
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
    return offers;
  }
}

/** Two mandates with the same intent need one search, not two. */
function intentKey(intent: MandatePolicyV1['intent']): string {
  if (intent.type === 'goods') return `goods:${intent.query.trim().toLowerCase()}`;
  const dates = effectiveFlightDateWindow(intent);
  return `flight:${intent.origin}-${intent.destination}:${dates.from}:${dates.to}:${intent.passengerCount}`;
}
