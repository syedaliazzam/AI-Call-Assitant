/**
 * Test helper (not a test): fake MediaStream and MediaStreamTrack objects for the platform tests
 * in tests/unit/platform/. Tracks record stop(); streams support removeTrack().
 */
import { vi } from 'vitest';

/** A fake track. */
export interface FakeTrack {
  kind: 'audio' | 'video';
  readyState: 'live' | 'ended';
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => { displaySurface?: string };
}

/**
 * Builds a fake track.
 *
 * @param kind           'audio' or 'video'.
 * @param readyState     'live' (default) or 'ended'.
 * @param displaySurface For video tracks: 'browser', 'window' or 'monitor'.
 * @returns The track.
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
 * @returns The mock.
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
 */
export function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}
