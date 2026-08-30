const SENSITIVE_KEY =
  /authorization|cookie|secret|token|signature|private|payment(?:method)?|card|api[-_]?key|personal/i;

export type AgentTraceEvent = Readonly<{
  at: string;
  event:
    | 'RUN_STARTED'
    | 'SEARCH_COMPLETED'
    | 'OFFER_SELECTED'
    | 'PURCHASE_REQUESTED'
    | 'RECOMMENDATION_FOUND'
    | 'NO_MATCH'
    | 'OPENAI_FALLBACK'
    | 'RUN_FAILED';
  data: Readonly<Record<string, unknown>>;
}>;

export class RedactedTrace {
  readonly #events: AgentTraceEvent[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  add(event: AgentTraceEvent['event'], data: Record<string, unknown> = {}): void {
    this.#events.push({
      at: this.now().toISOString(),
      event,
      data: redactTraceData(data),
    });
  }

  snapshot(): readonly AgentTraceEvent[] {
    return structuredClone(this.#events);
  }
}

export function redactTraceData(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return redactObject(value);
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item),
    ]),
  );
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === 'object' && value !== null)
    return redactObject(value as Record<string, unknown>);
  return value;
}

export function boundedToolResult(value: unknown, maxBytes = 12_000): string {
  if (!Number.isInteger(maxBytes) || maxBytes < 64) {
    throw new RangeError('maxBytes must be an integer of at least 64');
  }
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return serialized;

  const emptyEnvelope = JSON.stringify({ truncated: true, preview: '' });
  const available = maxBytes - Buffer.byteLength(emptyEnvelope, 'utf8');
  let preview = Buffer.from(serialized).subarray(0, available).toString('utf8');
  let result = JSON.stringify({ truncated: true, preview });
  while (Buffer.byteLength(result, 'utf8') > maxBytes) {
    preview = preview.slice(0, -1);
    result = JSON.stringify({ truncated: true, preview });
  }
  return result;
}
