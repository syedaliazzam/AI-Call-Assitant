/**
 * File: apps/desktop/src/media.ts
 * Purpose: Lets the Kite page capture the other side of the call ("Them") as system audio,
 *          with no picker: when the Kite origin calls getDisplayMedia(), the shell answers with
 *          a screen source plus system-audio loopback. Every other origin is denied.
 * Used by: src/main.ts (once the app is ready); tests/unit/media.test.ts
 * Depends on: electron (desktopCapturer, Session), src/security.ts (isAllowedUrl)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (getOtherSideStream, desktop),
 *               §7.3 (media.ts); CLAUDE.md "Desktop security"
 *
 * Official Electron 44 docs (checked 2026-10-27):
 * - session.setDisplayMediaRequestHandler: `callback(null)` denies (getDisplayMedia rejects with
 *   AbortError); `audio: 'loopback'` captures system audio. ('loopbackWithMute' would also mute
 *   the speakers, so the user could not hear the call; it is never used.)
 * - The session docs say loopback "is currently only supported on Windows"; the desktopCapturer
 *   docs (more specific) say macOS 13+ can capture system audio, and that from macOS 14.2
 *   Electron 39+ uses Apple's CoreAudio Tap API, which needs the "System Audio Recording"
 *   privacy permission and the NSAudioCaptureUsageDescription Info.plist key (added when the app
 *   is packaged, Day 6). Without that permission the audio track arrives already ended; the web
 *   adapter (apps/web/src/platform/desktop.ts) turns that into a clear error.
 * - macOS 12 and earlier cannot capture system audio at all: the shell then grants the screen
 *   without audio, and the web adapter reports "not supported" so the UI can offer the browser
 *   path (share a tab with audio).
 * The system picker option (useSystemPicker) is NOT used: Kite never shows a picker on desktop.
 *
 * The video part of the grant is required by getDisplayMedia; the page stops the video track
 * immediately (screenshots arrive on Day 5 through their own path).
 */
import { desktopCapturer, type Session } from 'electron';
import { isAllowedUrl } from './security';

/** What decideDisplayMedia() looks at (the parts of Electron's request it needs). */
export interface DisplayMediaQuery {
  /** Origin of the page (or frame) that called getDisplayMedia. */
  securityOrigin: string;
  /** True if the page asked for video (getDisplayMedia always does in Chromium). */
  videoRequested: boolean;
  /** True if the page asked for audio. */
  audioRequested: boolean;
}

/** The shell's answer to a getDisplayMedia request. */
export type DisplayMediaDecision =
  | {
      /** Refuse: getDisplayMedia rejects with AbortError. */
      kind: 'deny';
      /** Why (for the log; never page content). */
      reason: 'other-origin' | 'no-video';
    }
  | {
      /** Grant a screen source, with system audio when this OS supports it. */
      kind: 'grant';
      /** 'loopback' = system audio; null = no audio (OS cannot capture it). */
      audio: 'loopback' | null;
    };

/**
 * Tells whether this OS can capture system audio for the page (Electron 44 docs).
 *
 * @param platform  process.platform.
 * @param osVersion process.getSystemVersion(), for example '14.2.1' or '10.0.26200'.
 * @returns True on Windows and on macOS 13 or newer.
 * Called from: decideDisplayMedia(); tests
 */
export function canCaptureSystemAudio(platform: NodeJS.Platform, osVersion: string): boolean {
  if (platform === 'win32') return true;
  if (platform === 'darwin') {
    const major = Number.parseInt(osVersion.split('.')[0] ?? '', 10);
    return Number.isFinite(major) && major >= 13;
  }
  // Linux is not a Kite desktop target (architecture §4).
  return false;
}

/**
 * Decides a getDisplayMedia request. Only the Kite origin is answered, and only when it asks
 * for video (Chromium requires video for getDisplayMedia; audio alone is never granted).
 *
 * @param query         The request.
 * @param allowedOrigins The Kite origins.
 * @param platform      process.platform.
 * @param osVersion     process.getSystemVersion().
 * @returns Deny, or grant with or without system audio.
 * Called from: allowSystemAudioLoopback()
 */
export function decideDisplayMedia(
  query: DisplayMediaQuery,
  allowedOrigins: readonly string[],
  platform: NodeJS.Platform,
  osVersion: string,
): DisplayMediaDecision {
  if (!isAllowedUrl(query.securityOrigin, allowedOrigins)) {
    return { kind: 'deny', reason: 'other-origin' };
  }
  if (!query.videoRequested) return { kind: 'deny', reason: 'no-video' };
  const audio = query.audioRequested && canCaptureSystemAudio(platform, osVersion);
  return { kind: 'grant', audio: audio ? 'loopback' : null };
}

/** Things allowSystemAudioLoopback() uses from Electron and Node (injectable for tests). */
export interface LoopbackDeps {
  /** desktopCapturer.getSources. */
  getSources: typeof desktopCapturer.getSources;
  /** process.platform. */
  platform: NodeJS.Platform;
  /** process.getSystemVersion(). */
  osVersion: string;
}

/**
 * Installs the getDisplayMedia handler on a session: the Kite origin gets the primary screen as
 * the video source plus system-audio loopback, with no picker; anything else is denied.
 *
 * @param session       The session the Kite window uses (the default session).
 * @param allowedOrigins The Kite origins.
 * @param deps          Electron/Node functions (tests only).
 * Called from: start() in src/main.ts, once the app is ready
 */
export function allowSystemAudioLoopback(
  session: Session,
  allowedOrigins: readonly string[],
  deps: LoopbackDeps = {
    getSources: (options) => desktopCapturer.getSources(options),
    platform: process.platform,
    osVersion: process.getSystemVersion(),
  },
): void {
  session.setDisplayMediaRequestHandler((request, callback) => {
    const decision = decideDisplayMedia(request, allowedOrigins, deps.platform, deps.osVersion);
    if (decision.kind === 'deny') {
      console.warn('desktop: denied a screen/system-audio request', { reason: decision.reason });
      callback(null);
      return;
    }
    // No thumbnails: only the source id is needed, and thumbnails cost a screen capture each.
    deps.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(
      (sources) => {
        const screen = sources[0];
        if (!screen) {
          // For example macOS without the Screen Recording permission.
          console.warn('desktop: no screen source available for getDisplayMedia');
          callback(null);
          return;
        }
        callback(decision.audio ? { video: screen, audio: decision.audio } : { video: screen });
      },
      (error: unknown) => {
        console.warn('desktop: could not list screen sources', {
          error: error instanceof Error ? error.message : String(error),
        });
        callback(null);
      },
    );
  });
}
