/**
 * File: apps/web/tests/integration/harness/screenshot.ts
 * Purpose: Browser side of the screenshot harness test. A "Share" button runs the browser
 *          adapter's real getOtherSideStream() (Chromium picks the fake tab by its title) and
 *          then captureScreenshot() and core/screenshot/prepare.ts on that share, and exposes
 *          the result as numbers on `window.kiteScreenshotHarness` (sizes, byte counts and the
 *          first JPEG bytes; never the image).
 * Used by: tests/integration/screenshot.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/platform/browser.ts, src/core/screenshot/prepare.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (captureScreenshot), §11;
 *               day-05-overlay-screenshots-notes.md Stage 1
 */
import { prepareScreenshot } from '@/core/screenshot/prepare';
import { browserPlatform } from '@/platform/browser';
import { CaptureError } from '@/platform/errors';

/** What the test reads (numbers and codes only). */
export interface ScreenshotHarnessResult {
  /** True when the capture and preparation worked. */
  ok: boolean;
  /** The CaptureError code when it failed. */
  code?: string;
  /** Size of the PNG frame from the share, in bytes. */
  pngBytes?: number;
  /** The JPEG's width and height. */
  width?: number;
  /** The JPEG's height. */
  height?: number;
  /** The JPEG's size in bytes. */
  jpegBytes?: number;
  /** The first three JPEG bytes (FF D8 FF for a JPEG). */
  jpegStart?: number[];
  /** Capture + preparation time, in ms. */
  ms?: number;
}

/** What the Playwright test calls through page.evaluate(). */
export interface KiteScreenshotHarness {
  /** The latest result, or null before a run. */
  result: ScreenshotHarnessResult | null;
  /** Takes a screenshot of the current share without sharing again. */
  again: () => Promise<ScreenshotHarnessResult>;
  /** Stops the share (what "Stop sharing" in the browser does). */
  stop: () => void;
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteScreenshotHarness: KiteScreenshotHarness;
  }
}

/**
 * Captures and prepares one screenshot of the current share.
 *
 * @returns The numbers, or the error code.
 */
async function shoot(): Promise<ScreenshotHarnessResult> {
  const startedAt = performance.now();
  try {
    const { image: png } = await browserPlatform.captureScreenshot();
    const prepared = await prepareScreenshot(png);
    const base64 = prepared.dataUrl.slice('data:image/jpeg;base64,'.length);
    const head = atob(base64.slice(0, 8));
    return {
      ok: true,
      pngBytes: png.size,
      width: prepared.width,
      height: prepared.height,
      jpegBytes: prepared.bytes,
      jpegStart: [0, 1, 2].map((i) => head.charCodeAt(i)),
      ms: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return { ok: false, code: error instanceof CaptureError ? error.code : 'unknown' };
  }
}

/** The share, kept so the test can stop it. */
let share: MediaStream | null = null;

window.kiteScreenshotHarness = {
  result: null,
  again: shoot,
  stop: () => share?.getTracks().forEach((track) => track.stop()),
};

const button = document.createElement('button');
button.textContent = 'Share';
button.addEventListener('click', () => {
  void (async () => {
    // Before any share: the adapter must say there is nothing to capture.
    const before = await shoot();
    if (before.ok || before.code !== 'no-share') {
      window.kiteScreenshotHarness.result = {
        ok: false,
        code: `expected no-share, got ${before.code}`,
      };
      return;
    }
    try {
      share = (await browserPlatform.getOtherSideStream()).stream;
    } catch (error) {
      window.kiteScreenshotHarness.result = {
        ok: false,
        code: error instanceof CaptureError ? `share: ${error.code}` : 'share failed',
      };
      return;
    }
    window.kiteScreenshotHarness.result = await shoot();
  })();
});
document.body.append(button);
