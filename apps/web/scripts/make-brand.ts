/**
 * File: apps/web/scripts/make-brand.ts
 * Purpose: Makes Kite's brand files (UI theme stage U4) from the company logo mark, without
 *          changing its shapes, colours or proportions: the mark is only scaled and placed on
 *          a square canvas (transparent, or white for the Apple touch icon).
 *          Source: apps/web/public/images/logo-mark.png (216 × 304, transparent; the file
 *          paramountintelligence.co serves). Outputs:
 *          - apps/web/public/brand/: logo-mark.png (the mark for the lockup), favicon.ico
 *            (16, 32, 48), favicon.svg (the 256 px icon embedded: there is no vector logo yet),
 *            apple-touch-icon.png (180, on white), icon-16/32/48/256.png (previews);
 *          - apps/desktop/build/: icon.ico (16–256, Windows), icon.png (256, the window icon),
 *            icon-512.png and icon-1024.png (for the macOS build later; scaled up from the
 *            304 px source, so soft: the designer's original is needed for a sharp version).
 *          Usage: pnpm --filter web make-brand (the outputs are committed; run again only
 *          when the logo changes).
 * Used by: the "make-brand" script in apps/web/package.json (by hand)
 * Depends on: sharp (already installed with Next.js for image optimisation; loaded from
 *             Next.js's own dependencies, so it is not a separate dependency of Kite), node:fs
 * Architecture: docs/design/kite-ui-theme.md §7 (brand assets), §9 (stage U4)
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The logo mark (source). */
const MARK = path.join(WEB_DIR, 'public', 'images', 'logo-mark.png');
/** Web outputs. */
const WEB_OUT = path.join(WEB_DIR, 'public', 'brand');
/** Desktop outputs. */
const DESKTOP_OUT = path.join(WEB_DIR, '..', 'desktop', 'build');

/** The part of sharp used here (it is Next.js's dependency, so its types are not imported). */
interface SharpImage {
  /** Scales the image. */
  resize(options: Record<string, unknown>): SharpImage;
  /** Places images on this one. */
  composite(layers: { input: Buffer; left: number; top: number }[]): SharpImage;
  /** Encodes as PNG. */
  png(options?: Record<string, unknown>): SharpImage;
  /** The encoded bytes. */
  toBuffer(): Promise<Buffer>;
}

/** sharp's factory. */
type Sharp = ((input?: Buffer | string | Record<string, unknown>) => SharpImage) & {
  /** Reads an image's size. */
  (input: string): SharpImage;
};

/** sharp, from Next.js's dependencies. */
const sharp = createRequire(createRequire(import.meta.url).resolve('next/package.json'))(
  'sharp',
) as Sharp;

/** The mark's share of a square icon's height: a little room around it, as app icons have. */
const MARK_HEIGHT = 0.86;

/** The mark's proportions (216 × 304). */
const MARK_RATIO = 216 / 304;

/**
 * A square icon: the mark scaled (proportions kept) and centred on a canvas.
 *
 * @param size       The icon's side, px.
 * @param background 'transparent', or a colour for an opaque icon.
 * @param share      The mark's height as a share of the side.
 * @returns PNG bytes.
 * Called from: main()
 */
async function squareIcon(
  size: number,
  background: 'transparent' | string = 'transparent',
  share = MARK_HEIGHT,
): Promise<Buffer> {
  const height = Math.round(size * share);
  const width = Math.max(1, Math.round(height * MARK_RATIO));
  const mark = await sharp(MARK)
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const bg = background === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : background;
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([
      { input: mark, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Writes an .ico file holding PNG images (supported by Windows Vista and later and by every
 * current browser).
 *
 * @param images The PNGs with their sizes, smallest first.
 * @returns The .ico bytes.
 * Called from: main()
 */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/**
 * Makes every brand file.
 *
 * @returns Nothing; prints what it wrote.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  mkdirSync(WEB_OUT, { recursive: true });
  mkdirSync(DESKTOP_OUT, { recursive: true });
  const written: string[] = [];
  const write = (file: string, bytes: Buffer | string) => {
    writeFileSync(file, bytes);
    written.push(`${path.relative(path.join(WEB_DIR, '..', '..'), file)} (${bytes.length} bytes)`);
  };

  copyFileSync(MARK, path.join(WEB_OUT, 'logo-mark.png'));
  written.push('apps/web/public/brand/logo-mark.png (copy of the source)');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const icons = new Map<number, Buffer>();
  for (const size of sizes) icons.set(size, await squareIcon(size));
  for (const size of [16, 32, 48, 256]) {
    write(path.join(WEB_OUT, `icon-${size}.png`), icons.get(size)!);
  }
  write(
    path.join(WEB_OUT, 'favicon.ico'),
    ico([16, 32, 48].map((size) => ({ size, png: icons.get(size)! }))),
  );
  // An SVG favicon must be a vector to be sharp at every size; until the designer's vector
  // arrives it wraps the 256 px icon, which browsers scale down cleanly.
  write(
    path.join(WEB_OUT, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${icons.get(256)!.toString('base64')}"/></svg>\n`,
  );
  // iOS fills a transparent touch icon with black; the company site shows the mark on white.
  write(path.join(WEB_OUT, 'apple-touch-icon.png'), await squareIcon(180, '#ffffff', 0.72));

  write(
    path.join(DESKTOP_OUT, 'icon.ico'),
    ico(sizes.map((size) => ({ size, png: icons.get(size)! }))),
  );
  write(path.join(DESKTOP_OUT, 'icon.png'), icons.get(256)!);
  write(path.join(DESKTOP_OUT, 'icon-512.png'), await squareIcon(512));
  write(path.join(DESKTOP_OUT, 'icon-1024.png'), await squareIcon(1024));
  console.log(`make-brand: source ${path.basename(MARK)} (${readFileSync(MARK).length} bytes)`);
  for (const line of written) console.log(`  ${line}`);
}

main().catch((error: unknown) => {
  console.error(`make-brand: failed (${error instanceof Error ? error.message : 'unknown'})`);
  process.exitCode = 1;
});
