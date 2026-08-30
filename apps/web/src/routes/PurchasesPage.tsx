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
import { formatDateTime, formatMoney, formatPaymentState } from '../lib/format.js';

export function PurchasesPage() {
  const purchases = usePurchases();
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Receipts for purchases Aria completed, with the plan and proof behind each one."
      />
      {purchases.isError ? (
        <ErrorState error={purchases.error} retry={() => void purchases.refetch()} />
      ) : null}
      {purchases.isPending ? <Skeleton className="h-32" /> : null}
      {purchases.data && purchases.data.length === 0 ? (
        <EmptyState title="No purchases yet">
          When Aria finds an eligible offer and Authera allows it, the receipt appears here.
        </EmptyState>
      ) : null}
      {purchases.data && purchases.data.length > 0 ? (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Purchase</Th>
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
                  <DecisionBadge decision={p.decision} state={p.state} plainLanguage />
                </Td>
                <Td>{formatPaymentState(p.paymentState)}</Td>
                <Td>
                  <Link
                    className="text-[12.5px] font-medium text-cobalt hover:underline"
                    to={`/dashboard/purchases/${p.id}`}
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
