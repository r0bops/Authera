import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { useMandates } from '../api/hooks.js';
import { MandateStatusBadge } from '../components/status.js';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { formatDate, formatMoney } from '../lib/format.js';

export function MandatesPage() {
  const mandates = useMandates();
  return (
    <>
      <PageHeader
        title="Mandates"
        description="Signed authorizations your agent can spend under. Revoking one stops every later purchase attempt immediately."
        actions={
          <Link to="/mandates/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden /> Create mandate
            </Button>
          </Link>
        }
      />
      {mandates.isError ? (
        <ErrorState error={mandates.error} retry={() => void mandates.refetch()} />
      ) : null}
      {mandates.isPending ? <Skeleton className="h-32" /> : null}
      {mandates.data && mandates.data.length === 0 ? (
        <EmptyState title="No mandates">Create one to let your agent watch prices.</EmptyState>
      ) : null}
      {mandates.data && mandates.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>Route</Th>
              <Th>Status</Th>
              <Th>Max per purchase</Th>
              <Th>Uses</Th>
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
                  <span className="font-medium">
                    {m.policy.intent.origin} → {m.policy.intent.destination}
                  </span>
                  <span className="ml-1.5 text-ink-faint">{m.policy.intent.cabin}</span>
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
                    to={`/mandates/${m.id}`}
                  >
                    Open
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
    </>
  );
}
