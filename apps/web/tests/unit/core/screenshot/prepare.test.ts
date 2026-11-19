/**
 * Tests for apps/web/src/core/screenshot/prepare.ts, with the image codec faked: the shared
 * fitWithin() rule (longest side ≤ 1,568, proportions kept, never upscaled); the encoding plan
 * (fitted at 0.8, then 0.6, then 75% and 50% at 0.6); prepareScreenshot() returns the first
 * JPEG under 1 MB as a data URL, falls back when too large, refuses bytes that are not a JPEG
 * (FF D8 FF), and throws CaptureError('failed') when the image cannot be read or stays too
 * large; the decoded image is always released; isJpeg() and jpegDataUrl().
 */
import { fitWithin, SCREENSHOT_MAX_SIDE } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  FALLBACK_QUALITY,
  JPEG_QUALITY,
  MAX_SCREENSHOT_BYTES,
  encodingPlan,
  isJpeg,
  jpegDataUrl,
  prepareScreenshot,
  BLANK_SHARE,
  sameColourShareOf,
  shortHash,
  type EncodeAttempt,
} from '@/core/screenshot/prepare';
import { CaptureError } from '@/platform/errors';

/**
 * Fake JPEG bytes of a given length.
 *
 * @param length Total bytes.
 * @returns Bytes starting with FF D8 FF.
 */
function jpeg(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

/**
 * A fake codec: decode gives a fixed size; encode returns bytes sized by the caller's rule.
 *
 * @param size       The decoded image size.
 * @param bytesFor   How many bytes each attempt produces.
 * @param notJpeg    True to return non-JPEG bytes.
 * @returns The codec, the attempts made and the close spy.
 */
function codec(
  size: { width: number; height: number },
  bytesFor: (attempt: EncodeAttempt) => number,
  notJpeg = false,
) {
  const attempts: EncodeAttempt[] = [];
  const close = vi.fn();
  return {
    attempts,
    close,
    codec: {
      decode: async () => ({ ...size, close }),
      encode: async (_decoded: unknown, attempt: EncodeAttempt) => {
        attempts.push(attempt);
        return notJpeg ? new Uint8Array(10) : jpeg(bytesFor(attempt));
      },
    },
  };
}

describe('fitWithin', () => {
  it('keeps the longest side at most 1,568 px, keeps proportions, never upscales', () => {
    expect(SCREENSHOT_MAX_SIDE).toBe(1568);
    expect(fitWithin({ width: 3840, height: 2160 })).toEqual({ width: 1568, height: 882 });
    expect(fitWithin({ width: 1080, height: 1920 })).toEqual({ width: 882, height: 1568 });
    expect(fitWithin({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
    expect(fitWithin({ width: 5000, height: 1 })).toEqual({ width: 1568, height: 1 });
  });
});

describe('encodingPlan', () => {
  it('tries the fitted size at 0.8, then 0.6, then smaller at 0.6', () => {
    expect(encodingPlan({ width: 3840, height: 2160 })).toEqual([
      { width: 1568, height: 882, quality: JPEG_QUALITY },
      { width: 1568, height: 882, quality: FALLBACK_QUALITY },
      { width: 1176, height: 662, quality: FALLBACK_QUALITY },
      { width: 784, height: 441, quality: FALLBACK_QUALITY },
    ]);
  });
});

describe('prepareScreenshot', () => {
  it('returns the first JPEG under 1 MB as a data URL', async () => {
    const fake = codec({ width: 3840, height: 2160 }, () => 300_000);
    const prepared = await prepareScreenshot(new Blob(), fake.codec);
    expect(prepared).toMatchObject({ width: 1568, height: 882, bytes: 300_000 });
    expect(prepared.dataUrl.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
    expect(fake.attempts).toHaveLength(1);
    expect(fake.close).toHaveBeenCalled();
  });

  it('falls back to a lower quality, then a smaller size, when too large', async () => {
    const fake = codec({ width: 3840, height: 2160 }, (attempt) =>
      attempt.width >= 1568 ? MAX_SCREENSHOT_BYTES + 1 : 600_000,
    );
    const prepared = await prepareScreenshot(new Blob(), fake.codec);
    expect(fake.attempts.map((a) => [a.width, a.quality])).toEqual([
      [1568, JPEG_QUALITY],
      [1568, FALLBACK_QUALITY],
      [1176, FALLBACK_QUALITY],
    ]);
    expect(prepared.width).toBe(1176);
  });

  it('fails when every attempt is too large, when the bytes are not a JPEG, or the image is unreadable', async () => {
    const tooBig = codec({ width: 3840, height: 2160 }, () => MAX_SCREENSHOT_BYTES + 1);
    await expect(prepareScreenshot(new Blob(), tooBig.codec)).rejects.toBeInstanceOf(CaptureError);
    expect(tooBig.close).toHaveBeenCalled();
    const notJpeg = codec({ width: 100, height: 100 }, () => 10, true);
    await expect(prepareScreenshot(new Blob(), notJpeg.codec)).rejects.toMatchObject({
      code: 'failed',
    });
    const unreadable = {
      decode: async () => {
        throw new Error('bad image');
      },
      encode: vi.fn(),
    };
    await expect(prepareScreenshot(new Blob(), unreadable)).rejects.toMatchObject({
      code: 'failed',
    });
    expect(unreadable.encode).not.toHaveBeenCalled();
  });
});

describe('isJpeg and jpegDataUrl', () => {
  it('recognises the JPEG start bytes and writes a data URL', () => {
    expect(isJpeg(jpeg(4))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(jpegDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      'data:image/jpeg;base64,/9j/4A==',
    );
  });
});

// ADR-0107: the trace's image hash, and the blank check that makes a page still drawing be taken again.
describe('prepareScreenshot hash and blank (ADR-0107)', () => {
  it('gives a 16-digit hash that changes with the bytes, and is not blank without a colour check', async () => {
    const first = await prepareScreenshot(
      new Blob(),
      codec({ width: 100, height: 50 }, () => 2_000).codec,
    );
    const second = await prepareScreenshot(
      new Blob(),
      codec({ width: 100, height: 50 }, () => 3_000).codec,
    );
    expect(first.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(first.hash).not.toBe(second.hash);
    expect(first.blank).toBe(false);
  });

  it('marks an image blank when the colour check finds one colour almost everywhere', async () => {
    const make = (share: number) => ({
      ...codec({ width: 100, height: 50 }, () => 2_000).codec,
      sameColourShare: async () => share,
    });
    expect((await prepareScreenshot(new Blob(), make(BLANK_SHARE))).blank).toBe(true);
    expect((await prepareScreenshot(new Blob(), make(0.6))).blank).toBe(false);
  });

  it('counts the share of the most common colour, ignoring small noise', async () => {
    const pixels = (colours: [number, number, number][]) =>
      new Uint8ClampedArray(colours.flatMap(([r, g, b]) => [r, g, b, 255]));
    expect(
      sameColourShareOf(
        pixels([
          [255, 255, 255],
          [250, 252, 249],
          [255, 254, 255],
          [0, 0, 0],
        ]),
      ),
    ).toBe(0.75);
    expect(sameColourShareOf(pixels([]))).toBe(0);
    await expect(shortHash(new Uint8Array([1, 2, 3]))).resolves.toMatch(/^[0-9a-f]{16}$/);
  });
});

// ADR-0107: the hash is for the trace only, so a page without Web Crypto still gets its screenshot.
describe('shortHash without Web Crypto (ADR-0107)', () => {
  it('returns an empty hash instead of failing', async () => {
    vi.stubGlobal('crypto', {});
    try {
      await expect(shortHash(new Uint8Array([1, 2, 3]))).resolves.toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
