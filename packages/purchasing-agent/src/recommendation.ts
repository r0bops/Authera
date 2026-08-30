import {
  OverBudgetRecommendationSchema,
  priceOveragePercent,
  recommendationCeilingMinor,
  recommendationTolerancePercent,
  type OverBudgetRecommendation,
} from '@authera/contracts';
import type { AgentOffer, PurchasingTask } from './schemas.js';

/**
 * Pick a soft, non-purchasable fallback from authoritative search results.
 * Recommendations are flight-only and are returned only when no offer meets the hard limit.
 */
export function findOverBudgetRecommendation(
  offers: readonly AgentOffer[],
  task: PurchasingTask,
): OverBudgetRecommendation | undefined {
  if (task.kind !== 'flight' || task.maxAmountMinor <= 0) return undefined;
  const comparable = offers
    .filter((offer) => offerMatchesFlightTask(offer, task))
    .sort(
      (left, right) =>
        left.totalMinor - right.totalMinor || left.offerId.localeCompare(right.offerId),
    );
  if (comparable.some((offer) => offer.totalMinor <= task.maxAmountMinor)) return undefined;

  const ceiling = recommendationCeilingMinor(task.maxAmountMinor);
  const recommended = comparable.find(
    (offer) => offer.totalMinor > task.maxAmountMinor && offer.totalMinor <= ceiling,
  );
  if (!recommended) return undefined;

  const overageMinor = recommended.totalMinor - task.maxAmountMinor;
  return OverBudgetRecommendationSchema.parse({
    mandateId: task.mandateId,
    offerId: recommended.offerId,
    merchantName: recommended.merchantName,
    market: recommended.market,
    displaySummary: recommended.displaySummary,
    currency: recommended.currency,
    totalMinor: recommended.totalMinor,
    budgetMinor: task.maxAmountMinor,
    overageMinor,
    overagePercent: priceOveragePercent(recommended.totalMinor, task.maxAmountMinor),
    tolerancePercent: recommendationTolerancePercent(task.maxAmountMinor),
  });
}

export function recommendationReason(recommendation: OverBudgetRecommendation): string {
  return `No flight was available within ${money(recommendation.budgetMinor, recommendation.currency)}. The closest option is ${recommendation.merchantName} (${recommendation.market}) at ${money(recommendation.totalMinor, recommendation.currency)}, ${money(recommendation.overageMinor, recommendation.currency)} (${recommendation.overagePercent}%) over the limit. No purchase was requested.`;
}

function offerMatchesFlightTask(
  offer: AgentOffer,
  task: Extract<PurchasingTask, { kind: 'flight' }>,
): boolean {
  const departureDate = (offer.departureAt ?? '').slice(0, 10);
  return (
    offer.kind === 'flight' &&
    offer.currency === task.currency &&
    (offer.origin === undefined || offer.origin === task.origin) &&
    (offer.destination === undefined || offer.destination === task.destination) &&
    (departureDate === '' ||
      (departureDate >= task.departureDateFrom && departureDate <= task.departureDateTo))
  );
}

function money(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}
