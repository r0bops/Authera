import type { Offer, PurchaseAttemptResponse } from '@authera/contracts';
import {
  appendAssistantChatMessage,
  findChatSessionByMandate,
  getOffer,
  type Database,
} from '@authera/db';
import type { Logger } from '../logger.js';

/** What the agent just did under a plan; the narrator turns it into one message from Aria. */
export interface AgentOutcomeEvent {
  mandateId: string;
  /** `watch`: the price watcher acted on its own; `demo`: a judge or the human triggered it. */
  trigger: 'watch' | 'demo';
  offerId?: string;
  purchase?: PurchaseAttemptResponse;
  /** Agent run without a purchase request. */
  outcome?: 'NO_MATCH' | 'RECOMMENDATION' | 'PURCHASE_REQUESTED' | 'ERROR';
  consideredCount?: number;
  limit?: { minor: number; currency: string };
}

const REASONS: Record<string, string> = {
  AMOUNT_EXCEEDED: 'it is over your limit',
  INTENT_MISMATCH: 'it is not what you asked for (route, dates, category, time or stops)',
  MANDATE_REVOKED: 'the plan is revoked',
  MANDATE_EXPIRED: 'the plan has expired',
  MANDATE_NOT_ACTIVE: 'the plan is not active',
  USAGE_EXHAUSTED: 'the plan is already used up',
  CHECKOUT_HASH_MISMATCH: 'the cart changed after you looked at it',
  CHECKOUT_EXPIRED: 'that checkout had already expired',
  APPROVAL_INVALID: 'the approval did not match this cart',
  OFFER_NOT_AVAILABLE: 'the fare disappeared before I could take it',
  PAYMENT_FAILED: 'the payment did not go through',
  BOOKING_FAILED: 'the airline did not confirm the booking',
};

function money(m: { minor: number; currency: string }): string {
  return `${m.currency} ${(m.minor / 100).toFixed(2)}`;
}

function describe(offer: Offer | null): string {
  if (!offer) return 'a fare';
  if (offer.kind === 'goods') return offer.title ?? 'an item';
  const flight = [offer.airline, offer.flightNumber].filter(Boolean).join(' ');
  const route = offer.origin && offer.destination ? ` ${offer.origin}→${offer.destination}` : '';
  const when = offer.departureAt
    ? ` on ${offer.departureAt.slice(0, 10)} at ${offer.departureAt.slice(11, 16)}`
    : '';
  return `${flight || 'a flight'}${route}${when}`;
}

/** Pure: the sentence Aria says for an outcome. Exported for tests. */
export function narration(event: AgentOutcomeEvent, offer: Offer | null): string | null {
  const p = event.purchase;
  if (p) {
    const what = describe(offer);
    const amount = offer ? money(offer.total) : 'the fare';
    if (p.decision === 'ALLOW') {
      return p.state === 'SUCCEEDED'
        ? `Done — I bought ${what} for ${amount}, inside your rules. The receipt and booking are in Orders.`
        : `I took ${what} for ${amount}, inside your rules — the payment is going through and the receipt will be in Orders in a moment.`;
    }
    if (p.decision === 'REQUIRE_HUMAN') {
      if (p.reasonCode === 'REQUIRE_HUMAN_AMOUNT' && offer && event.limit) {
        const over = money({
          minor: offer.total.minor - event.limit.minor,
          currency: offer.total.currency,
        });
        return `I found ${what} at ${amount} — that's ${over} over your ${money(event.limit)}. I stopped there: approve it on the card below, or I keep watching.`;
      }
      return `I found ${what} at ${amount}, but it's outside the rules we agreed. Your call on the card below — otherwise I keep watching.`;
    }
    const why = REASONS[p.reasonCode] ?? p.reasonCode.toLowerCase().replace(/_/g, ' ');
    return `I passed on ${what} at ${amount}: ${why}. Nothing was charged.`;
  }
  if (event.outcome === 'NO_MATCH' && event.trigger === 'watch') {
    const n = event.consideredCount ?? 0;
    return n > 0
      ? `Checked ${n} fares just now — nothing inside your rules yet. Still watching; I'll tell you the moment one fits.`
      : `Nothing on the market inside your rules yet. Still watching.`;
  }
  return null;
}

/**
 * Aria talks back: after the agent buys, pauses or is blocked under a plan that came from a
 * conversation, the conversation hears about it — deterministic sentences, no model involved.
 */
export class ChatNarrator {
  /** mandate id → last time a "still watching" note was posted (avoid a nag every tick). */
  private readonly quietUntil = new Map<string, number>();

  constructor(private readonly deps: { db: Database; logger: Logger; quietMs?: number }) {}

  async tell(event: AgentOutcomeEvent): Promise<void> {
    try {
      const session = await findChatSessionByMandate(this.deps.db, event.mandateId);
      if (!session) return;
      const offer = event.offerId ? ((await getOffer(this.deps.db, event.offerId)) ?? null) : null;
      const text = narration(event, offer);
      if (!text) return;
      if (!event.purchase) {
        const until = this.quietUntil.get(event.mandateId) ?? 0;
        if (Date.now() < until) return;
        this.quietUntil.set(event.mandateId, Date.now() + (this.deps.quietMs ?? 60 * 60_000));
      }
      await appendAssistantChatMessage(this.deps.db, {
        sessionId: session.id,
        userId: session.userId,
        content: text,
      });
    } catch (error) {
      this.deps.logger.warn({ err: error, mandateId: event.mandateId }, 'chat narration failed');
    }
  }
}
