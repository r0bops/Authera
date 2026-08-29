import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useMandates } from '../api/hooks.js';
import { MandateStatusBadge } from '../components/status.js';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  buttonStyles,
} from '../components/ui/primitives.js';
import { formatDate, formatMoney } from '../lib/format.js';
import { intentTitle } from '../lib/intent.js';

export function MandatesPage() {
  const mandates = useMandates();
  return (
    <>
      <PageHeader
        title="Purchase plans"
        description="What Aria may buy, the limits you set, and whether each plan is still active."
        actions={
          <Link to="/dashboard/mandates/new" className={buttonStyles()}>
            <Plus className="h-4 w-4" aria-hidden /> Plan a purchase
          </Link>
        }
      />
      {mandates.isError ? (
        <ErrorState error={mandates.error} retry={() => void mandates.refetch()} />
      ) : null}
      {mandates.isPending ? <Skeleton className="h-32" /> : null}
      {mandates.data && mandates.data.length === 0 ? (
        <EmptyState
          title="No purchase plans"
          action={
            <Link to="/dashboard/mandates/new" className={buttonStyles()}>
              Plan your first purchase
            </Link>
          }
        >
          Create one to let Aria search and buy inside rules you control.
        </EmptyState>
      ) : null}
      {mandates.data && mandates.data.length > 0 ? (
        <>
        <Table className="hidden md:block">
          <thead>
            <tr>
              <Th>What Aria may buy</Th>
              <Th>Status</Th>
              <Th>Price limit</Th>
              <Th>Bought</Th>
              <Th>Valid until</Th>
              <Th>Version</Th>
              <Th>Agent</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {mandates.data.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-medium">{intentTitle(m.policy.intent)}</span>
                  <span className="ml-1.5 text-ink-faint">
                    {m.policy.intent.type === 'flight' ? m.policy.intent.cabin : 'product'}
                  </span>
                </Td>
                <Td>
                  <MandateStatusBadge status={m.status} />
                </Td>
                <Td className="tabular">
                  {formatMoney({
                    currency: m.policy.limits.currency,
                    minor: m.policy.limits.maxPerPurchaseMinor,
                  })}
                </Td>
                <Td className="tabular">
                  {m.usage.consumedCount} / {m.policy.limits.maxFulfillments}
                </Td>
                <Td>{formatDate(m.policy.validUntil)}</Td>
                <Td className="tabular">v{m.version}</Td>
                <Td>{m.agent.displayName}</Td>
                <Td>
                  <Link
                    className="text-[12.5px] font-medium text-cobalt hover:underline"
                    to={`/dashboard/mandates/${m.id}`}
                  >
                    View plan
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="space-y-2 md:hidden">
          {mandates.data.map((m) => (
            <Link
              key={m.id}
              to={`/dashboard/mandates/${m.id}`}
              className="block rounded-md border border-line bg-surface px-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-ink">{intentTitle(m.policy.intent)}</span>
                <MandateStatusBadge status={m.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-muted">
                <span>
                  Limit{' '}
                  {formatMoney({
                    currency: m.policy.limits.currency,
                    minor: m.policy.limits.maxPerPurchaseMinor,
                  })}
                </span>
                <span>Ends {formatDate(m.policy.validUntil)}</span>
              </div>
            </Link>
          ))}
        </div>
        </>
      ) : null}
    </>
  );
}
