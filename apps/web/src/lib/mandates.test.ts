import { describe, expect, it } from 'vitest';
import { selectDashboardPlans } from './mandates.js';

const mandate = (
  id: string,
  remainingCount: number,
  createdAt: string,
  status: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
) => ({ id, status, createdAt, usage: { remainingCount } });

describe('selectDashboardPlans', () => {
  it('prioritizes the newest usable plan over exhausted and revoked plans', () => {
    const result = selectDashboardPlans([
      mandate('completed-newer', 0, '2026-08-29T12:00:00.000Z'),
      mandate('live-older', 1, '2026-08-29T10:00:00.000Z'),
      mandate('revoked', 1, '2026-08-29T13:00:00.000Z', 'REVOKED'),
      mandate('live-newer', 2, '2026-08-29T11:00:00.000Z'),
    ]);

    expect(result.livePlan?.id).toBe('live-newer');
    expect(result.plan?.id).toBe('live-newer');
  });

  it('shows only the newest completed plan when no usable plan exists', () => {
    const result = selectDashboardPlans([
      mandate('completed-older', 0, '2026-08-28T10:00:00.000Z'),
      mandate('completed-newer', 0, '2026-08-29T10:00:00.000Z'),
    ]);

    expect(result.livePlan).toBeUndefined();
    expect(result.completedPlan?.id).toBe('completed-newer');
    expect(result.plan?.id).toBe('completed-newer');
  });
});
