import { useMe } from '../api/hooks.js';
import {
  Badge,
  Card,
  ErrorState,
  KeyValue,
  PageHeader,
  Skeleton,
} from '../components/ui/primitives.js';
import { formatDateTime, friendlyAgentName, shortId } from '../lib/format.js';

export function SettingsPage() {
  const me = useMe();
  if (me.isError) return <ErrorState error={me.error} retry={() => void me.refetch()} />;
  if (me.isPending || !me.data) return <Skeleton className="h-48" />;
  const data = me.data;
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account, saved payment methods, connected providers, and the agent allowed to act for you."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Card title="Account">
            <KeyValue
              items={[
                { label: 'Name', value: data.user.displayName },
                { label: 'Email', value: data.user.email },
                { label: 'Session expires', value: formatDateTime(data.session.expiresAt) },
                {
                  label: 'Mode',
                  value: data.demoMode ? (
                    <Badge tone="info">Demo mode</Badge>
                  ) : (
                    <Badge>Production</Badge>
                  ),
                },
              ]}
            />
          </Card>
          <Card title="Payment methods" description="Aria never receives your raw card details.">
            <ul className="divide-y divide-line">
              {data.paymentMethods.map((pm) => (
                <li key={pm.id} className="flex items-center justify-between py-2 text-[13px]">
                  <span>
                    {pm.brand} •••• {pm.last4}
                  </span>
                  <Badge tone="verified">Ready</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card
            title="Your purchasing agent"
            description="Only this verified agent can use your purchase plans."
          >
            <ul className="divide-y divide-line">
              {data.agents.map((agent) => (
                <li key={agent.id} className="py-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{friendlyAgentName(agent.displayName)}</span>
                    <Badge tone={agent.status === 'ACTIVE' ? 'verified' : 'destructive'}>
                      {agent.status === 'ACTIVE' ? 'Active' : 'Stopped'}
                    </Badge>
                  </div>
                  <details className="mt-1 text-[12px]">
                    <summary className="min-h-10 font-medium text-cobalt">Proof & details</summary>
                    <p className="font-mono text-[11.5px] break-all text-ink-muted">
                      key {agent.keyThumbprint ?? 'none'}
                    </p>
                    <p className="mt-1 text-ink-muted">
                      <a
                        className="text-cobalt hover:underline"
                        href={`/agents/${agent.id}/profile`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Agent profile {shortId(agent.id)}
                      </a>{' '}
                      ·{' '}
                      <a
                        className="text-cobalt hover:underline"
                        href="/.well-known/http-message-signatures-directory"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Key directory
                      </a>
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Connected providers">
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
                    Connection details
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
