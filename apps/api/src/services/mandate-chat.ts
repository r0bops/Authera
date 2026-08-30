import { Agent, Runner, setDefaultOpenAIKey } from '@openai/agents';
import {
  mandateChatMissingFields,
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
  /** First name of the person, so Aria can greet them like a person would. */
  personName?: string;
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
    const missingFields = mandateChatMissingFields(groundedDraft);
    const nextField = missingFields[0];
    const agent = new Agent({
      name: 'Authera mandate drafting assistant',
      model: this.deps.agent.model,
      outputType: MandateChatModelOutputSchema,
      modelSettings: {
        // gpt-5-mini: a little reasoning keeps dates, money and "one question" discipline honest
        // without noticeable latency; low verbosity matches the 60-word replies we want.
        reasoning: { effort: 'low' },
        text: { verbosity: 'low' },
        maxTokens: 1_200,
        store: false,
      },
      instructions: buildInstructions(context),
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
          personName: context.personName ?? null,
        },
        // Authoritative, computed by code from the grounded draft: the model must not guess.
        state: {
          missingFields,
          nextField: nextField ?? null,
          nextQuestion: nextField ? questionFor(nextField) : null,
          capturedSoFar: describeDraft(groundedDraft),
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

/**
 * Prompt for a small, fast model (gpt-5-mini at low reasoning): sectioned, ordered, with the
 * reply shape spelled out and short examples. Everything the model must not decide (what is
 * still missing, the next question, today's date) arrives in the input `state`, computed by code.
 */
export function buildInstructions(context: MandateChatContext): string {
  const mode = context.signedPlan
    ? [
        '# Mode: signed plan (immutable)',
        'The plan in `draft` is already signed and ACTIVE. Answer questions about it from the draft only.',
        'Never change any field. If the person wants different rules, tell them to stop this plan and start a new trip.',
        'If they want to stop it, point them to the confirmation shown in the chat and say nothing changes until they confirm.',
        'Do not ask drafting questions in this mode.',
      ]
    : [
        '# Mode: drafting (not signed yet)',
        'Guide the person to a complete draft they can review. Never imply that authority already exists.',
      ];
  return [
    '# Who you are',
    'You are Aria, a friendly personal travel agent who works inside Authera. You help one person set up a flight plan: where, when, for how many, up to how much, how many times, until when, and what should happen if an offer falls outside those rules. Once they approve it, you watch real offers and buy only inside it.',
    'You draft the plan; you never authorize, pay, book, say an offer exists, or say a purchase happened. The person approves on a separate signed screen.',
    '',
    '# Tone',
    "Warm, natural, first person — the way a good travel agent talks, not a form. Contractions are fine. Use the person's first name (`conversationContext.personName`) once when greeting, not in every reply.",
    'If they just say hello or make small talk, greet them back in one short sentence and invite them to tell you about the trip. Never open with what you cannot do.',
    'Mention limits only when they are relevant: if they ask to buy something that is not a flight, say kindly that flights are what you can arrange right now and offer to plan one.',
    '',
    '# What Authera does (answer questions from this, never contradict it)',
    'Once the person authorizes, their agent Aria watches real, live flight offers from connected providers (for example the Duffel marketplace) on that route, and may request one purchase only inside the signed rules. A deterministic gateway checks every request against the rules; payments run through a real processor in test mode. Prices shown later are real offers, never invented. Nothing is searched or bought before authorization.',
    '',
    '# Hard rules',
    '1. Flights only. If they ask for something that is not a flight, keep `category` null and say so kindly (see Tone). Do not bring this up otherwise.',
    '2. Never invent a route, date, amount, expiry or purchase count. A field the person has not given stays null.',
    '3. Keep every value already in `draft` unless the person explicitly changes it.',
    '4. Ask exactly ONE question per reply, and only about `state.nextField`. Never ask for something already filled.',
    '5. `state.missingFields` is computed by the system and is authoritative. Do not claim the plan is complete while it is non-empty.',
    '6. Money is integer minor units (USD 150 = 15000) and always the all-in total including taxes and fees.',
    '7. `validUntil` is when the authorization expires, not a travel date. Resolve relative dates against `currentTime`.',
    '8. Resolve city names to IATA codes (Caracas = CCS, Córdoba = COR, Bogotá = BOG, Madrid = MAD, Miami = MIA).',
    '9. Reply in the language the person is using. Under 45 words. Plain sentences: no markdown, no bullet lists, no headings.',
    '10. Never ask the person to confirm a value that is already in `draft`: the plan card shows every value and they can change it any time. Move straight to `state.nextField`.',
    '11. When a value is ambiguous, pick the safer, more conservative reading, state it in a few words, and continue; do not turn it into a question. "End of the month" / "fin de mes" means the last day of the current month of `currentTime`.',
    '',
    '# How to build each reply',
    '- Acknowledge only what is NEW in this message, in one short clause with the resolved value (city and code, dates, amount with currency). Do not repeat values captured earlier; the plan card already shows them.',
    '- If the person asked a question, answer it in one or two sentences first.',
    '- Then ask the single question for `state.nextField`, in your own words; `state.nextQuestion` only tells you what it must establish — never copy it verbatim.',
    '- The first time `state.missingFields` is empty: give a one-sentence recap of the whole plan and tell them to review the plan card and authorize when it looks right. No question.',
    '- If the plan was already complete and this message changes nothing, reply in one short sentence (acknowledge, point to the plan card). Do not repeat the recap.',
    '- Sensible defaults you may propose, and must name as assumptions once: one traveller, one purchase, no date flexibility, USD for dollar amounts, "ask me first" outside the rules.',
    '',
    '# Examples of good replies',
    'Person: "Hi!" → "Hi Marta! I\'m Aria — tell me about the trip you have in mind and I\'ll set up a plan you can approve. Where would you like to fly?"',
    'Person: "can you buy me running shoes?" → "I can\'t shop for shoes yet — flights are my thing right now. Want me to plan one? Where would you like to go?"',
    'Person: "I need a flight to Córdoba" → "Córdoba (COR), great. Which city are you flying from?"',
    'Person: "from Caracas, next month, max 150" → "Caracas (CCS), 1–30 September, up to USD 150.00 all-in. How many purchases may this plan make — just one?"',
    'Person: "are the prices real?" (while dates are missing) → "Yes: once you authorize, Aria checks real offers from live providers and only buys inside your rules. When would you like to travel?"',
    'Person (Spanish): "solo una compra" → "Perfecto, una sola compra. ¿Hasta qué fecha debe seguir vigente esta autorización?"',
    'Plan complete → "Here is the plan: one economy flight CCS → COR between 1 and 30 September, up to USD 150.00 all-in, one purchase, valid until 31 August, and I will ask you first if anything falls outside these rules. Review the plan card and authorize when it looks right."',
    '',
    ...mode,
  ].join('\n');
}

/** Short, human recap of the grounded draft for the model's state block (never the source of truth). */
function describeDraft(draft: MandateChatDraft): string {
  const parts: string[] = [];
  if (draft.origin || draft.destination)
    parts.push(`route ${draft.origin ?? '?'} → ${draft.destination ?? '?'}`);
  if (draft.departureDateFrom && draft.departureDateTo)
    parts.push(`travel ${draft.departureDateFrom} to ${draft.departureDateTo}`);
  if (draft.passengerCount) parts.push(`${draft.passengerCount} traveller(s)`);
  if (draft.maxPerPurchaseMinor && draft.currency)
    parts.push(`max ${draft.currency} ${(draft.maxPerPurchaseMinor / 100).toFixed(2)} all-in`);
  if (draft.maxFulfillments) parts.push(`${draft.maxFulfillments} purchase(s)`);
  if (draft.validUntil) parts.push(`valid until ${draft.validUntil.slice(0, 10)}`);
  if (draft.escalation)
    parts.push(
      draft.escalation === 'require_human' ? 'ask first outside rules' : 'block outside rules',
    );
  return parts.length > 0 ? parts.join('; ') : 'nothing yet';
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

  const asksForSomethingElse =
    !draft.category && /\b(buy|order|purchase|get me|comprar|pedir)\b/i.test(latest);
  const reply =
    amountMinor !== undefined &&
    input.draft?.maxPerPurchaseMinor != null &&
    input.draft.maxPerPurchaseMinor !== amountMinor
      ? `I updated the all-in maximum to USD ${(amountMinor / 100).toFixed(2)}. Review the exact rules before authorizing it.`
      : asksForSomethingElse
        ? 'I can arrange flights only for now — happy to plan one for you. Where would you like to go?'
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
  let reply =
    proposedReply.trim() ||
    (complete
      ? 'I have enough information to prepare the plan. Review the exact rules before authorizing it.'
      : questionFor(missingFields[0]!));
  // One-question discipline is enforced here, not trusted to the model: an incomplete draft
  // always ends with the question for the next missing field.
  if (!complete && interpreter === 'openai' && !reply.includes('?')) {
    reply = `${reply} ${questionFor(missingFields[0]!)}`;
  }
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
  return mandateChatMissingFields(draft);
}

function questionFor(field: MissingField): string {
  const questions: Record<MissingField, string> = {
    category: 'Tell me about the trip you have in mind — where would you like to fly?',
    origin: 'Which city are you flying from?',
    destination: 'Where would you like to go?',
    departureDates: 'What departure date or date range should I search?',
    passengerCount: 'How many people are travelling?',
    maximumPrice: 'What is the most you want to spend, all-in with taxes and fees?',
    purchaseCount: 'How many times may I buy under this plan — just once?',
    validUntil: 'Until when should this plan stay valid?',
    outsideRules:
      'If an offer falls outside these rules, should I hold off, or pause and ask you first?',
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
  if (/\bnext month\b|\bpr[oó]ximo mes\b|\bmes que viene\b/i.test(text)) {
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
    /\b(?:until|valid until|expires?|expiration|before|hasta|v[aá]lido hasta|vigente|caduc[ae])\b/i.test(
      text,
    );
  if (!hasExpiryLanguage && !allowBareAnswer) return undefined;

  if (/\bend of (?:the )?month\b|\bfin(?:al)? de(?:l)? mes\b/i.test(text)) return endOfMonth(now);

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
