/**
 * File: apps/web/src/core/screenshot/prepare.ts
 * Purpose: Turns a screenshot (a PNG Blob from either platform) into what a screenshot answer
 *          sends: a JPEG data URL whose longest side is at most 1,568 px and whose size is at
 *          most about 1 MB. The single place that encodes the JPEG. The size and fallback rules
 *          are pure; the browser's image decode and encode are passed in, so tests can fake them.
 * Used by: src/features/live (the Screenshot button and hotkey, Day 5 Stage 2);
 *          tests/integration/harness/screenshot.ts
 * Depends on: @kite/shared (fitWithin, SCREENSHOT_MAX_SIDE), src/platform/errors.ts (CaptureError)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3 (captureScreenshot), §7.2
 *               (screenshot requests); day-05-overlay-screenshots-notes.md Stage 1
 *
 * The image is in memory only: never stored, never logged (only its size).
 */
import { fitWithin, type PixelSize } from '@kite/shared';
import { CaptureError } from '@/platform/errors';

/** JPEG quality for the first try (0–1). */
export const JPEG_QUALITY = 0.8;

/** JPEG quality when the first try is too large. */
export const FALLBACK_QUALITY = 0.6;

/** Largest JPEG sent, in bytes (about 1 MB; the request limit is 4 MB). */
export const MAX_SCREENSHOT_BYTES = 1_000_000;

/** One encoding attempt: the size to draw and the JPEG quality. */
export interface EncodeAttempt extends PixelSize {
  /** JPEG quality, 0–1. */
  quality: number;
}

/** A prepared screenshot, ready for the answer request. */
export interface PreparedScreenshot {
  /** `data:image/jpeg;base64,…`. Never logged or stored. */
  dataUrl: string;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** JPEG size in bytes. */
  bytes: number;
  /**
   * ADR-0107: the first 16 hex digits of the JPEG's SHA-256, for the call's screenshot trace: two presses
   * that sent the same image have the same hash. Never the image itself.
   */
  hash: string;
  /**
   * ADR-0107: true when almost the whole image is one colour (a page that has not drawn yet, measured at
   * +0.3 s after a tab switch): the caller takes it once more.
   */
  blank: boolean;
}

/** ADR-0107: the share of sample points in the most common colour from which an image counts as blank. */
export const BLANK_SHARE = 0.97;

/** The browser calls prepareScreenshot() uses (replaced in unit tests). */
export interface ImageCodec {
  /**
   * Reads an image's size and pixels.
   *
   * @param image The image file.
   * @returns A handle with its width and height (closed with close()).
   */
  decode: (image: Blob) => Promise<{ width: number; height: number; close?: () => void }>;
  /**
   * Draws the decoded image at a size and encodes it as JPEG.
   *
   * @param decoded What decode() returned.
   * @param attempt The size and quality.
   * @returns The JPEG bytes.
   */
  encode: (decoded: unknown, attempt: EncodeAttempt) => Promise<Uint8Array>;
  /**
   * ADR-0107: how much of the image is its most common colour, 0–1 (from a small grid of sample points).
   * Optional: without it no image counts as blank.
   *
   * @param decoded What decode() returned.
   * @returns The share.
   */
  sameColourShare?: (decoded: unknown) => Promise<number>;
}

/**
 * ADR-0107: the first 16 hex digits of the SHA-256 of some bytes.
 *
 * @param bytes The bytes (the JPEG).
 * @returns The short hash.
 * Called from: prepareScreenshot(); tests
 */
export async function shortHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice()));
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * ADR-0107: the share of pixels equal (within a small tolerance) to the most common colour.
 *
 * @param pixels RGBA bytes of a small sample of the image.
 * @returns 0–1 (0 for no pixels).
 * Called from: browserCodec().sameColourShare; tests
 */
export function sameColourShareOf(pixels: Uint8ClampedArray | Uint8Array): number {
  const count = Math.floor(pixels.length / 4);
  if (count === 0) return 0;
  // Colours rounded to 16 levels per channel, so JPEG noise and anti-aliasing count as the same colour.
  const tally = new Map<number, number>();
  for (let at = 0; at < count * 4; at += 4) {
    const key = ((pixels[at]! >> 4) << 8) | ((pixels[at + 1]! >> 4) << 4) | (pixels[at + 2]! >> 4);
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return Math.max(...tally.values()) / count;
}

/**
 * The encoding attempts, in order: the fitted size at JPEG_QUALITY, then at
 * FALLBACK_QUALITY, then 75% and 50% of the fitted size at FALLBACK_QUALITY.
 *
 * @param size The original image size.
 * @returns The attempts.
 * Called from: prepareScreenshot(); tests
 */
export function encodingPlan(size: PixelSize): EncodeAttempt[] {
  const fitted = fitWithin(size);
  const scaled = (factor: number) =>
    fitWithin(fitted, Math.round(Math.max(fitted.width, fitted.height) * factor));
  return [
    { ...fitted, quality: JPEG_QUALITY },
    { ...fitted, quality: FALLBACK_QUALITY },
    { ...scaled(0.75), quality: FALLBACK_QUALITY },
    { ...scaled(0.5), quality: FALLBACK_QUALITY },
  ];
}

/**
 * Whether bytes are a JPEG (they start with the JPEG start-of-image marker FF D8 FF).
 *
 * @param bytes The file's bytes.
 * @returns True for a JPEG.
 * Called from: prepareScreenshot(); tests (the server checks the same: server/validate.ts)
 */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Writes bytes as a JPEG data URL.
 *
 * @param bytes JPEG bytes.
 * @returns `data:image/jpeg;base64,…`.
 * Called from: prepareScreenshot(); tests
 */
export function jpegDataUrl(bytes: Uint8Array): string {
  let binary = '';
  // In chunks, so a large image does not overflow String.fromCharCode's argument limit.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

/**
 * The browser's codec: createImageBitmap, then an OffscreenCanvas encoded as JPEG.
 *
 * @returns The codec.
 * Called from: prepareScreenshot() (default)
 */
export function browserCodec(): ImageCodec {
  return {
    decode: (image) => createImageBitmap(image),
    encode: async (decoded, attempt) => {
      const canvas = new OffscreenCanvas(attempt.width, attempt.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(decoded as ImageBitmap, 0, 0, attempt.width, attempt.height);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: attempt.quality });
      return new Uint8Array(await blob.arrayBuffer());
    },
    sameColourShare: async (decoded) => {
      // A 48 × 27 sample is enough to tell a blank page from any real screen, and costs nothing.
      const canvas = new OffscreenCanvas(48, 27);
      const context = canvas.getContext('2d');
      if (!context) return 0;
      context.drawImage(decoded as ImageBitmap, 0, 0, 48, 27);
      return sameColourShareOf(context.getImageData(0, 0, 48, 27).data);
    },
  };
}

/**
 * Prepares a screenshot: scales it to ≤ 1,568 px on the long side and encodes a JPEG of at
 * most MAX_SCREENSHOT_BYTES, trying a lower quality and then smaller sizes if needed.
 *
 * @param image The screenshot (PNG from the desktop shell or the browser's frame grab).
 * @param codec The image decode/encode (default: the browser's).
 * @returns The JPEG data URL with its size.
 * @throws CaptureError('failed') when the image cannot be read or stays too large.
 * Called from: the live page's screenshot answer (Stage 2); the screenshot harness; tests
 */
export async function prepareScreenshot(
  image: Blob,
  codec: ImageCodec = browserCodec(),
): Promise<PreparedScreenshot> {
  let decoded: Awaited<ReturnType<ImageCodec['decode']>>;
  try {
    decoded = await codec.decode(image);
  } catch {
    throw new CaptureError('failed', 'Paramount AI could not read the screenshot. Try again.');
  }
  try {
    for (const attempt of encodingPlan(decoded)) {
      const bytes = await codec.encode(decoded, attempt);
      if (!isJpeg(bytes)) break;
      if (bytes.length <= MAX_SCREENSHOT_BYTES) {
        const share = codec.sameColourShare ? await codec.sameColourShare(decoded) : 0;
        return {
          dataUrl: jpegDataUrl(bytes),
          width: attempt.width,
          height: attempt.height,
          bytes: bytes.length,
          hash: await shortHash(bytes),
          blank: share >= BLANK_SHARE,
        };
      }
    }
  } catch {
    // Falls through to the error below.
  } finally {
    decoded.close?.();
  }
  throw new CaptureError('failed', 'Paramount AI could not prepare the screenshot. Try again.');
}
