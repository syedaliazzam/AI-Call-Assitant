/**
 * File: apps/web/tests/unit/platform/fakeMedia.ts
 * Purpose: Test helper (not a test): fake MediaStream and MediaStreamTrack objects, so the
 *          platform adapters can be tested in Node without a browser. Tracks record stop();
 *          streams support removeTrack().
 * Used by: tests/unit/platform/browser.test.ts, desktop.test.ts, media.test.ts
 * Depends on: vitest (vi.fn)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (platform adapter), §11
 */
import { vi } from 'vitest';

/** A fake track. */
export interface FakeTrack {
  /** Audio or video, like MediaStreamTrack.kind. */
  kind: 'audio' | 'video';
  /** 'ended' simulates a track the browser or OS has already stopped. */
  readyState: 'live' | 'ended';
  /** Records calls, so a test can check the adapter released the track. */
  stop: ReturnType<typeof vi.fn>;
  /** What was shared (for example 'browser' for a tab), as the real track reports it. */
  getSettings: () => { displaySurface?: string };
}

/**
 * Builds a fake track.
 *
 * @param kind           'audio' or 'video'.
 * @param readyState     'live' (default) or 'ended'.
 * @param displaySurface For video tracks: 'browser', 'window' or 'monitor'.
 * @returns The track.
 * Called from: tests/unit/platform/*.test.ts, fakeStream() callers
 */
export function fakeTrack(
  kind: 'audio' | 'video',
  readyState: 'live' | 'ended' = 'live',
  displaySurface?: string,
): FakeTrack {
  const track: FakeTrack = {
    kind,
    readyState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
    getSettings: () => (displaySurface ? { displaySurface } : {}),
  };
  return track;
}

/**
 * Builds a fake stream holding the given tracks.
 *
 * @param tracks The tracks.
 * @returns A MediaStream-shaped object.
 * Called from: tests/unit/platform/*.test.ts
 */
export function fakeStream(tracks: FakeTrack[]): MediaStream {
  const list = [...tracks];
  return {
    getTracks: () => [...list],
    getAudioTracks: () => list.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => list.filter((t) => t.kind === 'video'),
    removeTrack: (track: FakeTrack) => {
      const index = list.indexOf(track);
      if (index >= 0) list.splice(index, 1);
    },
  } as unknown as MediaStream;
}

/**
 * Stubs navigator.mediaDevices.getDisplayMedia.
 *
 * @param impl What getDisplayMedia does.
 * @returns The mock (a vi.fn), so a test can check how it was called.
 * Called from: tests/unit/platform/browser.test.ts, desktop.test.ts, media.test.ts
 */
export function stubDisplayMedia(impl: () => Promise<MediaStream>) {
  const getDisplayMedia = vi.fn(impl);
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia, getUserMedia: vi.fn() } });
  return getDisplayMedia;
}

/**
 * A DOMException-like error with a name (what getDisplayMedia rejects with).
 *
 * @param name    For example 'NotAllowedError'.
 * @param message The browser's message.
 * @returns The error.
 * Called from: tests/unit/platform/browser.test.ts, desktop.test.ts, media.test.ts
 */
export function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}
