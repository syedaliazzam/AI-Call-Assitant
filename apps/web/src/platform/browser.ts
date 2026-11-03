/**
 * File: apps/web/src/platform/browser.ts
 * Purpose: The Platform implementation used when Kite runs in Chrome or Edge (no desktop app).
 *          The microphone (Day 1) and the other side through a shared tab with its audio
 *          (Day 2), the in-page hotkeys (Day 4), and (Day 5) screenshots of the shared tab, the
 *          compact view in a Document Picture-in-Picture window, and share protection reported
 *          as unsupported.
 * Used by: src/platform/index.ts (getPlatform)
 * Depends on: src/platform/types.ts, src/platform/errors.ts, src/platform/media.ts,
 *             src/platform/keymap.ts, src/platform/pip.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (browser column)
 */
import { CaptureError } from './errors';
import { listenForAskKite, listenForHotkeys } from './keymap';
import {
  openMicrophone,
  requestDisplayMedia,
  startFrameSource,
  stopAllTracks,
  type DisplayCaptureOptions,
  type FrameSource,
} from './media';
import {
  closePictureInPicture,
  openPictureInPicture,
  pictureInPicture,
  type PipRenderer,
} from './pip';
import type {
  OtherSideSource,
  OverlayMode,
  OverlayPreset,
  OverlayResizeStep,
  Platform,
} from './types';

/**
 * What the browser asks for when sharing the other side (Chrome's official screen-sharing
 * controls, checked 2026-10-27):
 * - video.displaySurface 'browser': opens the picker on the "Chrome Tab" pane, the only pane with
 *   tab audio (the meeting usually runs in a tab);
 * - audio.suppressLocalAudioPlayback false: the user keeps hearing the meeting while Kite listens;
 * - preferCurrentTab false + selfBrowserSurface 'exclude': Kite's own tab is not offered;
 * - surfaceSwitching 'include': "Share this tab instead" lets the user switch to the right tab;
 * - systemAudio 'include' and monitorTypeSurfaces 'include': on Windows, sharing the entire
 *   screen can carry system audio (for a meeting in a desktop app).
 * Video is required by getDisplayMedia; the track is kept (not shown) for Day 5 screenshots.
 */
export const BROWSER_DISPLAY_OPTIONS: DisplayCaptureOptions = {
  video: { displaySurface: 'browser' },
  audio: { suppressLocalAudioPlayback: false },
  preferCurrentTab: false,
  selfBrowserSurface: 'exclude',
  surfaceSwitching: 'include',
  systemAudio: 'include',
  monitorTypeSurfaces: 'include',
};

/** Message when the share has no sound. */
export const NO_TAB_AUDIO_MESSAGE =
  'Kite can’t hear the meeting: the share has no sound. Click Connect again, pick the meeting tab and tick “Also share tab audio” (Chrome or Edge).';

/**
 * Where the sound of a share comes from, from the video track's displaySurface setting.
 *
 * @param stream The shared stream.
 * @returns 'tab-audio' for a tab, 'screen-audio' for a screen or window (or when unknown).
 * Called from: browserPlatform.getOtherSideStream(); tests
 */
export function shareSource(stream: MediaStream): OtherSideSource {
  const settings = stream.getVideoTracks()[0]?.getSettings() as
    { displaySurface?: string } | undefined;
  return settings?.displaySurface === 'browser' ? 'tab-audio' : 'screen-audio';
}

/** The parts of navigator that isComputerBrowser() reads. */
export interface BrowserNavigator {
  /** The user agent string. */
  userAgent: string;
  /** Touch points: 0 on a Mac, more than 1 on an iPad (which reports a Mac user agent). */
  maxTouchPoints: number;
  /** Chromium's client hints, where available ("mobile" is true on phones). */
  userAgentData?: {
    /** True on a phone or tablet. */
    mobile?: boolean;
  };
  /** Media devices; getDisplayMedia is missing on phones. */
  mediaDevices?: {
    /** Screen and tab sharing. */
    getDisplayMedia?: unknown;
  };
}

/**
 * Whether this browser is on a computer that can run a live call: not a phone or tablet, and
 * with screen or tab sharing.
 *
 * @param nav The browser's navigator (tests pass their own).
 * @returns True on a Windows, macOS or Linux computer browser with getDisplayMedia.
 * Called from: browserPlatform.supportsLiveCalls(); tests
 */
export function isComputerBrowser(nav: BrowserNavigator): boolean {
  if (nav.userAgentData?.mobile) return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)) return false;
  // iPadOS reports a Mac user agent; a Mac has no touch points.
  if (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1) return false;
  return typeof nav.mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Whether the browser runs on macOS (⌘ is the shortcut modifier there).
 *
 * @returns True on a Mac.
 * Called from: browserPlatform.onHotkey(), browserPlatform.hotkeyModifier()
 */
function browserIsMac(): boolean {
  // navigator.platform is deprecated but still set everywhere; the user agent is the fallback.
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Shown when the browser has no Document Picture-in-Picture (Firefox, Safari, older browsers). */
export const NO_PIP_MESSAGE =
  'This browser cannot show a small window on top of the meeting. Use Chrome or Edge 116 or newer, or keep Kite in its own window next to the meeting.';

/** Shown when a screenshot is asked for but nothing is being shared. */
export const NO_SHARE_MESSAGE =
  'Kite can only take a screenshot of the tab or screen you are sharing for the call. Connect first, then try again.';

/**
 * The share from the latest getOtherSideStream() (its video track gives screenshots), or null
 * before the first Connect. A stopped share is detected by its track's readyState.
 */
let currentShare: MediaStream | null = null;

/** The current share's frames, ready to draw (media.ts startFrameSource()), or null. */
let frames: FrameSource | null = null;

/** Platform implementation for Chrome / Edge. */
export const browserPlatform: Platform = {
  kind: 'browser',

  // Sessions open through the Choose platform dialog (the desktop app is an alternative).
  offersPlatformChoice: true,

  /** Opens the microphone with getUserMedia (the browser asks the user for permission). */
  getMicStream: openMicrophone,

  /**
   * Opens the share picker (tab pane first). The user picks the meeting tab and ticks "Also share
   * tab audio". A share without sound is stopped and reported as 'no-audio-track'.
   *
   * @returns The shared stream and which kind of surface was shared.
   */
  async getOtherSideStream() {
    const stream = await requestDisplayMedia(BROWSER_DISPLAY_OPTIONS, 'browser');
    if (stream.getAudioTracks().length === 0) {
      // Release the share right away: without sound it is of no use.
      stopAllTracks(stream);
      throw new CaptureError('no-audio-track', NO_TAB_AUDIO_MESSAGE);
    }
    // Kept for screenshots: the share's video track is the only way to see the meeting. Its
    // frames start playing now, so a screenshot is instant later.
    frames?.close();
    currentShare = stream;
    const video = stream.getVideoTracks()[0];
    frames = video && typeof document !== 'undefined' ? startFrameSource(video) : null;
    return { stream, source: shareSource(stream) };
  },

  /**
   * A screenshot of the tab or screen the user is sharing for the call: one frame of the
   * share's video track, scaled to ≤ 1,568 px (media.ts startFrameSource()).
   *
   * @returns The frame as a PNG Blob (in memory only).
   * @throws CaptureError('no-share') when nothing is being shared (or the share ended), or
   *         'failed' when no frame could be read.
   */
  async captureScreenshot() {
    const track = currentShare?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') throw new CaptureError('no-share', NO_SHARE_MESSAGE);
    try {
      if (!frames) throw new Error('no frame source');
      return await frames.grab();
    } catch {
      throw new CaptureError(
        'failed',
        'Kite could not take a screenshot of the shared tab. Try again.',
      );
    }
  },

  /**
   * The compact view in a Document Picture-in-Picture window (Chrome / Edge 116+), opened from
   * the click on "Compact view".
   *
   * @param _sessionId The session (the renderer already knows it).
   * @param render     Renders the compact view into the window.
   * @throws CaptureError('not-supported') where the browser has no Document Picture-in-Picture.
   */
  async openCompactView(_sessionId: string, render?: PipRenderer) {
    if (!render || !pictureInPicture()) throw new CaptureError('not-supported', NO_PIP_MESSAGE);
    await openPictureInPicture(render);
  },

  /**
   * In-page keyboard shortcuts while the Kite tab has focus (architecture §7.3; ⌘ on macOS,
   * Ctrl elsewhere). A browser cannot have shortcuts that work from other apps. Day 5 adds the
   * picture-in-picture window.
   *
   * @param handler Receives each hotkey action. (No shortcut can be "taken" in a browser, so
   *                the second argument of the Platform method is not used.)
   * @returns A function that stops listening.
   */
  onHotkey(handler) {
    return listenForHotkeys(window, browserIsMac(), handler);
  },

  /**
   * The hotkeys' modifier for labels.
   *
   * @returns '⌘' on a Mac, 'Ctrl+' elsewhere.
   */
  hotkeyModifier() {
    return browserIsMac() ? '⌘' : 'Ctrl+';
  },

  /**
   * A live call needs a computer browser with screen or tab sharing.
   *
   * @returns False on phones and tablets.
   */
  supportsLiveCalls() {
    return isComputerBrowser(navigator as BrowserNavigator);
  },

  /**
   * A browser cannot hide a window from screen sharing: always unsupported (the UI explains:
   * share one tab or window, or put Kite on another monitor).
   *
   * @param _on Ignored.
   * @returns { on: false, supported: false }.
   */
  async setShareProtection(_on: boolean) {
    return { on: false, supported: false };
  },

  /**
   * Always unsupported in a browser.
   *
   * @returns { on: false, supported: false }.
   */
  async getShareProtection() {
    return { on: false, supported: false };
  },

  /**
   * Nothing to do: the browser has no updater.
   *
   * @param _active Ignored.
   */
  setCallActive(_active: boolean) {},

  /** No accurate engine in the browser (ADR-0034: the desktop app only). */
  accurate: null,

  /**
   * A picture-in-picture window cannot change its opacity or be resized by the page.
   *
   * @returns False.
   */
  overlayWindowControls() {
    return false;
  },

  /**
   * Nothing to do (see overlayWindowControls).
   *
   * @param _opacity Ignored.
   */
  setOverlayOpacity(_opacity: number) {},

  /**
   * Nothing to do to the window (see overlayWindowControls).
   *
   * @param _collapsed Ignored.
   */
  setOverlayCollapsed(_collapsed: boolean) {},

  /**
   * A picture-in-picture window cannot be placed, resized or switched by the page (ADR-0035).
   *
   * @returns False.
   */
  overlayPlacement() {
    return false;
  },

  /**
   * Nothing to do (see overlayPlacement).
   *
   * @param _preset Ignored.
   */
  placeOverlay(_preset: OverlayPreset) {},

  /**
   * No overlay preset in a browser.
   *
   * @returns Null.
   */
  async getOverlayPreset() {
    return null;
  },

  /**
   * Nothing to do (see overlayPlacement).
   *
   * @param _step Ignored.
   */
  resizeOverlay(_step: OverlayResizeStep) {},

  /**
   * Nothing to do to the window (see overlayPlacement); the view still shows its mode.
   *
   * @param _mode Ignored.
   */
  setOverlayMode(_mode: OverlayMode) {},

  /** Nothing to do: a web page cannot minimise its window. */
  minimizeMainWindow() {},

  /**
   * The call's tab is the full call window: closes the picture-in-picture window and asks the
   * browser to bring the tab forward (it may decline; the user still has the tab).
   *
   * @returns Resolves at once.
   */
  async showCallWindow() {
    closePictureInPicture();
    window.focus();
  },

  /**
   * A browser has no global shortcuts.
   *
   * @returns Null.
   */
  async checkHotkeys() {
    return null;
  },

  /**
   * The in-page shortcuts on another window (the picture-in-picture window).
   *
   * @param target  The window.
   * @param handler Called with each action.
   * @returns A function that stops listening.
   */
  listenForFocusedHotkeys(target, handler) {
    return listenForHotkeys(target, browserIsMac(), handler);
  },

  /**
   * The Ask Kite shortcut, while the Kite tab has focus.
   *
   * @param handler Called each time it is pressed.
   * @returns A function that stops listening.
   */
  onAskKiteHotkey(handler) {
    return listenForAskKite(window, browserIsMac(), handler);
  },

  /**
   * Closes the picture-in-picture window (End).
   *
   * @returns Resolves at once.
   */
  async closeCompactView() {
    closePictureInPicture();
  },
};
