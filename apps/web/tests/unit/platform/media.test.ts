/**
 * Tests for apps/web/src/platform/media.ts (the shared capture helpers):
 * toCaptureError() maps getDisplayMedia failures to typed CaptureErrors per platform (a closed
 * picker in a browser is 'user-cancelled'; an OS or shell refusal is 'permission-denied', with
 * macOS privacy instructions on a Mac; anything else is 'not-supported') and passes a
 * CaptureError through unchanged; stopAllTracks() stops every track; the microphone keeps echo
 * cancellation on.
 */
import { describe, expect, it } from 'vitest';
import { CaptureError } from '@/platform/errors';
import { MIC_CONSTRAINTS, stopAllTracks, toCaptureError } from '@/platform/media';
import { domError, fakeStream, fakeTrack } from './fakeMedia';

describe('toCaptureError', () => {
  it('treats a closed picker in the browser as user-cancelled', () => {
    expect(toCaptureError(domError('NotAllowedError', 'Permission denied'), 'browser').code).toBe(
      'user-cancelled',
    );
  });

  it('treats OS and shell refusals as permission-denied, with macOS instructions on a Mac', () => {
    const bySystem = toCaptureError(
      domError('NotAllowedError', 'Permission denied by system'),
      'browser',
    );
    expect(bySystem.code).toBe('permission-denied');
    const shell = toCaptureError(domError('AbortError'), 'desktop', 'mac');
    expect(shell.code).toBe('permission-denied');
    expect(shell.message).toMatch(/Privacy & Security/);
    expect(toCaptureError(domError('NotAllowedError'), 'desktop', 'windows').code).toBe(
      'permission-denied',
    );
  });

  it('treats anything else as not-supported, and keeps a CaptureError as it is', () => {
    expect(toCaptureError(domError('NotSupportedError'), 'browser').code).toBe('not-supported');
    expect(toCaptureError('weird', 'browser').code).toBe('not-supported');
    const original = new CaptureError('no-audio-track', 'x');
    expect(toCaptureError(original, 'browser')).toBe(original);
  });
});

describe('stopAllTracks', () => {
  it('stops every track of a stream', () => {
    const tracks = [fakeTrack('audio'), fakeTrack('video')];
    stopAllTracks(fakeStream(tracks));
    expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
  });
});

describe('MIC_CONSTRAINTS', () => {
  it('keeps echo cancellation on (speakers leak into the microphone)', () => {
    expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: true });
  });
});
