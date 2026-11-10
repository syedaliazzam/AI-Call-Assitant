/**
 * File: apps/web/src/core/recording/format.ts
 * Purpose: Chooses how a recording is encoded (desktop 1.5.0, ADR-0068): hardware H.264 in Matroska when
 *          this computer has an H.264 encoder (measured: 0.15 of a core at 720p15 or 1080p30), otherwise
 *          VP8 in WebM at 720p15 only ("High" is hidden: VP8 at 1080p30 took 1.2 cores); a sound-only
 *          recording is Opus in WebM. All are written piece by piece, so a crash keeps what was recorded.
 * Used by: src/core/recording/recorder.ts, src/features/settings/RecordingSetting.tsx
 * Depends on: @kite/shared (RECORDING_QUALITIES, the recording types), the browser's MediaRecorder and
 *             VideoEncoder (injectable)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; benchmark-results.md (recording)
 */
import {
  RECORDING_QUALITIES,
  type RecordingContainer,
  type RecordingKind,
  type RecordingQuality,
  type RecordingQualitySpec,
} from '@kite/shared';

/** The MIME type of the stereo sound file. */
export const STEREO_MIME = 'audio/webm;codecs=opus';

/** How a recording is encoded. */
export interface RecordingFormat {
  /** MediaRecorder's mimeType for the main file. */
  mimeType: string;
  /** The main file's container. */
  container: RecordingContainer;
  /** The quality used (Standard where High is not offered), or null for sound only. */
  quality: RecordingQuality | null;
  /** Its size, frame rate and bitrate, or null for sound only. */
  spec: RecordingQualitySpec | null;
}

/** What chooseFormat() checks (the browser's own by default). */
export interface FormatDeps {
  /** MediaRecorder.isTypeSupported. */
  isTypeSupported: (mimeType: string) => boolean;
  /** Whether this computer has a hardware H.264 encoder. */
  hardwareH264: () => Promise<boolean>;
}

/**
 * Whether this computer has a hardware H.264 encoder, by WebCodecs (Chromium answers false for
 * 'prefer-hardware' when only the software encoder exists; measured: true for H.264, false for VP8,
 * VP9 and AV1 on the test laptop).
 *
 * @returns True when one is there.
 * Called from: defaultFormatDeps(); RecordingSetting.tsx (hides High without one)
 */
export async function hasHardwareH264(): Promise<boolean> {
  const encoder = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (!encoder?.isConfigSupported) return false;
  try {
    const result = await encoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: 1280,
      height: 720,
      framerate: 15,
      bitrate: RECORDING_QUALITIES.standard.videoBitsPerSecond,
      hardwareAcceleration: 'prefer-hardware',
      avc: { format: 'annexb' },
    });
    return result.supported === true;
  } catch {
    return false;
  }
}

/**
 * The browser's own checks.
 * @returns Default dependencies.
 * Called from: chooseFormat() (default argument)
 */
export function defaultFormatDeps(): FormatDeps {
  return {
    isTypeSupported: (mimeType) =>
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mimeType),
    hardwareH264: hasHardwareH264,
  };
}

/**
 * Chooses the encoding for a recording.
 *
 * @param kind    Screen and sound, or sound only.
 * @param wanted  The quality the person chose.
 * @param deps    The checks (tests pass fakes).
 * @returns The encoding, or null when this browser can record none of them.
 * Called from: recorder.ts startRecording(); tests
 */
export async function chooseFormat(
  kind: RecordingKind,
  wanted: RecordingQuality,
  deps: FormatDeps = defaultFormatDeps(),
): Promise<RecordingFormat | null> {
  if (kind === 'audio') {
    return deps.isTypeSupported(STEREO_MIME)
      ? { mimeType: STEREO_MIME, container: 'webm', quality: null, spec: null }
      : null;
  }
  if (await deps.hardwareH264()) {
    // Baseline profile for 720p; High profile, level 4.0, for 1080p30.
    const mimeType =
      wanted === 'high'
        ? 'video/x-matroska;codecs=avc1.640028,opus'
        : 'video/x-matroska;codecs=avc1.42E01F,opus';
    if (deps.isTypeSupported(mimeType)) {
      return { mimeType, container: 'mkv', quality: wanted, spec: RECORDING_QUALITIES[wanted] };
    }
  }
  const vp8 = 'video/webm;codecs=vp8,opus';
  return deps.isTypeSupported(vp8)
    ? {
        mimeType: vp8,
        container: 'webm',
        quality: 'standard',
        spec: RECORDING_QUALITIES.standard,
      }
    : null;
}
