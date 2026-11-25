/**
 * Tests apps/web/src/core/session/modelChoices.ts (ADR-0099, ADR-0102, ADR-0104): an account outside the Gemini
 * rollout sees the GPT models, Claude Haiku and Claude Sonnet; one in the rollout also sees Gemini 3.5 Flash
 * Lite, in the developer's order and words; Gemini 3.6 Flash is retired (in no list, named as Claude Haiku, always
 * off); "Recommended" is on Claude Haiku (ADR-0104); every model has one name for every account; and a choice
 * is off when its switch, key or rollout says so. ADR-0121: Groq is hidden: in no list, named as Claude Haiku,
 * always off.
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
      ['fast', 'Claude Haiku (Recommended)'],
      ['smart', 'Claude Sonnet'],
    ]);
  });

  it("lists the rollout's five models in the developer's order and words, without Gemini 3.6 Flash (ADR-0104)", () => {
    expect(modelChoices(true)).toBe(ROLLOUT_MODEL_CHOICES);
    expect(ROLLOUT_MODEL_CHOICES.map((choice) => [choice.value, choice.label])).toEqual([
      ['gemini-lite', 'Gemini 3.5 Flash Lite'],
      ['gpt-luna', 'GPT-5.6 Luna (Fast)'],
      ['gpt-terra', 'GPT-5.6 Terra'],
      ['fast', 'Claude Haiku (Recommended)'],
      ['smart', 'Claude Sonnet'],
    ]);
  });
});

describe('modelEntry', () => {
  it('names every model the same for every account (ADR-0102)', () => {
    expect(modelEntry('gemini-lite').title).toBe('Gemini 3.5 Flash Lite');
    expect(modelEntry('gpt-luna').name).toBe('Luna');
    expect(modelEntry('fast').name).toBe('Haiku');
  });

  it('names a session still set to the retired Gemini 3.6 Flash as Claude Haiku (ADR-0104)', () => {
    expect(modelEntry('gemini-flash').name).toBe('Haiku');
  });

  it('ADR-0121: names a session still set to the hidden Groq as Claude Haiku', () => {
    expect(modelEntry('groq').name).toBe('Haiku');
  });
});

describe('modelOff', () => {
  it('follows each switch: Smart, Groq, Gemini and OpenAI apart', () => {
    const all = { smart: true, groq: true, moreModels: true, gemini: true, openai: true };
    expect(modelOff('fast', { ...DEFAULT_MODEL_ACCESS, smart: false })).toBe(false);
    expect(modelOff('smart', { ...all, smart: false })).toBe(true);
    expect(modelOff('groq', { ...all, groq: false })).toBe(true);
    // ADR-0121: hidden, so off even with its switch on.
    expect(modelOff('groq', all)).toBe(true);
    expect(modelOff('gemini-lite', { ...all, gemini: false })).toBe(true);
    // ADR-0104: retired, so off even with every switch on.
    expect(modelOff('gemini-flash', all)).toBe(true);
    expect(modelOff('gpt-terra', { ...all, openai: false })).toBe(true);
    expect(modelOff('gpt-luna', all)).toBe(false);
    // Until the server answers, every third-party model is off.
    expect(modelOff('gemini-lite', DEFAULT_MODEL_ACCESS)).toBe(true);
  });
});
