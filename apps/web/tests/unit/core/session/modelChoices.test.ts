/**
 * Tests apps/web/src/core/session/modelChoices.ts (ADR-0099, ADR-0102): an account outside the Gemini rollout
 * sees the GPT models, Claude Haiku, Claude Sonnet and Groq; one in the rollout sees all seven in the
 * developer's order and words; every model has one name for every account; and a choice is off when its
 * switch, key or rollout says so.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ACCESS } from '@/core/session/modelAccess';
import {
  modelChoices,
  modelEntry,
  modelOff,
  ROLLOUT_MODEL_CHOICES,
  STANDARD_MODEL_CHOICES,
} from '@/core/session/modelChoices';

describe('modelChoices', () => {
  it('shows everyone outside the Gemini rollout the same list without the Gemini rows (ADR-0102)', () => {
    expect(modelChoices(false)).toBe(STANDARD_MODEL_CHOICES);
    expect(STANDARD_MODEL_CHOICES.map((choice) => [choice.value, choice.label])).toEqual([
      ['gpt-luna', 'GPT-5.6 Luna (Fast)'],
      ['gpt-terra', 'GPT-5.6 Terra'],
      ['fast', 'Claude Haiku'],
      ['smart', 'Claude Sonnet'],
      ['groq', 'Groq (Fastest)'],
    ]);
  });

  it("lists the rollout's seven models in the developer's order and words", () => {
    expect(modelChoices(true)).toBe(ROLLOUT_MODEL_CHOICES);
    expect(ROLLOUT_MODEL_CHOICES.map((choice) => [choice.value, choice.label])).toEqual([
      ['gemini-lite', 'Gemini 3.5 Flash Lite (Recommended)'],
      ['gpt-luna', 'GPT-5.6 Luna (Fast)'],
      ['gemini-flash', 'Gemini 3.6 Flash'],
      ['gpt-terra', 'GPT-5.6 Terra'],
      ['fast', 'Claude Haiku'],
      ['smart', 'Claude Sonnet'],
      ['groq', 'Groq (Fastest)'],
    ]);
  });
});

describe('modelEntry', () => {
  it('names every model the same for every account (ADR-0102)', () => {
    expect(modelEntry('gemini-lite').title).toBe('Gemini 3.5 Flash Lite');
    expect(modelEntry('gpt-luna').name).toBe('Luna');
    expect(modelEntry('fast').name).toBe('Haiku');
    expect(modelEntry('groq').label).toBe('Groq (Fastest)');
  });
});

describe('modelOff', () => {
  it('follows each switch: Smart, Groq, Gemini and OpenAI apart', () => {
    const all = { smart: true, groq: true, moreModels: true, gemini: true, openai: true };
    expect(modelOff('fast', { ...DEFAULT_MODEL_ACCESS, smart: false })).toBe(false);
    expect(modelOff('smart', { ...all, smart: false })).toBe(true);
    expect(modelOff('groq', { ...all, groq: false })).toBe(true);
    expect(modelOff('gemini-lite', { ...all, gemini: false })).toBe(true);
    expect(modelOff('gemini-flash', { ...all, gemini: false })).toBe(true);
    expect(modelOff('gpt-terra', { ...all, openai: false })).toBe(true);
    expect(modelOff('gpt-luna', all)).toBe(false);
    // Until the server answers, every third-party model is off.
    expect(modelOff('gemini-lite', DEFAULT_MODEL_ACCESS)).toBe(true);
  });
});
