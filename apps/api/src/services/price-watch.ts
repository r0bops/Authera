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
  checkout: Pick<CheckoutService, 'searchFlights' | 'searchProducts'>;
  listMandates: () => Promise<WatchedMandate[]>;
  clock: Clock;
  logger: Logger;
  /** How often a mandate's market is re-queried. */
  refreshMs: number;
  /** How often the watcher looks for mandates that are due (new mandates are picked up here). */
  tickMs?: number;
}

/**
 * "Aria watches prices": discovery on a schedule for every ACTIVE mandate, so the catalog and
 * the price chart reflect the live market without a purchase attempt. Discovery only — the
 * watcher never prepares a checkout and never calls the gateway; buying stays an explicit act.
 */
export class PriceWatcher {
  private readonly lastRun = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

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
    this.timer = undefined;
  }

  /** One pass: search the market for every ACTIVE mandate whose last search is stale. */
  async tick(): Promise<{ searched: number; skipped: number; failed: number }> {
    if (this.running) return { searched: 0, skipped: 0, failed: 0 };
    this.running = true;
    const counts = { searched: 0, skipped: 0, failed: 0 };
    try {
      const now = this.deps.clock.now().getTime();
      const mandates = await this.deps.listMandates();
      const active = new Set<string>();
      for (const mandate of mandates) {
        if (mandate.status !== 'ACTIVE' || Date.parse(mandate.policy.validUntil) <= now) continue;
        active.add(mandate.id);
        const last = this.lastRun.get(mandate.id);
        if (last !== undefined && now - last < this.deps.refreshMs) {
          counts.skipped += 1;
          continue;
        }
        try {
          const found = await this.search(mandate.policy.intent);
          this.lastRun.set(mandate.id, now);
          counts.searched += 1;
          this.deps.logger.info(
            { mandateId: mandate.id, intent: mandate.policy.intent.type, offers: found },
            'price watch searched the market',
          );
        } catch (error) {
          counts.failed += 1;
          this.deps.logger.warn(
            { err: error, mandateId: mandate.id },
            'price watch search failed; will retry next tick',
          );
        }
      }
      for (const id of this.lastRun.keys()) if (!active.has(id)) this.lastRun.delete(id);
    } finally {
      this.running = false;
    }
    return counts;
  }

  private async search(intent: MandatePolicyV1['intent']): Promise<number> {
    if (intent.type === 'goods') {
      const offers = await this.deps.checkout.searchProducts({ q: intent.query });
      return offers.length;
    }
    const dates = effectiveFlightDateWindow(intent);
    const offers = await this.deps.checkout.searchFlights({
      origin: intent.origin,
      destination: intent.destination,
      from: dates.from,
      to: dates.to,
      passengers: intent.passengerCount,
    });
    return offers.length;
  }
}
