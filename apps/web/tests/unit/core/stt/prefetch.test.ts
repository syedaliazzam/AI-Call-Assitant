/**
 * Tests for apps/web/src/core/stt/prefetch.ts (v1.3.1, ADR-0059): the desktop app's background
 * preparation of the speech model. A cached model is ready without a download; a missing one is
 * downloaded once even when start() is called again meanwhile (the launcher at open, then Connect);
 * progress reaches subscribers; a failure is reported and the next start() tries again; one prefetch
 * per origin.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DownloadProgress } from '@/core/stt/download';
import { createSpeechModelPrefetch, speechModelPrefetch } from '@/core/stt/prefetch';

const ORIGIN = 'https://kite-call-assistant.vercel.app';

/** A progress report half-way through. */
const HALF: DownloadProgress = {
  file: 'encoder-epoch-99-avg-1.int8.onnx',
  loadedBytes: 100,
  totalBytes: 200,
  fraction: 0.5,
};

describe('createSpeechModelPrefetch', () => {
  it('is ready at once when every file is cached (no download)', async () => {
    const download = vi.fn();
    const prefetch = createSpeechModelPrefetch(ORIGIN, { cached: async () => true, download });
    expect(prefetch.state()).toEqual({ kind: 'idle' });
    expect(await prefetch.start()).toBe(true);
    expect(prefetch.state()).toEqual({ kind: 'ready' });
    expect(download).not.toHaveBeenCalled();
    // Ready stays ready: no second check.
    expect(await prefetch.start()).toBe(true);
  });

  it('downloads once when started twice, and reports progress to subscribers', async () => {
    let finish: () => void = () => undefined;
    const download = vi.fn(
      (_origin: string, onProgress: (progress: DownloadProgress) => void) =>
        new Promise<void>((resolve) => {
          onProgress(HALF);
          finish = resolve;
        }),
    );
    const prefetch = createSpeechModelPrefetch(ORIGIN, { cached: async () => false, download });
    const seen: string[] = [];
    const stop = prefetch.subscribe(() => seen.push(prefetch.state().kind));
    const atOpen = prefetch.start();
    const onConnect = prefetch.start();
    await vi.waitFor(() =>
      expect(prefetch.state()).toEqual({ kind: 'downloading', progress: HALF }),
    );
    finish();
    expect(await atOpen).toBe(true);
    expect(await onConnect).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['checking', 'downloading', 'downloading', 'ready']);
    stop();
  });

  it('reports a failed download, and tries again on the next start', async () => {
    const download = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const prefetch = createSpeechModelPrefetch(ORIGIN, { cached: async () => false, download });
    expect(await prefetch.start()).toBe(false);
    expect(prefetch.state()).toEqual({ kind: 'failed' });
    expect(await prefetch.start()).toBe(true);
    expect(prefetch.state()).toEqual({ kind: 'ready' });
    expect(download).toHaveBeenCalledTimes(2);
  });
});

describe('speechModelPrefetch', () => {
  it('keeps one prefetch per origin', () => {
    expect(speechModelPrefetch(ORIGIN)).toBe(speechModelPrefetch(ORIGIN));
    expect(speechModelPrefetch('http://localhost:3000')).not.toBe(speechModelPrefetch(ORIGIN));
  });
});
