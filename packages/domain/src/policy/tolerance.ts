/**
 * Progressive near-miss tolerance: how far above the per-purchase limit an offer may be and still
 * be a decision for the human rather than a flat block. Small budgets get 10 %, large ones 7 %,
 * interpolated on a log scale between USD 100 and USD 1,000 (minor units). Deterministic.
 */
export const TOLERANCE_MAX_PERCENT = 10;
export const TOLERANCE_MIN_PERCENT = 7;
const LOW_MINOR = 10_000; // USD 100
const HIGH_MINOR = 100_000; // USD 1,000

export function approvalTolerance(limitMinor: number): { percent: number; ceilingMinor: number } {
  const clamped = Math.min(Math.max(limitMinor, LOW_MINOR), HIGH_MINOR);
  const t =
    (Math.log10(clamped) - Math.log10(LOW_MINOR)) /
    (Math.log10(HIGH_MINOR) - Math.log10(LOW_MINOR));
  const percent =
    Math.round(
      (TOLERANCE_MAX_PERCENT - t * (TOLERANCE_MAX_PERCENT - TOLERANCE_MIN_PERCENT)) * 100,
    ) / 100;
  const ceilingMinor = Math.floor(limitMinor * (1 + percent / 100));
  return { percent, ceilingMinor };
}
