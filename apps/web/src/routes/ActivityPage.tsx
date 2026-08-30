import { Link } from 'react-router';
import { useAuditEvents, useExecutions } from '../api/hooks.js';
import { DecisionBadge, Timeline } from '../components/status.js';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortId } from '../lib/format.js';

export function ActivityPage() {
  const executions = useExecutions(undefined, 100);
  const events = useAuditEvents({ limit: 400 });
  return (
    <>
      <PageHeader
        title="Agent activity"
        description="What Aria tried, what Authera decided, and why. Nothing blocked here reached payment."
      />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Card title="Purchase checks">
            {executions.isError ? (
              <ErrorState error={executions.error} retry={() => void executions.refetch()} />
            ) : null}
            {executions.isPending ? <Skeleton className="h-24" /> : null}
            {executions.data && executions.data.length === 0 ? (
              <EmptyState title="No attempts yet" />
            ) : null}
            {executions.data && executions.data.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Offer</Th>
                    <Th className="text-right">Amount</Th>
                    <Th>Outcome</Th>
                    <Th>Mandate</Th>
                  </tr>
                </thead>
                <tbody>
                  {executions.data.map((e) => (
                    <tr key={e.id}>
                      <Td>{formatDateTime(e.createdAt)}</Td>
                      <Td>{e.offerSummary ?? shortId(e.offerId)}</Td>
                      <Td className="tabular text-right">{formatMoney(e.amount)}</Td>
                      <Td>
                        <DecisionBadge
                          decision={e.decision}
                          state={e.state}
                          reasonCode={e.reasonCode}
                          showReasonCode={false}
                          plainLanguage
                        />
                        {e.explanation ? (
                          <p className="mt-0.5 text-[12px] text-ink-muted">{e.explanation}</p>
                        ) : null}
                      </Td>
                      <Td>
                        {e.mandateId ? (
                          <Link
                            className="text-[12.5px] font-medium text-cobalt hover:underline"
                            to={`/dashboard/mandates/${e.mandateId}`}
                          >
                            View plan
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </Card>
        </div>
        <div className="lg:col-span-5">
          <Card title="What happened">
            {events.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <Timeline events={events.data ?? []} limit={40} showLinks={false} plainLanguage />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
