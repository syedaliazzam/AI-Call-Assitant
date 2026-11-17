/**
 * Tests apps/web/src/server/modelAccess.ts (spec §6), with the database mocked: the deeper model is on
 * until an admin turns it off, the setting is cached, a database failure does not stop answers, and a
 * session set to the deeper model falls back to the fast one while it is off. ADR-0095: Groq's switch works
 * the same way, and Groq is off whatever it says when the server has no Groq key.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The rows the mocked database answers with. */
const rows = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
}));

/** ADR-0095: whether the server has a Groq key. */
const groqKey = vi.hoisted(() => ({ set: true }));
vi.mock('@/server/env', () => ({
  getGroqEnv: () => (groqKey.set ? { apiKey: 'k', model: 'm' } : null),
}));

vi.mock('@/server/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: rows.select }) }),
    insert: () => ({ values: rows.insert }),
  },
}));

import {
  allowedTier,
  getDeepModelEnabled,
  getGroqEnabled,
  getGroqSwitch,
  parseDeepModelEnabled,
  resetModelAccessCache,
  setDeepModelEnabled,
  setGroqEnabled,
} from '@/server/modelAccess';

beforeEach(() => {
  groqKey.set = true;
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
