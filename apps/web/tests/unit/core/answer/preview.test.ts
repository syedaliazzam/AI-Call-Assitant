/**
 * Tests: apps/web/src/core/answer/preview.ts. A preview is asked for once per combination of
 * settings; a failure is not kept; storage being unavailable does not break it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerPreviewRequest } from '@kite/shared';
import { keptPreview, loadPreview, previewKey } from '@/core/answer/preview';

const REQUEST: AnswerPreviewRequest = {
  style: { format: 'bullets', length: 'short', tone: 'simple' },
  question: 'general',
};

/**
 * A fetch that answers with a preview.
 *
 * @returns The fake.
 */
const answering = () =>
  vi.fn(async () => Response.json({ text: 'I like this role.' })) as unknown as typeof fetch;

const store = new Map<string, string>();

/**
 * Puts a stand-in for localStorage in place.
 *
 * @param available False for storage that refuses every use (a private window).
 */
function installStorage(available = true) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        if (!available) throw new Error('blocked');
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (!available) throw new Error('blocked');
        store.set(key, value);
      },
    },
  });
}

beforeEach(() => {
  store.clear();
  installStorage();
});

describe('loadPreview', () => {
  it('asks once, then uses what it kept', async () => {
    const fetchImpl = answering();
    expect(await loadPreview(REQUEST, fetchImpl)).toEqual({ ok: true, text: 'I like this role.' });
    expect(await loadPreview(REQUEST, fetchImpl)).toEqual({ ok: true, text: 'I like this role.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(keptPreview(REQUEST)).toBe('I like this role.');
  });

  it('asks again for different settings, language or question', async () => {
    const fetchImpl = answering();
    await loadPreview(REQUEST, fetchImpl);
    await loadPreview({ ...REQUEST, style: { ...REQUEST.style, tone: 'technical' } }, fetchImpl);
    await loadPreview({ ...REQUEST, language: 'French' }, fetchImpl);
    await loadPreview({ ...REQUEST, question: 'technical' }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('keeps nothing when the server fails', async () => {
    const failing = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    expect(await loadPreview(REQUEST, failing)).toEqual({ ok: false });
    expect(keptPreview(REQUEST)).toBeNull();
  });

  it('reports a network failure instead of throwing', async () => {
    const failing = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await loadPreview(REQUEST, failing)).toEqual({ ok: false });
  });

  it('still works when storage is unavailable', async () => {
    installStorage(false);
    expect(await loadPreview(REQUEST, answering())).toEqual({
      ok: true,
      text: 'I like this role.',
    });
    expect(keptPreview(REQUEST)).toBeNull();
  });
});

describe('previewKey', () => {
  it('treats no language as English', () => {
    expect(previewKey(REQUEST)).toContain('.en.');
  });
});
