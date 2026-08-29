import { Link } from 'react-router';
import { usePurchases } from '../api/hooks.js';
import { DecisionBadge } from '../components/status.js';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney } from '../lib/format.js';

export function PurchasesPage() {
  const purchases = usePurchases();
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Every purchase your agent completed or attempted to pay for, with the mandate it used and the evidence behind it."
      />
      {purchases.isError ? (
        <ErrorState error={purchases.error} retry={() => void purchases.refetch()} />
      ) : null}
      {purchases.isPending ? <Skeleton className="h-32" /> : null}
      {purchases.data && purchases.data.length === 0 ? (
        <EmptyState title="No purchases yet">
          When the agent finds an eligible offer and the gateway allows it, the receipt appears
          here.
        </EmptyState>
      ) : null}
      {purchases.data && purchases.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Flight</Th>
              <Th className="text-right">Paid</Th>
              <Th>Status</Th>
              <Th>Payment</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {purchases.data.map((p) => (
              <tr key={p.id}>
                <Td>{formatDateTime(p.createdAt)}</Td>
                <Td>{p.offerSummary ?? '—'}</Td>
                <Td className="tabular text-right font-medium">{formatMoney(p.amount)}</Td>
                <Td>
                  <DecisionBadge decision={p.decision} state={p.state} />
                </Td>
                <Td>{p.paymentState ?? '—'}</Td>
                <Td>
                  <Link
                    className="text-[12.5px] font-medium text-cobalt hover:underline"
                    to={`/purchases/${p.id}`}
                  >
                    Receipt
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
