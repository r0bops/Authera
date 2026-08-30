import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MandateChatDraft, MandateChatModelOutput } from '@authera/contracts';
import { fixedClock } from '../clock.js';
import { createLogger } from '../logger.js';
import { MandateChatService } from './mandate-chat.js';

const openAi = vi.hoisted(() => ({
  run: vi.fn(),
  setKey: vi.fn(),
}));

vi.mock('@openai/agents', () => ({
  Agent: class Agent {
    constructor(readonly options: unknown) {}
  },
  Runner: class Runner {
    constructor(readonly options: unknown) {}

    run(...args: unknown[]) {
      return openAi.run(...args);
    }
  },
  setDefaultOpenAIKey: openAi.setKey,
}));

const completeDraft: MandateChatDraft = {
  category: 'flight',
  origin: 'CCS',
  destination: 'COR',
  departureDateFrom: '2026-09-01',
  departureDateTo: '2026-09-30',
  dateFlexibilityDays: 0,
  passengerCount: 1,
  maxPerPurchaseMinor: 15_000,
  currency: 'USD',
  maxFulfillments: 1,
  validUntil: '2026-08-31T23:59:59.000Z',
  escalation: 'require_human',
};

const emptyDraft: MandateChatDraft = {
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

function service() {
  return new MandateChatService({
    agent: { mode: 'openai', model: 'gpt-test', apiKey: 'sk-test' },
    clock: fixedClock('2026-08-29T12:00:00.000Z'),
    logger: createLogger({ level: 'silent' }),
  });
}

function modelOutput(
  reply: string,
  draft: MandateChatDraft,
  complete: boolean,
): MandateChatModelOutput {
  return {
    reply,
    draft,
    missingFields: complete ? [] : ['category'],
    complete,
  };
}

describe('OpenAI mandate chat', () => {
  beforeEach(() => {
    openAi.run.mockReset();
    openAi.setKey.mockReset();
  });

  it('uses the model even when deterministic grounding already found every field', async () => {
    openAi.run.mockResolvedValue({
      finalOutput: modelOutput(
        'Your flight rules are ready. Please review the total and expiry before authorizing.',
        completeDraft,
        true,
      ),
    });

    const result = await service().interpret({
      messages: [
        {
          role: 'user',
          content:
            'Buy one flight from Caracas to Córdoba next month under $150, valid until the end of the month.',
        },
      ],
      draft: null,
    });

    expect(openAi.run).toHaveBeenCalledOnce();
    expect(result.interpreter).toBe('openai');
    expect(result.reply).toContain('flight rules are ready');
  });

  it('keeps the model reply while deterministic code validates the missing fields', async () => {
    openAi.run.mockResolvedValue({
      finalOutput: modelOutput(
        'Absolutely. Do you want somewhere calm by the beach, or a warmer city?',
        emptyDraft,
        false,
      ),
    });

    const result = await service().interpret({
      messages: [
        {
          role: 'user',
          content: 'Could you guide me through planning a quiet trip somewhere warm?',
        },
      ],
      draft: null,
    });

    expect(result.reply).toBe(
      'Absolutely. Do you want somewhere calm by the beach, or a warmer city?',
    );
    expect(result.complete).toBe(false);
    expect(result.missingFields[0]).toBe('category');
  });

  it('sends signed-plan questions to the model with immutable-plan context', async () => {
    openAi.run.mockResolvedValue({
      finalOutput: modelOutput(
        'I am still watching verified providers within your signed USD 150 limit.',
        completeDraft,
        true,
      ),
    });

    const result = await service().interpret(
      {
        messages: [{ role: 'user', content: 'What are you doing right now?' }],
        draft: completeDraft,
      },
      { signedPlan: true, lifecycle: 'ACTIVE' },
    );

    expect(result.reply).toContain('still watching verified providers');
    const modelInput = JSON.parse(openAi.run.mock.calls[0]?.[1] as string) as {
      conversationContext: { signedPlan: boolean; lifecycle: string };
    };
    expect(modelInput.conversationContext).toMatchObject({ signedPlan: true, lifecycle: 'ACTIVE' });
  });

  it('tells the model what is still missing and enforces the next question in code', async () => {
    // The model answered a side question but forgot to ask anything.
    openAi.run.mockResolvedValue({
      finalOutput: modelOutput('Prices are checked against live providers.', emptyDraft, false),
    });

    const result = await service().interpret({
      messages: [
        { role: 'user', content: 'I need a flight from Caracas to Madrid. Are prices real?' },
      ],
      draft: null,
    });

    const modelInput = JSON.parse(openAi.run.mock.calls[0]?.[1] as string) as {
      state: { missingFields: string[]; nextField: string; nextQuestion: string };
    };
    expect(modelInput.state.missingFields[0]).toBe('departureDates');
    expect(modelInput.state.nextField).toBe('departureDates');
    expect(modelInput.state.nextQuestion).toContain('departure date');
    expect(result.reply).toBe(
      'Prices are checked against live providers. What departure date or date range should I search?',
    );
    expect(result.missingFields[0]).toBe('departureDates');
  });

  it('returns a retryable error instead of pretending a fallback was an AI reply', async () => {
    openAi.run.mockRejectedValue(new Error('upstream unavailable'));

    await expect(
      service().interpret({
        messages: [{ role: 'user', content: 'Help me plan a trip.' }],
        draft: null,
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'CHAT_MODEL_UNAVAILABLE',
      message: 'Aria could not reply right now. Please try again.',
    });
  });
});
