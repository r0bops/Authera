import { Agent, Runner, setDefaultOpenAIKey } from '@openai/agents';
import {
  mandateChatMissingFields,
  MandateChatDraftSchema,
  MandateChatModelOutputSchema,
  MandateChatResponseSchema,
  type MandateChatDraft,
  type MandateChatModelDraft,
  type MandateChatRequest,
  type MandateChatResponse,
} from '@authera/contracts';
import type { Clock } from '../clock.js';
import type { AgentConfig } from '../config.js';
import { ApiProblem } from '../http/problem.js';
import type { Logger } from '../logger.js';
import type { z } from 'zod';

const EMPTY_DRAFT: MandateChatDraft = {
  category: null,
  origin: null,
  destination: null,
  departureDateFrom: null,
  departureTimeFrom: null,
  departureTimeTo: null,
  maxDurationMinutes: null,
  maxStops: null,
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

/** Live fares for the route being discussed — computed by code, quoted by Aria, never invented. */
export interface MarketSnapshot {
  origin: string;
  destination: string;
  count: number;
  cheapest: {
    amountMinor: number;
    currency: string;
    airline: string;
    date: string;
    stops: number | null;
    durationMinutes: number | null;
  } | null;
  limitMinor: number | null;
  withinLimitCount: number | null;
}

export interface MandateChatContext {
  signedPlan?: boolean;
  /** What the catalog holds right now for the draft's route; absent when the route is unknown. */
  market?: MarketSnapshot | null;
  lifecycle?: 'ACTIVE' | 'BOOKED' | 'REVOKED';
  /** First name of the person, so Aria can greet them like a person would. */
  personName?: string;
}

/** JS `\b` is ASCII-only, so "Bogotá" would never match — bound on Unicode letters instead. */
function city(pattern: string): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${pattern})(?!\\p{L})`, 'iu');
}

const CITY_CODES: ReadonlyArray<[RegExp, string]> = [
  [city('caracas'), 'CCS'],
  [city('c[oó]rdoba'), 'COR'],
  [city('bogot[aá]'), 'BOG'],
  [city('medell[ií]n'), 'MDE'],
  [city('buenos aires'), 'EZE'],
  [city('s[aã]o paulo'), 'GRU'],
  [city('rio de janeiro'), 'GIG'],
  [city('santiago'), 'SCL'],
  [city('lima'), 'LIM'],
  [city('mexico city|ciudad de m[eé]xico'), 'MEX'],
  [city('casablanca'), 'CMN'],
  [city('marrakech|marrakesh'), 'RAK'],
  [city('cairo|el cairo'), 'CAI'],
  [city('nairobi'), 'NBO'],
  [city('johannesburg|johannesburgo'), 'JNB'],
  [city('cape town|ciudad del cabo'), 'CPT'],
  [city('lagos'), 'LOS'],
  [city('addis ababa'), 'ADD'],
  [city('lisbon|lisboa'), 'LIS'],
  [city('paris|par[ií]s'), 'CDG'],
  [city('london|londres'), 'LHR'],
  [city('new york|nueva york'), 'JFK'],
  [city('tokyo|tokio'), 'NRT'],
  [city('panama city|ciudad de panam[aá]'), 'PTY'],
  [city('quito'), 'UIO'],
  [city('montevideo'), 'MVD'],
  [city('miami'), 'MIA'],
  [city('madrid'), 'MAD'],
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
    if (this.deps.agent.mode !== 'openai') {
      // Aria is the model. Deterministic parsing only grounds the draft; it never speaks for her.
      throw new ApiProblem(
        503,
        'CHAT_MODEL_UNAVAILABLE',
        'Aria needs the OpenAI model (OPENAI_MODE=openai) to reply.',
      );
    }
    {
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
        // Live fares on the route, computed by code: the only fares Aria may ever mention.
        market: context.market ?? null,
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
        '# Mode: signed plan (active)',
        'The plan in `draft` is signed and ACTIVE. Answer questions about it from the draft only.',
        'If the person asks to change the maximum price, the number of purchases, the validity, the travel dates, date flexibility, the passengers, or what happens outside the rules: put the new value in `draft` (keep everything else exactly as it is), and say you will update the plan as soon as they confirm on the plan card — nothing changes until they confirm, and the current rules stay in force meanwhile.',
        'The route (origin, destination) and the currency cannot change on a signed plan: for a different trip, tell them to stop this plan and start a new one.',
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
    'Talk like a good travel agent texting a client: short, warm, specific, one thought at a time. Acknowledge what they just told you in a few words before asking the next thing ("Caracas to Córdoba, got it — when would you like to go?"). Vary your openings; never start two replies the same way.',
    'Say money and dates the way people do ("under USD 150", "any day from the 10th to the 20th"). No lists, no headings, no labels like "Origin:". When the draft is complete, sum it up in one natural sentence and point to the plan card, without repeating every field.',
    'Never mention being an AI, a model, or a system. If you don’t know something, say so plainly and move on.',
    "Warm, natural, first person — the way a good travel agent talks, not a form. Contractions are fine. Use the person's first name (`conversationContext.personName`) once when greeting, not in every reply.",
    'If they just say hello or make small talk, greet them back in one short sentence and invite them to tell you about the trip. Never open with what you cannot do.',
    'Mention limits only when they are relevant: if they ask to buy something that is not a flight, say kindly that flights are what you can arrange right now and offer to plan one.',
    '',
    '# What Authera does (answer questions from this, never contradict it)',
    'Once the person authorizes, their agent Aria watches real, live flight offers from connected providers (for example the Duffel marketplace) on that route, and may request one purchase only inside the signed rules. A deterministic gateway checks every request against the rules; payments run through a real processor in test mode. Prices shown later are real offers, never invented. Nothing is searched or bought before authorization.',
    '',
    '# Hard rules',
    '1. Flights only. If they ask for something that is not a flight, keep `category` null and say so kindly (see Tone). Do not bring this up otherwise.',
    '2b. `market` (when present) is the live catalog for this route right now, computed by the system. You MAY cite it — count, cheapest fare with airline/date/stops, how many fit the limit — always as "right now", with the numbers verbatim, and you may suggest a limit from it. Never mention any other fare, and never imply anything was bought. If the person asks about prices and `market` is null, say you have nothing on that route yet and that you keep looking.',
    '2c. If they name a country or region instead of a city ("Morocco", "Africa"), do not loop: say the two or three main airports you could use (e.g. Casablanca, Marrakech) and ask which city — that is the next question. Once they answer, move on.',
    '2d. Never repeat a previous reply, and greet only in your very first message of a conversation. If the person already answered something, acknowledge it in three words and ask the NEXT missing thing.',
    '2. Never invent a route, date, amount, expiry or purchase count. A field the person has not given stays null.',
    '3. Keep every value already in `draft` unless the person explicitly changes it.',
    '4. Ask exactly ONE question per reply, and only about `state.nextField`. Never ask for something already filled.',
    '5. `state.missingFields` is computed by the system and is authoritative. Do not claim the plan is complete while it is non-empty.',
    '6. In `draft`, money is integer minor units (USD 150 = 15000), always the all-in total including taxes and fees. In the reply, write money only as the person would say it (USD 150.00); never mention cents, minor units or field names.',
    '7. `validUntil` is when the authorization expires, not a travel date. Resolve relative dates against `currentTime`.',
    '7c. Stopovers and total travel time are optional too: "direct"/"nonstop"/"sin escalas" → `maxStops` 0, "one stop max" → 1; "under 8 hours"/"máximo 6 horas" → `maxDurationMinutes`. Only when the person says so; never ask.',
    '7b. A departure-time preference is optional: only when the person says it ("mornings", "after 6 pm", "between 8 and 11 am"), set `departureTimeFrom`/`departureTimeTo` as HH:mm local time (morning 05:00–11:59, afternoon 12:00–17:59, evening/night 18:00–23:59). Never ask for it.',
    '8. Resolve city names to the city’s main IATA code (Caracas = CCS, Córdoba = COR, Bogotá = BOG, Medellín = MDE, Madrid = MAD, Miami = MIA). Never ask which airport of a city to use unless the person mentions airports themselves.',
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
  if (draft.departureTimeFrom && draft.departureTimeTo)
    parts.push(`departing ${draft.departureTimeFrom}–${draft.departureTimeTo}`);
  if (draft.maxStops !== null && draft.maxStops !== undefined)
    parts.push(draft.maxStops === 0 ? 'direct only' : `at most ${draft.maxStops} stop(s)`);
  if (draft.maxDurationMinutes) parts.push(`under ${Math.round(draft.maxDurationMinutes / 60)} h`);
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

/**
 * The model's draft is advisory: every field is validated against the strict draft shape, and
 * anything that does not fit ("" for a time, 0 for a limit, an unknown currency) falls back to
 * what deterministic grounding already established.
 */
function mergeGroundedDraft(
  grounded: MandateChatDraft,
  interpreted: MandateChatModelDraft,
): MandateChatDraft {
  const merged: Record<string, unknown> = {};
  const fieldSchemas = MandateChatDraftSchema.shape as Record<string, z.ZodTypeAny>;
  for (const key of Object.keys(grounded) as Array<keyof MandateChatDraft>) {
    const candidate = coerceModelValue(key, interpreted[key]);
    const schema = fieldSchemas[key];
    const accepted =
      candidate !== null && candidate !== undefined && candidate !== '' && schema
        ? schema.safeParse(candidate)
        : null;
    merged[key] = accepted?.success ? accepted.data : grounded[key];
  }
  return MandateChatDraftSchema.parse(merged);
}

export function scriptedMandateChat(input: MandateChatRequest, now: Date): MandateChatResponse {
  const text = input.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join(' ');
  const latest = input.messages.at(-1)?.content ?? '';
  const draft = { ...EMPTY_DRAFT, ...(input.draft ?? {}) };

  // Aria only arranges flights: any travel intent, a named place, or a "yes" to her offer is one.
  if (
    /\b(flight|fly|flying|airfare|ticket|vuelo|volar|pasaje|travel|trip|go to|going to|visit|viajar|viaje|ir a)\b/i.test(
      text,
    ) ||
    routeCodes(text).origin ||
    routeCodes(text).destination ||
    (input.draft?.origin ?? null) !== null ||
    /^\s*(yes|yeah|yep|sure|ok(ay)?|please|s[ií]|claro|dale|vale)\b/i.test(latest)
  ) {
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
    const travel = travelConstraints(latest);
    if (travel.maxDurationMinutes !== undefined)
      draft.maxDurationMinutes = travel.maxDurationMinutes;
    if (travel.maxStops !== undefined) draft.maxStops = travel.maxStops;
    const timeWindow = departureTimeWindow(latest);
    if (timeWindow) {
      draft.departureTimeFrom = timeWindow.from;
      draft.departureTimeTo = timeWindow.to;
    }
    const dates = relativeDateRange(latest, now);
    const explicitlyChangesTravel =
      /\b(depart|departure|travel|fly|leave|salir|viajar|volar)\b/i.test(latest);
    if (dates && (!draft.departureDateFrom || !draft.departureDateTo || explicitlyChangesTravel)) {
      draft.departureDateFrom = dates.from;
      draft.departureDateTo = dates.to;
    }
  }

  const explicit = explicitExpiryDate(latest, now);
  if (explicit) draft.validUntil = explicit.toISOString();
  const expiry = explicit ? null : authorizationExpiry(latest, now, isWaitingForValidity(draft));
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
    category: 'Where would you like to fly, and from where?',
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
  const found = CITY_CODES.filter(([pattern]) => pattern.test(text));
  if (found.length >= 2) return { origin: found[0]![1], destination: found[1]![1] };
  if (found.length === 1) {
    // One city: "from Bogotá" is the origin; "to Casablanca", or a bare answer, is the destination.
    const [pattern, code] = found[0]!;
    const source = pattern.source
      .replace(/^\(\?<!\\p\{L\}\)\(\?:/, '')
      .replace(/\)\(\?!\\p\{L\}\)$/, '');
    if (new RegExp(`\\b(?:from|desde|de)\\s+(?:${source})`, 'iu').test(text))
      return { origin: code };
    return { destination: code };
  }
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

/**
 * "mornings", "after 6 pm", "before 10", "between 8 and 11 am" → an HH:mm window (local time at
 * the origin). Deterministic; the model only ever refines what this already grounded.
 */
export function departureTimeWindow(text: string): { from: string; to: string } | null {
  const t = text.toLowerCase();
  const hhmm = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const hour = (raw: string, ampm?: string): number => {
    let h = Number(raw);
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return Math.min(23, Math.max(0, h));
  };
  const between = t.match(
    /\b(?:between|entre)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:and|y|-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/,
  );
  if (between) {
    const late = between[6] ?? between[3];
    const early = between[3] ?? between[6];
    const from = hour(between[1]!, early);
    const to = hour(between[4]!, late);
    if (from <= to)
      return { from: hhmm(from, Number(between[2] ?? 0)), to: hhmm(to, Number(between[5] ?? 0)) };
  }
  const after = t.match(/\b(?:after|despu[eé]s de|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (after && !/\b(day|days|d[ií]as|week|month|mes)\b/.test(after[0]))
    return { from: hhmm(hour(after[1]!, after[3]), Number(after[2] ?? 0)), to: '23:59' };
  const before = t.match(/\b(?:before|antes de)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (before)
    return { from: '00:00', to: hhmm(hour(before[1]!, before[3]), Number(before[2] ?? 0)) };
  if (/\b(morning|mornings|ma[ñn]ana|early)\b/.test(t) && !/\btomorrow\b/.test(t))
    return { from: '05:00', to: '11:59' };
  if (/\b(afternoon|afternoons|tarde)\b/.test(t)) return { from: '12:00', to: '17:59' };
  if (/\b(evening|evenings|night|nights|noche|late)\b/.test(t))
    return { from: '18:00', to: '23:59' };
  return null;
}

/** "direct", "nonstop", "sin escalas", "one stop max", "under 8 hours", "máximo 6 horas". */
export function travelConstraints(text: string): {
  maxDurationMinutes?: number;
  maxStops?: number;
} {
  const t = text.toLowerCase();
  const out: { maxDurationMinutes?: number; maxStops?: number } = {};
  if (/\b(direct|non-?stop|nonstop|sin escalas?|directo|vuelo directo)\b/.test(t)) out.maxStops = 0;
  const stops = t.match(
    /\b(?:at most|max(?:imum)?|up to|m[aá]ximo|hasta)\s+(one|1|two|2)\s+(?:stop|stops|escala|escalas|connection|connections)\b/,
  );
  const stopsAfter = t.match(
    /\b(one|1|two|2)\s+(?:stop|stops|escala|escalas|connection|connections)\s+(?:max(?:imum)?|at most|m[aá]ximo|tops)\b/,
  );
  const stopsWord = stops?.[1] ?? stopsAfter?.[1];
  if (stopsWord) out.maxStops = /^(one|1)$/.test(stopsWord) ? 1 : 2;
  const hours = t.match(
    /\b(?:under|less than|at most|max(?:imum)?|no more than|menos de|m[aá]ximo|hasta)\s+(\d{1,2})(?:\.(\d))?\s*(?:h|hr|hrs|hours?|horas?)\b/,
  );
  if (hours)
    out.maxDurationMinutes = Math.round((Number(hours[1]) + Number(hours[2] ?? 0) / 10) * 60);
  return out;
}

/** Nudge near-miss model values into shape before validation ("2026-09-30T23:59:59" → ISO, "9:00" → "09:00"). */
function coerceModelValue(key: keyof MandateChatDraft, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (key === 'validUntil' && typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }
  if ((key === 'departureDateFrom' || key === 'departureDateTo') && typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
  }
  if ((key === 'departureTimeFrom' || key === 'departureTimeTo') && typeof value === 'string') {
    const m = value.match(/^(\d{1,2}):(\d{2})/);
    return m ? `${m[1]!.padStart(2, '0')}:${m[2]}` : value;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
  if (
    typeof value === 'string' &&
    (key === 'origin' || key === 'destination' || key === 'currency')
  )
    return value.trim().toUpperCase();
  if (typeof value === 'string' && (key === 'category' || key === 'escalation'))
    return value.trim().toLowerCase();
  return value;
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  enero: 0,
  ene: 0,
  february: 1,
  feb: 1,
  febrero: 1,
  march: 2,
  mar: 2,
  marzo: 2,
  april: 3,
  apr: 3,
  abril: 3,
  abr: 3,
  may: 4,
  mayo: 4,
  june: 5,
  jun: 5,
  junio: 5,
  july: 6,
  jul: 6,
  julio: 6,
  august: 7,
  aug: 7,
  agosto: 7,
  ago: 7,
  september: 8,
  sep: 8,
  sept: 8,
  septiembre: 8,
  setiembre: 8,
  october: 9,
  oct: 9,
  octubre: 9,
  november: 10,
  nov: 10,
  noviembre: 10,
  december: 11,
  dec: 11,
  diciembre: 11,
  dic: 11,
};

/** "valid until 30 September", "hasta el 15 de octubre", "until Sept 30, 2026" → end of that day (UTC). */
export function explicitExpiryDate(text: string, now: Date): Date | null {
  const m = text.match(
    /\b(?:valid|válido|valido|vigente|good)?\s*(?:until|till|through|hasta)\s+(?:the\s+|el\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+|de\s+)?([a-záéíóú]+)|([a-záéíóú]+)\s+(\d{1,2})(?:st|nd|rd|th)?)(?:,?\s+(\d{4}))?/i,
  );
  if (!m) return null;
  const day = Number(m[1] ?? m[4]);
  const monthName = (m[2] ?? m[3] ?? '').toLowerCase();
  const month = MONTHS[monthName];
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) return null;
  let year = m[5] ? Number(m[5]) : now.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, day, 23, 59, 59));
  if (!m[5] && candidate.getTime() < now.getTime()) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, day, 23, 59, 59));
  }
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}
