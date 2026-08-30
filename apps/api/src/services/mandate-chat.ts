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
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';

const EMPTY_DRAFT: MandateChatDraft = {
  category: null,
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

export interface MandateChatContext {
  signedPlan?: boolean;
  lifecycle?: 'ACTIVE' | 'BOOKED' | 'REVOKED';
}

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

  async interpret(
    input: MandateChatRequest,
    context: MandateChatContext = {},
  ): Promise<MandateChatResponse> {
    const now = this.deps.clock.now();
    const grounded = scriptedMandateChat(input, now);
    const fallback = context.signedPlan
      ? scriptedSignedPlanChat(input, grounded.draft, now)
      : grounded;
    if (this.deps.agent.mode === 'openai') {
      try {
        return await this.interpretWithOpenAi(input, grounded.draft, context);
      } catch (error) {
        this.deps.logger.warn(
          { err: error instanceof Error ? error : new Error('unknown chat interpreter error') },
          'OpenAI chat response failed',
        );
        throw new ApiProblem(
          503,
          'CHAT_MODEL_UNAVAILABLE',
          'Aria could not reply right now. Please try again.',
        );
      }
    }
    return fallback;
  }

  private async interpretWithOpenAi(
    input: MandateChatRequest,
    groundedDraft: MandateChatDraft,
    context: MandateChatContext,
  ): Promise<MandateChatResponse> {
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
        'This assistant supports economy flights only. Ask at most one concise follow-up question at a time.',
        'Answer concise questions about trip planning, the current plan, Authera authorization, safety, payments, and the next action the person can take.',
        'Preserve confirmed values from the existing draft unless the user explicitly changes them.',
        'Never invent a budget, route, travel date, expiration, or purchase count.',
        'Safe defaults may be proposed and must remain visible for confirmation: one passenger, one purchase, zero date-flexibility days, USD for a dollar amount, and require_human outside the rules.',
        'Resolve city names to IATA codes. Resolve relative dates against the supplied current ISO time.',
        'Money is integer minor units. The maximum is the complete total including taxes and fees.',
        'validUntil is the mandate authorization expiry, not the flight departure date.',
        'Set complete true only when all fields required for the selected intent are present.',
        'For flights require origin, destination, departure range, passenger count, maximum price, currency, purchase count, mandate expiry, and outside-rules behavior.',
        'If the user asks to purchase a category other than a flight, explain that purchasing currently supports flights only and keep category null.',
        context.signedPlan
          ? 'The plan is already signed and immutable. Answer questions using its supplied draft and ACTIVE status. Never change its fields. If the user wants different rules, direct them to stop this plan and start a new trip. If they want to stop it, direct them to the trusted confirmation in the chat and state that nothing changes until they confirm.'
          : 'The plan is not signed yet. Guide the person toward a complete draft they can review, without implying that authority already exists.',
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
      JSON.stringify({
        currentTime: now.toISOString(),
        conversationContext: {
          signedPlan: context.signedPlan ?? false,
          lifecycle: context.lifecycle ?? null,
        },
        ...input,
        draft: groundedDraft,
      }),
      { maxTurns: 2, signal: AbortSignal.timeout(30_000) },
    );
    if (!result.finalOutput) throw new Error('OpenAI returned no mandate draft');
    const parsed = MandateChatModelOutputSchema.parse(result.finalOutput);
    return finalizeResponse(
      parsed.reply,
      mergeGroundedDraft(groundedDraft, parsed.draft),
      'openai',
      now,
    );
  }
}

function mergeGroundedDraft(
  grounded: MandateChatDraft,
  interpreted: MandateChatDraft,
): MandateChatDraft {
  return MandateChatDraftSchema.parse(
    Object.fromEntries(
      Object.keys(grounded).map((key) => {
        const field = key as keyof MandateChatDraft;
        return [field, interpreted[field] ?? grounded[field]];
      }),
    ),
  );
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
  }

  const amountMinor = usdAmountMinor(latest);
  if (amountMinor !== undefined) {
    draft.maxPerPurchaseMinor = amountMinor;
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
    const explicitlyChangesTravel =
      /\b(depart|departure|travel|fly|leave|salir|viajar|volar)\b/i.test(latest);
    if (dates && (!draft.departureDateFrom || !draft.departureDateTo || explicitlyChangesTravel)) {
      draft.departureDateFrom = dates.from;
      draft.departureDateTo = dates.to;
    }
  }

  const expiry = authorizationExpiry(latest, now, isWaitingForValidity(draft));
  if (expiry) draft.validUntil = expiry.toISOString();

  const reply =
    amountMinor !== undefined &&
    input.draft?.maxPerPurchaseMinor != null &&
    input.draft.maxPerPurchaseMinor !== amountMinor
      ? `I updated the all-in maximum to USD ${(amountMinor / 100).toFixed(2)}. Review the exact rules before authorizing it.`
      : '';
  return finalizeResponse(reply, MandateChatDraftSchema.parse(draft), 'scripted', now);
}

function usdAmountMinor(text: string): number | undefined {
  const number = String.raw`([0-9][0-9,.]*(?:[.,][0-9]{1,2})?)`;
  const patterns = [
    new RegExp(String.raw`(?:\$|\bUSD\s*)\s*${number}`, 'i'),
    new RegExp(String.raw`${number}\s*(?:\$|USD\b)`, 'i'),
    new RegExp(
      String.raw`\b(?:maximum|max|budget|limit|under|below|up to|no more than)(?:\s+(?:is|of|at))?\s*(?:USD\s*|\$\s*)?${number}`,
      'i',
    ),
  ];
  const raw = patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean);
  if (!raw) return undefined;
  let normalized = raw;
  if (raw.includes('.') && raw.includes(',')) normalized = raw.replaceAll(',', '');
  else if (raw.includes(',')) {
    normalized = /,\d{1,2}$/.test(raw) ? raw.replace(',', '.') : raw.replaceAll(',', '');
  }
  const major = Number(normalized);
  return Number.isFinite(major) && major > 0 ? Math.round(major * 100) : undefined;
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
  const reply =
    proposedReply.trim() ||
    (complete
      ? 'I have enough information to prepare the plan. Review the exact rules before authorizing it.'
      : questionFor(missingFields[0]!));
  return MandateChatResponseSchema.parse({ reply, draft, missingFields, complete, interpreter });
}

function scriptedSignedPlanChat(
  input: MandateChatRequest,
  draft: MandateChatDraft,
  now: Date,
): MandateChatResponse {
  const message = input.messages.at(-1)?.content ?? '';
  let reply =
    'This plan is still active and watching verified flight providers. No signed rule has changed, and a verified booking will appear here when one completes.';
  if (/\b(change|edit|raise|lower|increase|decrease|instead|different)\b/i.test(message)) {
    reply =
      'The signed rules cannot change silently. Stop this plan first, then start a new trip and I will build the replacement with you.';
  } else if (/\b(stop|revoke|cancel)\b/i.test(message)) {
    reply =
      'I can stop the plan, but only through the trusted confirmation shown in this chat. Nothing is revoked until you confirm it.';
  }
  return finalizeResponse(reply, draft, 'scripted', now);
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
  return MandateChatDraftSchema.parse(next);
}

function missingFor(draft: MandateChatDraft): MissingField[] {
  if (!draft.category) return ['category'];
  const missing: MissingField[] = [];
  if (!draft.origin) missing.push('origin');
  if (!draft.destination) missing.push('destination');
  if (!draft.departureDateFrom || !draft.departureDateTo) missing.push('departureDates');
  if (!draft.passengerCount) missing.push('passengerCount');
  if (!draft.maxPerPurchaseMinor || !draft.currency) missing.push('maximumPrice');
  if (!draft.maxFulfillments) missing.push('purchaseCount');
  if (!draft.validUntil) missing.push('validUntil');
  if (!draft.escalation) missing.push('outsideRules');
  return missing;
}

function questionFor(field: MissingField): string {
  const questions: Record<MissingField, string> = {
    category: 'I currently handle flights only. Which city or airport should you fly from and to?',
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
  if (/\b(?:tomorrow|the next day|from tomorrow|ma[nñ]ana)\b/i.test(text)) {
    const tomorrow = shiftUtcDay(now, 1);
    return { from: isoDate(tomorrow), to: isoDate(tomorrow) };
  }
  if (/\b(?:today|hoy)\b/i.test(text)) {
    const today = shiftUtcDay(now, 0);
    return { from: isoDate(today), to: isoDate(today) };
  }
  return undefined;
}

function isWaitingForValidity(draft: MandateChatDraft): boolean {
  return Boolean(
    draft.category &&
    draft.origin &&
    draft.destination &&
    draft.departureDateFrom &&
    draft.departureDateTo &&
    draft.passengerCount &&
    draft.maxPerPurchaseMinor &&
    draft.currency &&
    draft.maxFulfillments &&
    !draft.validUntil,
  );
}

/** Resolve an authorization end date without letting a bare date overwrite travel dates. */
function authorizationExpiry(text: string, now: Date, allowBareAnswer: boolean): Date | undefined {
  const hasExpiryLanguage =
    /\b(?:until|valid until|expires?|expiration|before|hasta|v[aá]lido hasta)\b/i.test(text);
  if (!hasExpiryLanguage && !allowBareAnswer) return undefined;

  if (/\bend of (?:the )?month\b/i.test(text)) return endOfMonth(now);

  const days = text.match(/\b(?:in|within)\s+(?:the\s+)?next\s+(\d{1,3})\s+days?\b/i);
  if (days?.[1]) return endOfUtcDay(shiftUtcDay(now, Number(days[1])));

  if (/\b(?:tomorrow|the next day|from tomorrow|ma[nñ]ana)\b/i.test(text)) {
    return endOfUtcDay(shiftUtcDay(now, 1));
  }
  if (/\b(?:today|hoy)\b/i.test(text)) return endOfUtcDay(now);

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return validUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (slash?.[1] && slash[2] && slash[3]) {
    const rawYear = Number(slash[3]);
    const year = rawYear < 100 ? 2_000 + rawYear : rawYear;
    return validUtcDate(year, Number(slash[1]), Number(slash[2]));
  }
  return undefined;
}

function validUtcDate(year: number, month: number, day: number): Date | undefined {
  const result = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
  if (
    result.getUTCFullYear() !== year ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return undefined;
  }
  return result;
}

function shiftUtcDay(now: Date, days: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
}

function endOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59),
  );
}

function endOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
