/**
 * File: packages/shared/src/screenshot.ts
 * Purpose: The screenshot size rule shared by the desktop shell (which asks desktopCapturer
 *          for an image this size, so no full-resolution image crosses IPC) and the web app
 *          (which grabs the browser's frame at this size and encodes the JPEG), plus the shape
 *          of the shell's screenshot result.
 * Used by: apps/desktop/src/screenshot.ts, apps/desktop/src/preload.ts,
 *          apps/web/src/platform/browser.ts, apps/web/src/core/screenshot/prepare.ts,
 *          packages/shared/src/desktop-bridge.ts
 * Depends on: nothing (a constant, a pure helper and types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (captureScreenshot), §7.3
 *               (screenshot.ts); day-05-overlay-screenshots-notes.md Stage 1
 *
 * Screenshots are never stored or logged; they exist in memory until the request is sent.
 */

/**
 * Longest side of a screenshot sent to Claude, in pixels (Anthropic's vision guidance for
 * images that are not resized on their side; newer models accept up to 2,576, but 1,568 keeps
 * the image's token count and the time to the first word lower).
 */
export const SCREENSHOT_MAX_SIDE = 1_568;

/** A width and height in pixels. */
export interface PixelSize {
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * The size an image should be scaled to so its longest side is at most `max`, keeping its
 * proportions. Never scales up; never returns less than 1 pixel.
 *
 * @param size The image's size.
 * @param max  Longest side allowed (default SCREENSHOT_MAX_SIDE).
 * @returns The scaled size (whole pixels).
 * Called from: apps/desktop/src/screenshot.ts, apps/web/src/platform/browser.ts,
 *              apps/web/src/core/screenshot/prepare.ts; tests
 */
export function fitWithin(size: PixelSize, max: number = SCREENSHOT_MAX_SIDE): PixelSize {
  const longest = Math.max(size.width, size.height);
  const scale = longest > max ? max / longest : 1;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** Why the desktop shell could not take a screenshot. */
export type ScreenshotFailure =
  /** macOS: Screen Recording permission is not granted to Kite. */
  | 'permission-denied'
  /** No screen source was found, or its image was empty. */
  | 'no-screen'
  /** Any other failure. */
  | 'failed';

/**
 * How the shell chose the screen it captured (Mac 1.8.1 / Windows 1.7.5).
 * - `pointer`: the screen under the mouse pointer (the usual case).
 * - `window`: the screen of the Paramount AI window that has the keyboard (the pointer could not be read).
 * - `overlay`: the screen of the overlay (or the main window), as before 1.8.1.
 * - `other`: "Wrong screen?": the next screen after the one asked to skip.
 */
export type ScreenshotPick = 'pointer' | 'window' | 'overlay' | 'other';

/**
 * The screen a desktop screenshot was taken from (Mac 1.8.1 / Windows 1.7.5). Absent from an older shell's
 * result (Windows 1.7.4, Mac 1.8.0): the page then shows no screen number and no "Wrong screen?".
 */
export interface ScreenshotScreen {
  /** The display's id (Electron's, as a string), to ask for another screen next time. */
  id: string;
  /** Its number, counting the screens from the left (then from the top): 1 for the leftmost. */
  number: number;
  /** How many screens the computer has. */
  count: number;
  /** How the screen was chosen. */
  picked: ScreenshotPick;
}

/**
 * What the page may ask of a desktop screenshot (Mac 1.8.1 / Windows 1.7.5). An older shell ignores it and
 * captures the screen under its window.
 */
export interface ScreenshotRequest {
  /** "Wrong screen?": capture the next screen after this display id (in ScreenshotScreen.number order). */
  notDisplayId?: string;
}

/** What the desktop shell's captureScreenshot() returns. */
export type DesktopScreenshot =
  | {
      /** The capture worked. */
      ok: true;
      /** The PNG image (already scaled to SCREENSHOT_MAX_SIDE). Never stored or logged. */
      png: Uint8Array;
      /** Its width in pixels. */
      width: number;
      /** Its height in pixels. */
      height: number;
      /** How long the capture took in the shell, in ms. */
      ms: number;
      /** Mac 1.8.1 / Windows 1.7.5: the screen it came from. Absent from an older shell. */
      screen?: ScreenshotScreen;
    }
  | {
      /** The capture failed. */
      ok: false;
      /** Why. */
      code: ScreenshotFailure;
    };
