import { Agent, Runner, setDefaultOpenAIKey } from '@openai/agents';
import {
  MandateChatDraftSchema,
  MandateChatModelOutputSchema,
  MandateChatResponseSchema,
  type MandateChatDraft,
  type MandateChatRequest,
  type MandateChatResponse,
} from '@authera/contracts';
import type { Clock } from '../clock.js';
import type { AgentConfig } from '../config.js';
import type { Logger } from '../logger.js';

const EMPTY_DRAFT: MandateChatDraft = {
  category: null,
  query: null,
  maxQuantity: null,
  origin: null,
  destination: null,
  departureDateFrom: null,
  departureDateTo: null,
  dateFlexibilityDays: null,
  passengerCount: null,
  maxPerPurchaseMinor: null,
  currency: null,
  maxFulfillments: null,
  validUntil: null,
  escalation: null,
};

type MissingField = MandateChatResponse['missingFields'][number];

const CITY_CODES: ReadonlyArray<[RegExp, string]> = [
  [/\bcaracas\b/i, 'CCS'],
  [/\bc[oó]rdoba\b/i, 'COR'],
  [/\bbogot[aá]\b/i, 'BOG'],
  [/\bmedell[ií]n\b/i, 'MDE'],
  [/\bbuenos aires\b/i, 'EZE'],
  [/\bs[aã]o paulo\b/i, 'GRU'],
  [/\brio de janeiro\b/i, 'GIG'],
  [/\bsantiago\b/i, 'SCL'],
  [/\blima\b/i, 'LIM'],
  [/\bmexico city\b|\bciudad de m[eé]xico\b/i, 'MEX'],
  [/\bpanama city\b|\bciudad de panam[aá]\b/i, 'PTY'],
  [/\bquito\b/i, 'UIO'],
  [/\bmontevideo\b/i, 'MVD'],
  [/\bmiami\b/i, 'MIA'],
  [/\bmadrid\b/i, 'MAD'],
];

export class MandateChatService {
  constructor(
    private readonly deps: {
      agent: AgentConfig;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  async interpret(input: MandateChatRequest): Promise<MandateChatResponse> {
    const scripted = scriptedMandateChat(input, this.deps.clock.now());
    // Common, fully explicit requests stay instant and deterministic. OpenAI handles ambiguity
    // and natural follow-ups, but is never required to authorize or execute the plan.
    if (scripted.complete) return scripted;
    if (this.deps.agent.mode === 'openai') {
      try {
        return await this.interpretWithOpenAi(input);
      } catch (error) {
        this.deps.logger.warn(
          { err: error instanceof Error ? error : new Error('unknown chat interpreter error') },
          'OpenAI mandate draft failed; using the transparent scripted interpreter',
        );
      }
    }
    return scripted;
  }

  private async interpretWithOpenAi(input: MandateChatRequest): Promise<MandateChatResponse> {
    if (this.deps.agent.mode !== 'openai') return scriptedMandateChat(input, this.deps.clock.now());
    setDefaultOpenAIKey(this.deps.agent.apiKey);
    const now = this.deps.clock.now();
    const agent = new Agent({
      name: 'Authera mandate drafting assistant',
      model: this.deps.agent.model,
      outputType: MandateChatModelOutputSchema,
      modelSettings: {
        reasoning: { effort: 'minimal' },
        text: { verbosity: 'low' },
        maxTokens: 1_200,
        store: false,
      },
      instructions: [
        'You help a person draft a bounded purchasing mandate in a conversational interface.',
        'You draft authority only. You never authorize, pay, book, claim that an offer exists, or claim that a purchase succeeded.',
        'Supported intents are economy flights and goods. Ask at most one concise follow-up question at a time.',
        'Preserve confirmed values from the existing draft unless the user explicitly changes them.',
        'Never invent a budget, route, product, travel date, expiration, or purchase count.',
        'Safe defaults may be proposed and must remain visible for confirmation: one passenger, one purchase, zero date-flexibility days, USD for a dollar amount, and require_human outside the rules.',
        'Resolve city names to IATA codes. Resolve relative dates against the supplied current ISO time.',
        'Money is integer minor units. The maximum is the complete total including taxes and fees.',
        'validUntil is the mandate authorization expiry, not the flight departure date.',
        'Set complete true only when all fields required for the selected intent are present.',
        'For flights require origin, destination, departure range, passenger count, maximum price, currency, purchase count, mandate expiry, and outside-rules behavior.',
        'For goods require query, quantity, maximum price, currency, purchase count, mandate expiry, and outside-rules behavior.',
        'Reply in the language used by the user. Keep the reply under 60 words.',
      ].join(' '),
    });
    const runner = new Runner({
      tracingDisabled: true,
      traceIncludeSensitiveData: false,
      workflowName: 'Authera mandate drafting',
    });
    const result = await runner.run(
      agent,
      JSON.stringify({ currentTime: now.toISOString(), ...input }),
      { maxTurns: 2, signal: AbortSignal.timeout(30_000) },
    );
    if (!result.finalOutput) throw new Error('OpenAI returned no mandate draft');
    const parsed = MandateChatModelOutputSchema.parse(result.finalOutput);
    return finalizeResponse(parsed.reply, parsed.draft, 'openai', now);
  }
}

export function scriptedMandateChat(input: MandateChatRequest, now: Date): MandateChatResponse {
  const text = input.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' ');
  const latest = input.messages.at(-1)?.content ?? '';
  const draft = { ...EMPTY_DRAFT, ...(input.draft ?? {}) };

  if (/\b(flight|fly|flying|airfare|ticket|vuelo|volar|pasaje)\b/i.test(text)) {
    draft.category = 'flight';
  } else if (
    /\b(product|item|shoes?|goods|order|producto|art[ií]culo|zapatos?|comprar)\b/i.test(text)
  ) {
    draft.category = 'goods';
  }

  const amount = latest.match(/(?:\$|usd\s*)\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (amount?.[1]) {
    draft.maxPerPurchaseMinor = Math.round(Number(amount[1].replace(',', '.')) * 100);
    draft.currency = 'USD';
  }

  if (/\b(ask me|ask for approval|pause|preg[uú]ntame|pedir aprobaci[oó]n)\b/i.test(latest)) {
    draft.escalation = 'require_human';
  } else if (/\b(block|never exceed|do not exceed|bloquea|nunca exced)\b/i.test(latest)) {
    draft.escalation = 'block';
  }

  const count = latest.match(
    /\b(?:up to|max(?:imum)?|hasta)\s+(\d+)\s+(?:purchases?|orders?|compras?)\b/i,
  );
  if (count?.[1]) draft.maxFulfillments = Number(count[1]);
  if (/\b(once|one purchase|single purchase|una compra|una vez)\b/i.test(latest)) {
    draft.maxFulfillments = 1;
  }

  if (draft.category === 'flight') {
    draft.currency ??= 'USD';
    draft.passengerCount ??= 1;
    draft.maxFulfillments ??= 1;
    draft.dateFlexibilityDays ??= 0;
    draft.escalation ??= 'require_human';
    const passengers = latest.match(/\b(\d+)\s+(?:passengers?|travelers?|pasajeros?|viajeros?)\b/i);
    if (passengers?.[1]) draft.passengerCount = Number(passengers[1]);
    const flexibility = latest.match(
      /(?:±|plus or minus|flexible by|flexibilidad de)\s*(\d+)\s*days?/i,
    );
    if (flexibility?.[1]) draft.dateFlexibilityDays = Number(flexibility[1]);
    const endpoints = routeCodes(latest);
    if (endpoints.origin) draft.origin = endpoints.origin;
    if (endpoints.destination) draft.destination = endpoints.destination;
    const dates = relativeDateRange(latest, now);
    if (dates) {
      draft.departureDateFrom = dates.from;
      draft.departureDateTo = dates.to;
    }
  }

  if (draft.category === 'goods') {
    draft.currency ??= 'USD';
    draft.maxQuantity ??= 1;
    draft.maxFulfillments ??= 1;
    draft.escalation ??= 'require_human';
    const quantity = latest.match(/\b(\d+)\s+(?:items?|units?|pairs?|art[ií]culos?|unidades?)\b/i);
    if (quantity?.[1]) draft.maxQuantity = Number(quantity[1]);
    const quoted = latest.match(/[“"]([^”"]{2,80})[”"]/);
    if (quoted?.[1]) draft.query = quoted[1].trim();
  }

  if (
    /\b(?:until|valid until|before|hasta|v[aá]lido hasta)\s+(?:the\s+)?end of (?:the )?month\b/i.test(
      latest,
    )
  ) {
    draft.validUntil = endOfMonth(now).toISOString();
  }
  const explicitExpiry = latest.match(
    /\b(?:until|valid until|before|hasta)\s+(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (explicitExpiry?.[1]) draft.validUntil = `${explicitExpiry[1]}T23:59:59.000Z`;

  return finalizeResponse('', MandateChatDraftSchema.parse(draft), 'scripted', now);
}

function finalizeResponse(
  proposedReply: string,
  proposedDraft: MandateChatDraft,
  interpreter: 'openai' | 'scripted',
  now: Date,
): MandateChatResponse {
  const draft = normalizeDraft(proposedDraft, now);
  const missingFields = missingFor(draft);
  const complete = missingFields.length === 0;
  const reply = complete
    ? proposedReply ||
      'I have enough information to prepare the plan. Review the exact rules before authorizing it.'
    : questionFor(missingFields[0]!);
  return MandateChatResponseSchema.parse({ reply, draft, missingFields, complete, interpreter });
}

function normalizeDraft(draft: MandateChatDraft, now: Date): MandateChatDraft {
  const next = { ...draft };
  if (next.validUntil && Date.parse(next.validUntil) <= now.getTime()) next.validUntil = null;
  if (
    next.departureDateFrom &&
    next.departureDateTo &&
    next.departureDateFrom > next.departureDateTo
  ) {
    next.departureDateFrom = null;
    next.departureDateTo = null;
  }
  if (next.category === 'flight') {
    next.query = null;
    next.maxQuantity = null;
  } else if (next.category === 'goods') {
    next.origin = null;
    next.destination = null;
    next.departureDateFrom = null;
    next.departureDateTo = null;
    next.dateFlexibilityDays = null;
    next.passengerCount = null;
  }
  return MandateChatDraftSchema.parse(next);
}

function missingFor(draft: MandateChatDraft): MissingField[] {
  if (!draft.category) return ['category'];
  const missing: MissingField[] = [];
  if (draft.category === 'flight') {
    if (!draft.origin) missing.push('origin');
    if (!draft.destination) missing.push('destination');
    if (!draft.departureDateFrom || !draft.departureDateTo) missing.push('departureDates');
    if (!draft.passengerCount) missing.push('passengerCount');
  } else {
    if (!draft.query) missing.push('query');
    if (!draft.maxQuantity) missing.push('maxQuantity');
  }
  if (!draft.maxPerPurchaseMinor || !draft.currency) missing.push('maximumPrice');
  if (!draft.maxFulfillments) missing.push('purchaseCount');
  if (!draft.validUntil) missing.push('validUntil');
  if (!draft.escalation) missing.push('outsideRules');
  return missing;
}

function questionFor(field: MissingField): string {
  const questions: Record<MissingField, string> = {
    category: 'What should I help you purchase: a flight or a product?',
    query: 'What product should I look for?',
    maxQuantity: 'What is the maximum quantity I may buy?',
    origin: 'Which city or airport should the flight leave from?',
    destination: 'Where should the flight go?',
    departureDates: 'What departure date or date range should I search?',
    passengerCount: 'How many passengers should the plan cover?',
    maximumPrice: 'What is the maximum total, including taxes and fees?',
    purchaseCount: 'How many purchases may this plan authorize?',
    validUntil: 'When should this authorization expire?',
    outsideRules: 'If an offer falls outside the rules, should I block it or ask you once?',
  };
  return questions[field];
}

function routeCodes(text: string): { origin?: string; destination?: string } {
  const explicit = text.match(/\bfrom\s+([A-Z]{3})\s+to\s+([A-Z]{3})\b/);
  if (explicit?.[1] && explicit[2]) return { origin: explicit[1], destination: explicit[2] };
  const matches = CITY_CODES.filter(([pattern]) => pattern.test(text)).map(([, code]) => code);
  if (matches.length >= 2) return { origin: matches[0], destination: matches[1] };
  return {};
}

function relativeDateRange(text: string, now: Date): { from: string; to: string } | undefined {
  const explicit = text.match(
    /\b(\d{4}-\d{2}-\d{2})\s+(?:to|through|until|a|hasta)\s+(\d{4}-\d{2}-\d{2})\b/i,
  );
  if (explicit?.[1] && explicit[2]) return { from: explicit[1], to: explicit[2] };
  if (/\bnext month\b|\bpr[oó]ximo mes\b/i.test(text)) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0));
    return { from: isoDate(first), to: isoDate(last) };
  }
  if (/\bnext week\b|\bpr[oó]xima semana\b/i.test(text)) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const daysUntilMonday = (8 - start.getUTCDay()) % 7 || 7;
    start.setUTCDate(start.getUTCDate() + daysUntilMonday);
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return { from: isoDate(start), to: isoDate(end) };
  }
  return undefined;
}

function endOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
