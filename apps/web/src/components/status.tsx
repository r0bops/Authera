import type {
  AuditEvent,
  Decision,
  ExecutionState,
  MandateState,
  PolicyCheck,
  ReasonCode,
} from '@authera/contracts';
import { Check, X } from 'lucide-react';
import { formatTime, shortHash, shortId } from '../lib/format.js';
import { Badge, Table, Td, Th, type Tone } from './ui/primitives.js';

function mandateTone(status: MandateState): Tone {
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

export function MandateStatusBadge({
  status,
  plainLanguage = false,
}: {
  status: MandateState;
  plainLanguage?: boolean;
}) {
  const labels: Record<MandateState, string> = {
    ACTIVE: 'Active',
    DRAFT: 'Draft',
    REVOKED: 'Stopped',
    EXPIRED: 'Ended',
    SUPERSEDED: 'Replaced',
  };
  return <Badge tone={mandateTone(status)}>{plainLanguage ? labels[status] : status}</Badge>;
}

function decisionTone(decision: Decision | null, state?: ExecutionState): Tone {
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
  showReasonCode = true,
}: {
  decision: Decision | null;
  state?: ExecutionState;
  reasonCode?: ReasonCode | null;
  showReasonCode?: boolean;
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
      {reasonCode && showReasonCode ? (
        <code className="font-mono text-[11.5px] text-ink-muted">{reasonCode}</code>
      ) : null}
    </span>
  );
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
  plainLanguage = false,
}: {
  events: AuditEvent[];
  limit?: number;
  showLinks?: boolean;
  plainLanguage?: boolean;
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
              <Badge tone={eventTone(event.eventType)}>
                {plainLanguage
                  ? humanEventLabel(event.eventType)
                  : event.eventType.replace(/_/g, ' ')}
              </Badge>
              {!plainLanguage ? (
                <span className="text-[11.5px] text-ink-faint">
                  #{event.sequence} · {event.actorType.toLowerCase()}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[13px] text-ink">
              {plainLanguage ? humanEventSummary(event) : event.summary}
            </p>
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

function humanEventLabel(type: AuditEvent['eventType']): string {
  const labels: Partial<Record<AuditEvent['eventType'], string>> = {
    MANDATE_CREATED: 'Plan created',
    MANDATE_ACTIVATED: 'Plan started',
    MANDATE_REVISED: 'Plan changed',
    MANDATE_REVOKED: 'Plan stopped',
    AGENT_REQUEST_RECEIVED: 'Request received',
    AGENT_SIGNATURE_VERIFIED: 'Aria verified',
    AGENT_SIGNATURE_REJECTED: 'Agent blocked',
    NONCE_ACCEPTED: 'Replay checked',
    REPLAY_REJECTED: 'Replay blocked',
    POLICY_EVALUATED: 'Purchase checked',
    APPROVAL_REQUESTED: 'Decision requested',
    APPROVAL_APPROVED: 'Offer approved',
    APPROVAL_REJECTED: 'Offer rejected',
    PAYMENT_REQUESTED: 'Payment started',
    PAYMENT_PENDING: 'Payment pending',
    PAYMENT_SUCCEEDED: 'Purchase completed',
    PAYMENT_FAILED: 'Payment failed',
    USAGE_RESERVED: 'Plan held',
    USAGE_CONSUMED: 'Plan used',
    USAGE_RELEASED: 'Allowance restored',
    WEBHOOK_RECEIVED: 'Provider updated',
    WEBHOOK_DUPLICATE: 'Duplicate ignored',
    DISPUTE_OPENED: 'Issue reported',
    DISPUTE_RESOLVED: 'Issue resolved',
  };
  return labels[type] ?? type.toLowerCase().replace(/_/g, ' ');
}

function humanEventSummary(event: AuditEvent): string {
  const summaries: Partial<Record<AuditEvent['eventType'], string>> = {
    MANDATE_CREATED: 'Your purchase plan was created.',
    MANDATE_ACTIVATED: 'Aria started using your plan.',
    MANDATE_REVISED: 'Your updated rules became active.',
    MANDATE_REVOKED: 'You stopped this plan. Every new purchase is blocked.',
    AGENT_REQUEST_RECEIVED: 'Authera received a signed request from Aria.',
    AGENT_SIGNATURE_VERIFIED: 'Authera confirmed that this request came from Aria.',
    AGENT_SIGNATURE_REJECTED: 'Authera blocked a request that could not be verified.',
    NONCE_ACCEPTED: 'Authera confirmed this request had not been used before.',
    REPLAY_REJECTED: 'Authera blocked a repeated request.',
    APPROVAL_REQUESTED: 'Aria paused and asked you to review the exact offer.',
    APPROVAL_APPROVED: 'You approved this exact offer once.',
    APPROVAL_REJECTED: 'You rejected this offer. Nothing was charged.',
    USAGE_RESERVED: 'The amount and one plan use were held while payment completed.',
    USAGE_CONSUMED: 'This plan recorded the completed purchase.',
    USAGE_RELEASED: 'The unused amount was returned to your plan.',
    PAYMENT_REQUESTED: 'Authera sent the approved payment.',
    PAYMENT_PENDING: 'The payment provider is still processing the purchase.',
    PAYMENT_SUCCEEDED: 'Payment completed successfully.',
    PAYMENT_FAILED: 'Payment failed. No plan allowance was consumed.',
    WEBHOOK_RECEIVED: 'Authera received the payment provider’s update.',
    WEBHOOK_DUPLICATE: 'A repeated provider update was ignored safely.',
    DISPUTE_OPENED: 'You reported a problem with this purchase.',
    DISPUTE_RESOLVED: 'Authera compared the purchase with its recorded evidence.',
  };
  if (event.eventType === 'POLICY_EVALUATED') {
    if (event.reasonCode?.startsWith('ALLOW_'))
      return 'Every rule matched, so the purchase could continue.';
    if (event.reasonCode?.startsWith('REQUIRE_HUMAN'))
      return 'The offer needed your approval, so Aria paused.';
    return 'The purchase did not match your plan, so Authera blocked it.';
  }
  return summaries[event.eventType] ?? event.summary;
}
