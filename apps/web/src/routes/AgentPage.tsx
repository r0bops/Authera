import { Link } from 'react-router';
import { useDemoState, useExecutions, useMandates, useMe, useOffers } from '../api/hooks.js';
import { offerMatches, OffersTable } from '../components/price-watch.js';
import { DecisionBadge } from '../components/status.js';
import {
  Badge,
  Card,
  KeyValue,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { formatDateTime, formatMoney, shortId } from '../lib/format.js';
import { intentTitle } from '../lib/intent.js';

export function AgentPage() {
  const me = useMe();
  const mandates = useMandates();
  const offers = useOffers();
  const executions = useExecutions(undefined, 15);
  const demo = useDemoState(Boolean(me.data?.demoMode));
  const active = mandates.data?.find((m) => m.status === 'ACTIVE');
  const eligible =
    active && offers.data ? offers.data.filter((o) => offerMatches(o, active).eligible) : [];
  const latest = executions.data?.[0];

  return (
    <>
      <PageHeader
        title="Agent view"
        description="What Aria, the purchasing agent, sees: the price watch, the offers it considered, the signed requests it sent, and the gateway's answers."
      />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 flex flex-col gap-4">
          <Card title="Price watch">
            <KeyValue
              dense
              items={[
                {
                  label: 'State',
                  value: active ? (
                    <Badge tone="verified">Watching prices</Badge>
                  ) : (
                    <Badge>Idle</Badge>
                  ),
                },
                {
                  label: 'Mode',
                  value:
                    (demo.data?.agentMode ?? me.data?.demoMode)
                      ? (demo.data?.agentMode ?? 'scripted')
                      : 'scripted',
                },
                {
                  label: 'Mandate',
                  value: active ? (
                    <Link
                      className="text-cobalt hover:underline"
                      to={`/audit?mandateId=${active.id}`}
                    >
                      {intentTitle(active.policy.intent)}
                    </Link>
                  ) : (
                    'none'
                  ),
                },
                {
                  label: 'Threshold',
                  value: active
                    ? formatMoney({
                        currency: active.policy.limits.currency,
                        minor: active.policy.limits.maxPerPurchaseMinor,
                      })
                    : '—',
                },
                { label: 'Eligible offers', value: eligible.length },
                {
                  label: 'Markets searched',
                  value: offers.data
                    ? [...new Set(offers.data.map((o) => o.market))].join(', ') || '—'
                    : '—',
                },
                {
                  label: 'Last decision',
                  value: latest ? (
                    <DecisionBadge
                      decision={latest.decision}
                      state={latest.state}
                      reasonCode={latest.reasonCode}
                    />
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
            <p className="mt-3 text-[12px] text-ink-faint">
              The agent selects an offer and submits identifiers only. It never sees the raw card
              and cannot authorize anything itself.
            </p>
          </Card>
          <Card title="Signed requests" description="Captured from demo attempts (replayable)">
            {demo.data && demo.data.capturedRequests.length > 0 ? (
              <ul className="divide-y divide-line text-[12.5px]">
                {[...demo.data.capturedRequests]
                  .reverse()
                  .slice(0, 8)
                  .map((r) => (
                    <li key={r.executionId} className="py-1.5">
                      <p className="font-mono">POST {r.path}</p>
                      <p className="text-ink-faint">
                        execution {shortId(r.executionId)} · nonce {shortId(r.nonce, 10)} · key{' '}
                        {shortId(r.keyid, 10)}
                      </p>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-muted">No signed requests captured yet.</p>
            )}
          </Card>
        </div>
        <div className="col-span-8 flex flex-col gap-4">
          <Card
            title="Offers considered"
            description="Eligibility is evaluated against the active mandate the same way the gateway does"
          >
            {offers.isPending ? (
              <Skeleton className="h-24" />
            ) : (
              <OffersTable offers={offers.data ?? []} mandate={active} />
            )}
          </Card>
          <Card title="Gateway decisions">
            {executions.isPending ? <Skeleton className="h-24" /> : null}
            {executions.data && executions.data.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No purchase attempts yet.</p>
            ) : null}
            {executions.data && executions.data.length > 0 ? (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Execution</Th>
                    <Th>Offer</Th>
                    <Th>Decision</Th>
                    <Th>Reason</Th>
                  </tr>
                </thead>
                <tbody>
                  {executions.data.map((e) => (
                    <tr key={e.id}>
                      <Td>{formatDateTime(e.createdAt)}</Td>
                      <Td mono>{shortId(e.id)}</Td>
                      <Td>{e.offerSummary ?? shortId(e.offerId)}</Td>
                      <Td>
                        <DecisionBadge decision={e.decision} state={e.state} />
                      </Td>
                      <Td>
                        <code className="font-mono text-[11.5px]">{e.reasonCode ?? '—'}</code>
                        {e.explanation ? (
                          <p className="text-[12px] text-ink-muted">{e.explanation}</p>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
