/**
 * Tests apps/web/src/server/modelAccess.ts (spec §6), with the database mocked: the deeper model is on
 * until an admin turns it off, the setting is cached, a database failure does not stop answers, and a
 * session set to the deeper model falls back to the fast one while it is off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The rows the mocked database answers with. */
const rows = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
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
  parseDeepModelEnabled,
  resetModelAccessCache,
  setDeepModelEnabled,
} from '@/server/modelAccess';

beforeEach(() => {
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
