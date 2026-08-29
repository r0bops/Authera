import { useMe } from '../api/hooks.js';
import {
  Badge,
  Card,
  ErrorState,
  KeyValue,
  PageHeader,
  Skeleton,
} from '../components/ui/primitives.js';
import { formatDateTime, shortId } from '../lib/format.js';

export function SettingsPage() {
  const me = useMe();
  if (me.isError) return <ErrorState error={me.error} retry={() => void me.refetch()} />;
  if (me.isPending || !me.data) return <Skeleton className="h-48" />;
  const data = me.data;
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your identity, the agents allowed to act for you, and the payment references they may use."
      />
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-6 flex flex-col gap-4">
          <Card title="Account">
            <KeyValue
              items={[
                { label: 'Name', value: data.user.displayName },
                { label: 'Email', value: data.user.email },
                { label: 'Session expires', value: formatDateTime(data.session.expiresAt) },
                {
                  label: 'Mode',
                  value: data.demoMode ? (
                    <Badge tone="info">Demo mode — seeded session, mock payments</Badge>
                  ) : (
                    <Badge>Production</Badge>
                  ),
                },
              ]}
            />
          </Card>
          <Card
            title="Payment methods"
            description="Tokenized at the provider; only opaque references are stored here"
          >
            <ul className="divide-y divide-line">
              {data.paymentMethods.map((pm) => (
                <li key={pm.id} className="flex items-center justify-between py-2 text-[13px]">
                  <span>
                    {pm.brand} •••• {pm.last4}
                  </span>
                  <span className="font-mono text-[11.5px] text-ink-faint">
                    {shortId(pm.id, 14)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="col-span-6 flex flex-col gap-4">
          <Card
            title="Purchasing agents"
            description="Each agent signs its requests with an Ed25519 key registered here"
          >
            <ul className="divide-y divide-line">
              {data.agents.map((agent) => (
                <li key={agent.id} className="py-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{agent.displayName}</span>
                    <Badge tone={agent.status === 'ACTIVE' ? 'verified' : 'destructive'}>
                      {agent.status}
                    </Badge>
                  </div>
                  <p className="font-mono text-[11.5px] text-ink-faint">
                    key {agent.keyThumbprint ?? 'none'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    Profile:{' '}
                    <a
                      className="text-cobalt hover:underline"
                      href={`/agents/${agent.id}/profile`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      /agents/{shortId(agent.id)}/profile
                    </a>{' '}
                    · key directory:{' '}
                    <a
                      className="text-cobalt hover:underline"
                      href="/.well-known/http-message-signatures-directory"
                      target="_blank"
                      rel="noreferrer"
                    >
                      /.well-known/…
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Merchants accepting agent purchases">
            <ul className="divide-y divide-line text-[13px]">
              {data.merchants.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2">
                  <span>{m.displayName}</span>
                  <a
                    className="text-[12px] text-cobalt hover:underline"
                    href="/.well-known/ucp"
                    target="_blank"
                    rel="noreferrer"
                  >
                    UCP discovery
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
