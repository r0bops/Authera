import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { AuditEvent } from '@authera/contracts';
import { useAuditEvents, useChainVerification, useMandates } from '../api/hooks.js';
import { eventTone } from '../components/status.js';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Input,
  KeyValue,
  Label,
  Mono,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '../components/ui/primitives.js';
import { formatDateTime, shortHash, shortId } from '../lib/format.js';
import { intentTitle } from '../lib/intent.js';

export function AuditorPage() {
  const [params, setParams] = useSearchParams();
  const mandates = useMandates();
  const mandateId = params.get('mandateId') ?? '';
  const executionId = params.get('executionId') ?? '';
  const [typeFilter, setTypeFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const events = useAuditEvents({
    ...(mandateId ? { mandateId } : {}),
    ...(executionId ? { executionId } : {}),
    limit: 500,
  });
  const chain = useChainVerification();
  const rows = (events.data ?? []).filter((e) => !typeFilter || e.eventType === typeFilter);
  const types = [...new Set((events.data ?? []).map((e) => e.eventType))].sort();

  const update = (next: Record<string, string>) => {
    const merged = {
      ...(mandateId ? { mandateId } : {}),
      ...(executionId ? { executionId } : {}),
      ...next,
    };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)));
  };

  return (
    <>
      <PageHeader
        title="Auditor view"
        description="The append-only, hash-chained event ledger. Every decision links to its mandate version, execution, checkout, and payment; hashes make tampering detectable."
        actions={
          <>
            {chain.data ? (
              <Badge tone={chain.data.valid ? 'verified' : 'destructive'}>
                {chain.data.valid
                  ? `chain verified · ${chain.data.events} events`
                  : `CHAIN INVALID · ${chain.data.reason ?? ''}`}
              </Badge>
            ) : null}
            {executionId ? (
              <a href={`/api/evidence/${executionId}/export`} download>
                <Button variant="secondary">Export evidence bundle</Button>
              </a>
            ) : (
              <Button
                variant="secondary"
                disabled
                title="Filter by an execution id to export its bundle"
              >
                Export evidence bundle
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4">
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-4">
            <Label htmlFor="mandate">Mandate</Label>
            <Select
              id="mandate"
              value={mandateId}
              onChange={(e) => update({ mandateId: e.target.value })}
            >
              <option value="">All mandates</option>
              {(mandates.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {intentTitle(m.policy.intent)} · v{m.version} · {shortId(m.id)}
                </option>
              ))}
            </Select>
          </div>
          <div className="col-span-4">
            <Label htmlFor="execution">Execution id</Label>
            <Input
              id="execution"
              value={executionId}
              placeholder="uuid"
              onChange={(e) => update({ executionId: e.target.value })}
            />
          </div>
          <div className="col-span-4">
            <Label htmlFor="type">Event type</Label>
            <Select id="type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </Card>
      {events.isError ? (
        <ErrorState error={events.error} retry={() => void events.refetch()} />
      ) : null}
      {events.isPending ? <Skeleton className="h-40" /> : null}
      {events.data ? (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Time (UTC)</Th>
              <Th>Event</Th>
              <Th>Actor</Th>
              <Th>Summary</Th>
              <Th>Links</Th>
              <Th>Hash</Th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((event) => (
              <EventRow
                key={event.id}
                event={event}
                expanded={expanded === event.id}
                onToggle={() => setExpanded(expanded === event.id ? null : event.id)}
              />
            ))}
            {rows.length === 0 ? (
              <tr>
                <Td className="text-ink-muted">No events match the filter.</Td>
                <Td />
                <Td />
                <Td />
                <Td />
                <Td />
                <Td />
              </tr>
            ) : null}
          </tbody>
        </Table>
      ) : null}
    </>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-surface-muted/60" onClick={onToggle}>
        <Td mono>{event.sequence}</Td>
        <Td className="whitespace-nowrap">{formatDateTime(event.occurredAt)}</Td>
        <Td>
          <Badge tone={eventTone(event.eventType)}>{event.eventType}</Badge>
        </Td>
        <Td>
          {event.actorType.toLowerCase()}
          {event.actorId ? (
            <span className="block font-mono text-[11px] text-ink-faint">
              {shortId(event.actorId, 14)}
            </span>
          ) : null}
        </Td>
        <Td>
          {event.summary}
          {event.reasonCode ? (
            <span className="block font-mono text-[11px] text-ink-faint">{event.reasonCode}</span>
          ) : null}
        </Td>
        <Td className="font-mono text-[11px] text-ink-faint">
          {event.mandateId ? (
            <span className="block">
              mandate {shortId(event.mandateId)}
              {event.mandateVersion ? ` v${event.mandateVersion}` : ''}
            </span>
          ) : null}
          {event.executionId ? (
            <span className="block">execution {shortId(event.executionId)}</span>
          ) : null}
          {event.paymentId ? (
            <span className="block">payment {shortId(event.paymentId)}</span>
          ) : null}
        </Td>
        <Td mono>{shortHash(event.hash)}</Td>
      </tr>
      {expanded ? (
        <tr>
          <Td className="bg-surface-muted/40" />
          <td colSpan={6} className="border-b border-line bg-surface-muted/40 px-3 py-3">
            <KeyValue
              dense
              items={[
                { label: 'Event id', value: event.id, mono: true },
                { label: 'Previous hash', value: event.previousHash || '(genesis)', mono: true },
                { label: 'Hash', value: event.hash, mono: true },
                { label: 'Checkout', value: event.checkoutId ?? '—', mono: true },
              ]}
            />
            <p className="mt-2 text-[12px] font-medium text-ink-muted">Canonical payload</p>
            <Mono className="mt-1 block max-h-64 overflow-auto whitespace-pre">
              {JSON.stringify(event.payload, null, 2)}
            </Mono>
          </td>
        </tr>
      ) : null}
    </>
  );
}
