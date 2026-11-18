/**
 * Tests apps/web/src/server/modelAccess.ts (spec §6), with the database mocked: the deeper model is on
 * until an admin turns it off, the setting is cached, a database failure does not stop answers, and a
 * session set to the deeper model falls back to the fast one while it is off. ADR-0095: Groq's switch works
 * the same way, and Groq is off whatever it says when the server has no Groq key. ADR-0099: Gemini and OpenAI
 * have a switch each, are on only for the accounts in KITE_ANSWER_MODELS_USERS with the provider's key, and
 * allowedModel() falls back to the fast model for any model that is off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The rows the mocked database answers with. */
const rows = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

/** ADR-0095: whether the server has a Groq key. */
const groqKey = vi.hoisted(() => ({ set: true }));
/** ADR-0099: whether the server has the Gemini and OpenAI keys. */
const providerKeys = vi.hoisted(() => ({ gemini: true, openai: true }));
vi.mock('@/server/env', () => ({
  getGroqEnv: () => (groqKey.set ? { apiKey: 'k', model: 'm' } : null),
  getGeminiEnv: () =>
    providerKeys.gemini ? { apiKey: 'k', modelFast: 'f', modelSmart: 's' } : null,
  getOpenAIEnv: () =>
    providerKeys.openai ? { apiKey: 'k', modelFast: 'f', modelSmart: 's' } : null,
}));

vi.mock('@/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: rows.select }) }),
    insert: () => ({ values: rows.insert }),
  },
}));

import {
  allowedModel,
  allowedTier,
  getDeepModelEnabled,
  getProviderEnabled,
  getProviderSwitch,
  moreModelsFor,
  setProviderEnabled,
  getGroqEnabled,
  getGroqSwitch,
  parseDeepModelEnabled,
  resetModelAccessCache,
  setDeepModelEnabled,
  setGroqEnabled,
} from '@/server/modelAccess';

beforeEach(() => {
  groqKey.set = true;
  providerKeys.gemini = true;
  providerKeys.openai = true;
  vi.unstubAllEnvs();
  resetModelAccessCache();
  rows.select.mockReset();
  rows.insert.mockReset();
});

describe('parseDeepModelEnabled', () => {
  it('is on unless an admin turned it off', () => {
    expect(parseDeepModelEnabled(undefined)).toBe(true);
    expect(parseDeepModelEnabled('true')).toBe(true);
    expect(parseDeepModelEnabled('false')).toBe(false);
  });
});

describe('allowedTier', () => {
  it('falls back to the fast model only for the deeper one while it is off', () => {
    expect(allowedTier('smart', false)).toBe('fast');
    expect(allowedTier('smart', true)).toBe('smart');
    expect(allowedTier('fast', false)).toBe('fast');
    expect(allowedTier('fast', true)).toBe('fast');
  });
});

describe('getDeepModelEnabled', () => {
  it('reads the setting, then answers from memory for a minute', async () => {
    rows.select.mockResolvedValue([{ value: 'false' }]);
    expect(await getDeepModelEnabled(1_000)).toBe(false);
    expect(await getDeepModelEnabled(30_000)).toBe(false);
    expect(rows.select).toHaveBeenCalledTimes(1);
    rows.select.mockResolvedValue([]);
    expect(await getDeepModelEnabled(62_000)).toBe(true);
    expect(rows.select).toHaveBeenCalledTimes(2);
  });

  it('does not stop answers when the database cannot be reached', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rows.select.mockRejectedValue(new Error('down'));
    expect(await getDeepModelEnabled(1_000)).toBe(true);
  });

  it('keeps the last known state when a later read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rows.select.mockResolvedValueOnce([{ value: 'false' }]);
    expect(await getDeepModelEnabled(1_000)).toBe(false);
    rows.select.mockRejectedValue(new Error('down'));
    expect(await getDeepModelEnabled(120_000)).toBe(false);
  });
});

describe('setDeepModelEnabled', () => {
  it('saves the change and applies it here at once', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    rows.insert.mockReturnValue({ onConflictDoUpdate });
    await setDeepModelEnabled(false);
    expect(rows.insert).toHaveBeenCalledWith({ key: 'deep_model_enabled', value: 'false' });
    expect(await getDeepModelEnabled()).toBe(false);
    expect(rows.select).not.toHaveBeenCalled();
  });
});

describe('Groq (ADR-0095)', () => {
  it('falls back to the fast model while Groq is off, and never gives Groq to an older caller', () => {
    expect(allowedTier('groq', true, false)).toBe('fast');
    expect(allowedTier('groq', true, true)).toBe('groq');
    expect(allowedTier('groq', true)).toBe('fast');
    expect(allowedTier('smart', false, true)).toBe('fast');
  });

  it('is on when the server has a key and no admin turned it off', async () => {
    rows.select.mockResolvedValue([]);
    expect(await getGroqEnabled(1_000)).toBe(true);
    resetModelAccessCache();
    rows.select.mockResolvedValue([{ value: 'false' }]);
    expect(await getGroqEnabled(1_000)).toBe(false);
  });

  it('is off without a key, and then reads no setting', async () => {
    groqKey.set = false;
    expect(await getGroqEnabled(1_000)).toBe(false);
    expect(rows.select).not.toHaveBeenCalled();
    // The Usage page still shows the stored switch.
    rows.select.mockResolvedValue([]);
    expect(await getGroqSwitch(1_000)).toBe(true);
  });

  it('keeps its own switch, apart from the deeper model', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    rows.insert.mockReturnValue({ onConflictDoUpdate });
    await setGroqEnabled(false);
    expect(rows.insert).toHaveBeenCalledWith({ key: 'groq_model_enabled', value: 'false' });
    expect(await getGroqEnabled()).toBe(false);
    rows.select.mockResolvedValue([]);
    expect(await getDeepModelEnabled()).toBe(true);
  });
});

describe('Gemini and OpenAI (ADR-0099)', () => {
  it('reads the rollout list: ids, or * for everyone; unset means no one', () => {
    expect(moreModelsFor('u1', {})).toBe(false);
    expect(moreModelsFor('u1', { KITE_ANSWER_MODELS_USERS: 'u2, u1' })).toBe(true);
    expect(moreModelsFor('u3', { KITE_ANSWER_MODELS_USERS: 'u2,u1' })).toBe(false);
    expect(moreModelsFor('anyone', { KITE_ANSWER_MODELS_USERS: '*' })).toBe(true);
  });

  it('is on only in the rollout, with a key, and while the switch is on', async () => {
    vi.stubEnv('KITE_ANSWER_MODELS_USERS', 'u1');
    rows.select.mockResolvedValue([]);
    expect(await getProviderEnabled('gemini', 'u1', 1_000)).toBe(true);
    // Outside the rollout: Gemini off, and no setting is read.
    rows.select.mockClear();
    expect(await getProviderEnabled('gemini', 'u2', 1_000)).toBe(false);
    expect(rows.select).not.toHaveBeenCalled();
    // ADR-0102: OpenAI is on for an account outside the rollout too (key set, switch on).
    expect(await getProviderEnabled('openai', 'u2', 1_000)).toBe(true);
    vi.stubEnv('KITE_ANSWER_MODELS_USERS', '');
    expect(await getProviderEnabled('openai', 'u3', 1_000)).toBe(true);
    rows.select.mockClear();
    // No key: off, and no setting is read.
    providerKeys.openai = false;
    expect(await getProviderEnabled('openai', 'u1', 1_000)).toBe(false);
    expect(rows.select).not.toHaveBeenCalled();
  });

  it('keeps a switch per provider, apart from the others', async () => {
    vi.stubEnv('KITE_ANSWER_MODELS_USERS', 'u1');
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    rows.insert.mockReturnValue({ onConflictDoUpdate });
    await setProviderEnabled('openai', false);
    expect(rows.insert).toHaveBeenCalledWith({ key: 'openai_model_enabled', value: 'false' });
    expect(await getProviderEnabled('openai', 'u1')).toBe(false);
    rows.select.mockResolvedValue([]);
    expect(await getProviderSwitch('gemini')).toBe(true);
    expect(await getGroqSwitch()).toBe(true);
  });

  it('falls back to the fast model for any model that is off', () => {
    const allOn = { smart: true, groq: true, gemini: true, openai: true };
    expect(allowedModel('gemini-lite', allOn)).toBe('gemini-lite');
    expect(allowedModel('gpt-terra', allOn)).toBe('gpt-terra');
    expect(allowedModel('gemini-lite', { ...allOn, gemini: false })).toBe('fast');
    // ADR-0104: the retired Gemini 3.6 Flash is never used, even with every switch on.
    expect(allowedModel('gemini-flash', allOn)).toBe('fast');
    expect(allowedModel('gpt-luna', { ...allOn, openai: false })).toBe('fast');
    expect(allowedModel('groq', { ...allOn, groq: false })).toBe('fast');
    expect(allowedModel('smart', { ...allOn, smart: false })).toBe('fast');
    // The older form never gives a Gemini or GPT model.
    expect(allowedTier('gemini-lite', true, true)).toBe('fast');
  });
});
