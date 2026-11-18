/**
 * Tests apps/web/src/core/session/retireModels.ts (ADR-0101, ADR-0104), with storage faked: while Groq is off,
 * every session and the defaults set to it move to Claude Haiku ('fast'); others are untouched; while Groq is on,
 * Groq stays; a retired model (Gemini 3.6 Flash) always moves.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  moveOffUnavailableModels,
  mustMoveToHaiku,
  type RetireDeps,
} from '@/core/session/retireModels';
import type { Session, SessionDefaults } from '@/core/storage/types';

/**
 * A session with a model.
 *
 * @param id    Its id.
 * @param model Its model.
 * @returns The session (only the fields read).
 */
function session(id: string, model: Session['preferences']['model']): Session {
  return { id, preferences: { model } } as unknown as Session;
}

/**
 * Fake storage with these sessions and defaults.
 *
 * @param sessions The sessions.
 * @param defaults The defaults.
 * @returns The fakes.
 */
function storage(sessions: Session[], defaults: Partial<SessionDefaults>) {
  const deps = {
    listSessions: vi.fn(async () => sessions),
    updateSessionPreferences: vi.fn(async () => sessions[0]!),
    getSessionDefaults: vi.fn(async () => defaults as SessionDefaults),
    saveSessionDefaults: vi.fn(async () => undefined),
  };
  return deps as typeof deps & RetireDeps;
}

describe('moveOffUnavailableModels', () => {
  it('moves Groq sessions and defaults to Claude Haiku while Groq is off', async () => {
    const deps = storage([session('a', 'groq'), session('b', 'smart'), session('c', 'groq')], {
      model: 'groq',
    });
    expect(await moveOffUnavailableModels({ groq: false }, deps)).toEqual({
      sessions: 2,
      defaults: true,
    });
    expect(deps.updateSessionPreferences).toHaveBeenCalledWith('a', { model: 'fast' });
    expect(deps.updateSessionPreferences).toHaveBeenCalledWith('c', { model: 'fast' });
    expect(deps.updateSessionPreferences).not.toHaveBeenCalledWith('b', expect.anything());
    expect(deps.saveSessionDefaults).toHaveBeenCalledWith({ model: 'fast' });
  });

  it('changes nothing while Groq is on, or when nothing is set to it', async () => {
    const on = storage([session('a', 'groq')], { model: 'groq' });
    expect(await moveOffUnavailableModels({ groq: true }, on)).toEqual({
      sessions: 0,
      defaults: false,
    });
    expect(on.updateSessionPreferences).not.toHaveBeenCalled();
    expect(on.saveSessionDefaults).not.toHaveBeenCalled();
    const none = storage([session('a', 'fast')], { model: 'smart' });
    expect(await moveOffUnavailableModels({ groq: false }, none)).toEqual({
      sessions: 0,
      defaults: false,
    });
    expect(none.saveSessionDefaults).not.toHaveBeenCalled();
  });

  it('always moves sessions and defaults set to the retired Gemini 3.6 Flash (ADR-0104)', async () => {
    const deps = storage([session('a', 'gemini-flash'), session('b', 'gemini-lite')], {
      model: 'gemini-flash',
    });
    expect(await moveOffUnavailableModels({ groq: true }, deps)).toEqual({
      sessions: 1,
      defaults: true,
    });
    expect(deps.updateSessionPreferences).toHaveBeenCalledWith('a', { model: 'fast' });
    expect(deps.updateSessionPreferences).not.toHaveBeenCalledWith('b', expect.anything());
    expect(deps.saveSessionDefaults).toHaveBeenCalledWith({ model: 'fast' });
  });
});

describe('mustMoveToHaiku', () => {
  it('moves Groq only while it is off, a retired model always, nothing else', () => {
    expect(mustMoveToHaiku('groq', { groq: false })).toBe(true);
    expect(mustMoveToHaiku('groq', { groq: true })).toBe(false);
    expect(mustMoveToHaiku('gemini-flash', { groq: true })).toBe(true);
    expect(mustMoveToHaiku('gemini-lite', { groq: false })).toBe(false);
    expect(mustMoveToHaiku('fast', { groq: false })).toBe(false);
  });
});
