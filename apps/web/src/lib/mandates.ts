import type { MandateState } from '@authera/contracts';

type DashboardMandate = {
  status: MandateState;
  createdAt: string;
  usage: { remainingCount: number };
};

function newestFirst<T extends DashboardMandate>(left: T, right: T): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

/** One shared definition keeps the shell and overview from presenting contradictory plan states. */
export function selectDashboardPlans<T extends DashboardMandate>(mandates: readonly T[] = []) {
  const livePlan = mandates
    .filter((mandate) => mandate.status === 'ACTIVE' && mandate.usage.remainingCount > 0)
    .sort(newestFirst)[0];
  const completedPlan = mandates
    .filter((mandate) => mandate.status === 'ACTIVE' && mandate.usage.remainingCount === 0)
    .sort(newestFirst)[0];

  return { livePlan, completedPlan, plan: livePlan ?? completedPlan };
}
