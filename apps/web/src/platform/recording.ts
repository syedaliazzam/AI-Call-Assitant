/**
 * File: apps/web/src/platform/recording.ts
 * Purpose: The desktop app's meeting recording host (1.5.0, ADR-0068): the screen's video for a
 *          recording (a video-only getDisplayMedia the shell grants with the display picked for
 *          recordings, no picker) and the bridge's file, player, display and device calls. Present only
 *          when the shell has every recording method; otherwise null and the page offers no Record option.
 * Used by: src/platform/desktop.ts
 * Depends on: @kite/shared (KiteDesktopApi, the recording contract), src/platform/media.ts,
 *             src/platform/errors.ts, src/platform/types.ts
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §3.3
 */
import type { KiteDesktopApi, RecordingQualitySpec } from '@kite/shared';
import { requestDisplayMedia, stopAllTracks } from './media';
import { CaptureError } from './errors';
import type { RecordingHost } from './types';

/**
 * Asks for a video-only capture of the screen at most the quality's size and frame rate. The shell
 * answers a request without audio with the display picked for recordings.
 *
 * @param quality The largest size and frame rate.
 * @param os      The desktop OS (for the error messages).
 * @returns A stream with one live video track.
 * @throws CaptureError when the screen cannot be captured.
 * Called from: desktopRecordingHost().openScreen(); tests
 */
export async function openRecordingScreen(
  quality: RecordingQualitySpec,
  os?: string,
): Promise<MediaStream> {
  const limits = {
    width: { max: quality.width },
    height: { max: quality.height },
    frameRate: { max: quality.frameRate },
  };
  const stream = await requestDisplayMedia({ video: limits, audio: false }, 'desktop', os);
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') {
    stopAllTracks(stream);
    throw new CaptureError('failed', 'Paramount AI could not capture the screen to record it.');
  }
  // Chromium usually applies the limits at once; if not, they are applied now (scaled down, never up).
  const settings = track.getSettings();
  if (
    (settings.width ?? 0) > quality.width ||
    (settings.height ?? 0) > quality.height ||
    (settings.frameRate ?? 0) > quality.frameRate
  ) {
    await track.applyConstraints(limits).catch(() => undefined);
  }
  return stream;
}

/**
 * The recording host over the bridge, or null when this shell cannot record (before 1.5.0).
 *
 * @param bridge The shell's bridge.
 * @returns The host, or null.
 * Called from: createDesktopPlatform() in desktop.ts; tests
 */
export function desktopRecordingHost(bridge: KiteDesktopApi): RecordingHost | null {
  const {
    recordingOpen,
    recordingWrite,
    recordingClose,
    recordingList,
    recordingPlay,
    recordingSaveAs,
    recordingShowInFolder,
    recordingDelete,
    listDisplays,
    setRecordingDisplay,
    deviceIdentity,
    renameDevice,
  } = bridge;
  if (
    !recordingOpen ||
    !recordingWrite ||
    !recordingClose ||
    !recordingList ||
    !recordingPlay ||
    !recordingSaveAs ||
    !recordingShowInFolder ||
    !recordingDelete ||
    !listDisplays ||
    !setRecordingDisplay ||
    !deviceIdentity ||
    !renameDevice
  ) {
    return null;
  }
  return {
    async openScreen(quality, displayId) {
      await setRecordingDisplay(displayId);
      return openRecordingScreen(quality, bridge.os);
    },
    open: (request) => recordingOpen(request),
    write: (id, track, bytes) => recordingWrite(id, track, bytes),
    close: (id) => recordingClose(id),
    list: () => recordingList(),
    play: (id) => recordingPlay(id),
    saveAs: (id) => recordingSaveAs(id),
    showInFolder: (id) => recordingShowInFolder(id),
    remove: (id) => recordingDelete(id),
    displays: () => listDisplays(),
    device: () => deviceIdentity(),
    renameDevice: (name) => renameDevice(name),
  };
}
