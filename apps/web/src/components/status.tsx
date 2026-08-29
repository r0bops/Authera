import type {
  AuditEvent,
  Decision,
  ExecutionState,
  MandateState,
  PolicyCheck,
  ReasonCode,
} from '@agentcerta/contracts';
import { Check, X } from 'lucide-react';
import { formatTime, shortHash, shortId } from '../lib/format.js';
import { Badge, Table, Td, Th, type Tone } from './ui/primitives.js';

export function mandateTone(status: MandateState): Tone {
  switch (status) {
    case 'ACTIVE':
      return 'verified';
    case 'DRAFT':
      return 'neutral';
    case 'REVOKED':
      return 'destructive';
    case 'EXPIRED':
    case 'SUPERSEDED':
      return 'attention';
  }
}

export function MandateStatusBadge({ status }: { status: MandateState }) {
  return <Badge tone={mandateTone(status)}>{status}</Badge>;
}

export function decisionTone(decision: Decision | null, state?: ExecutionState): Tone {
  if (state === 'SUCCEEDED') return 'verified';
  if (state === 'FAILED') return 'destructive';
  if (state === 'PAYMENT_PENDING' || state === 'RESERVED') return 'info';
  switch (decision) {
    case 'ALLOW':
      return 'verified';
    case 'REQUIRE_HUMAN':
      return 'attention';
    case 'BLOCK':
      return 'destructive';
    default:
      return 'neutral';
  }
}

export function DecisionBadge({
  decision,
  state,
  reasonCode,
}: {
  decision: Decision | null;
  state?: ExecutionState;
  reasonCode?: ReasonCode | null;
}) {
  const label =
    state === 'SUCCEEDED'
      ? 'PURCHASED'
      : state === 'FAILED'
        ? 'PAYMENT FAILED'
        : state === 'PAYMENT_PENDING'
          ? 'PAYMENT PENDING'
          : (decision ?? state ?? 'PENDING');
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={decisionTone(decision, state)}>{label}</Badge>
      {reasonCode ? (
        <code className="font-mono text-[11.5px] text-ink-muted">{reasonCode}</code>
      ) : null}
    </span>
  );
}

export function StateBadge({ state }: { state: ExecutionState }) {
  const tone: Tone =
    state === 'SUCCEEDED'
      ? 'verified'
      : state === 'BLOCKED' || state === 'FAILED'
        ? 'destructive'
        : state === 'REQUIRES_HUMAN'
          ? 'attention'
          : state === 'RESERVED' || state === 'PAYMENT_PENDING'
            ? 'info'
            : 'neutral';
  return <Badge tone={tone}>{state.replace(/_/g, ' ')}</Badge>;
}

export function Checklist({
  checks,
  compact = false,
}: {
  checks: PolicyCheck[];
  compact?: boolean;
}) {
  if (checks.length === 0) return <p className="text-[13px] text-ink-muted">No checks recorded.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-8" />
          <Th>Check</Th>
          {!compact ? <Th>Expected</Th> : null}
          {!compact ? <Th>Actual</Th> : null}
        </tr>
      </thead>
      <tbody>
        {checks.map((check, index) => (
          <tr key={`${check.code}-${index}`} className={check.passed ? '' : 'bg-coral-soft/40'}>
            <Td>
              {check.passed ? (
                <Check className="h-4 w-4 text-emerald" aria-label="passed" />
              ) : (
                <X className="h-4 w-4 text-coral" aria-label="failed" />
              )}
            </Td>
            <Td mono>{check.code}</Td>
            {!compact ? <Td mono>{renderValue(check.expected)}</Td> : null}
            {!compact ? <Td mono>{renderValue(check.actual)}</Td> : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function renderValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}…` : json;
}

export function eventTone(type: AuditEvent['eventType']): Tone {
  if (
    type.includes('REJECTED') ||
    type === 'PAYMENT_FAILED' ||
    type === 'MANDATE_REVOKED' ||
    type === 'USAGE_RELEASED'
  )
    return 'destructive';
  if (type.startsWith('APPROVAL') || type === 'WEBHOOK_DUPLICATE' || type === 'DISPUTE_OPENED')
    return 'attention';
  if (
    type === 'PAYMENT_SUCCEEDED' ||
    type === 'USAGE_CONSUMED' ||
    type === 'MANDATE_ACTIVATED' ||
    type === 'AGENT_SIGNATURE_VERIFIED' ||
    type === 'DISPUTE_RESOLVED'
  )
    return 'verified';
  return 'info';
}

export function Timeline({
  events,
  limit,
  showLinks = true,
}: {
  events: AuditEvent[];
  limit?: number;
  showLinks?: boolean;
}) {
  const shown = limit ? events.slice(-limit).reverse() : [...events].reverse();
  if (shown.length === 0) return <p className="text-[13px] text-ink-muted">No events yet.</p>;
  return (
    <ol className="divide-y divide-line">
      {shown.map((event) => (
        <li key={event.id} className="flex gap-3 py-2">
          <div className="w-16 shrink-0 pt-0.5 font-mono text-[11.5px] text-ink-faint">
            {formatTime(event.occurredAt)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={eventTone(event.eventType)}>{event.eventType.replace(/_/g, ' ')}</Badge>
              <span className="text-[11.5px] text-ink-faint">
                #{event.sequence} · {event.actorType.toLowerCase()}
              </span>
            </div>
            <p className="mt-0.5 text-[13px] text-ink">{event.summary}</p>
            {showLinks && (event.executionId || event.reasonCode) ? (
              <p className="mt-0.5 font-mono text-[11.5px] text-ink-faint">
                {event.executionId ? `execution ${shortId(event.executionId)}` : ''}
                {event.reasonCode ? ` · ${event.reasonCode}` : ''}
                {` · ${shortHash(event.hash)}`}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
