/**
 * Tests apps/web/src/core/session/modelChoices.ts (ADR-0099): an account outside the rollout sees the classic
 * three choices exactly as before; one in the rollout sees the seven in the developer's order and words; a
 * Gemini or GPT model is always named by its own name; and a choice is off when its switch, key or rollout
 * says so.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ACCESS } from '@/core/session/modelAccess';
import {
  CLASSIC_MODEL_CHOICES,
  modelChoices,
  modelEntry,
  modelOff,
  ROLLOUT_MODEL_CHOICES,
} from '@/core/session/modelChoices';

describe('modelChoices', () => {
  it('keeps the classic list for everyone outside the rollout', () => {
    expect(modelChoices(false)).toBe(CLASSIC_MODEL_CHOICES);
    expect(CLASSIC_MODEL_CHOICES.map((choice) => [choice.value, choice.label, choice.tag])).toEqual(
      [
        ['fast', 'Fast (Claude Haiku)', 'Recommended'],
        ['smart', 'Smart (Claude Sonnet)', 'Deeper, slower'],
        ['groq', 'Fastest (Groq)', 'Quickest'],
      ],
    );
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
  it('names a Gemini or GPT model by its own name in either list, the others by the list in use', () => {
    expect(modelEntry('gemini-lite', false).title).toBe('Gemini 3.5 Flash Lite');
    expect(modelEntry('gpt-luna', false).name).toBe('Luna');
    expect(modelEntry('fast', false).name).toBe('Fast');
    expect(modelEntry('fast', true).name).toBe('Haiku');
    expect(modelEntry('groq', true).label).toBe('Groq (Fastest)');
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
