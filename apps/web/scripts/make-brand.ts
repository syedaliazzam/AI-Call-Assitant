/**
 * File: apps/web/scripts/make-brand.ts
 * Purpose: Makes Paramount AI's brand files from the logo, without changing its shapes, colours or
 *          proportions: it is only trimmed, cropped, scaled and placed on a square.
 *          Source (v1.3.2, ADR-0060): apps/web/public/images/green-logo.png, the green logo (the
 *          parrot and "Paramount AI" in one wide image on white, no transparency). Outputs:
 *          - apps/web/public/images/green-logo-lockup.png: the whole logo with its white margins
 *            trimmed; the app shows it (src/ui/brand.ts BRAND_LOGO_SRC);
 *          - apps/web/public/brand/: logo-mark.png (the parrot alone, trimmed), favicon.ico
 *            (16, 32, 48), favicon.svg (the 256 px icon embedded: there is no vector logo yet),
 *            apple-touch-icon.png (180), icon-16/32/48/256.png (previews);
 *          - apps/desktop/build/: icon.ico (16–256, Windows), icon.png (256, the window icon),
 *            icon-512.png and icon-1024.png (for the macOS build later).
 *          Every icon is the parrot alone (the words are unreadable at 16–48 px) on a white square.
 *          Usage: pnpm --filter web make-brand (the outputs are committed; run again only
 *          when the logo changes).
 * Used by: the "make-brand" script in apps/web/package.json (by hand)
 * Depends on: sharp (already installed with Next.js for image optimisation; loaded from
 *             Next.js's own dependencies, so it is not a separate dependency of Kite), node:fs
 * Architecture: docs/design/kite-ui-theme.md §7 (brand assets), §9 (stage U4)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * The logo (source). v1.3.2 (ADR-0060): the green logo, the parrot and "Paramount AI" in one wide
 * image on white (2172 × 724, no transparency). It replaces logo-mark.png (the "P" mark).
 */
const MARK = path.join(WEB_DIR, 'public', 'images', 'green-logo.png');
/** The logo as the app shows it (src/ui/brand.ts BRAND_LOGO_SRC): the source with its white margins trimmed. */
const LOCKUP_OUT = path.join(WEB_DIR, 'public', 'images', 'green-logo-lockup.png');
/**
 * Where the parrot ends and the words begin in the source, in px from its left edge (measured on
 * the 2172 px source: the parrot reaches about 590, "Paramount" starts about 600). The icons use the
 * parrot alone: the words would be unreadable at 16–48 px.
 */
const PARROT_RIGHT = 595;
/** Web outputs. */
const WEB_OUT = path.join(WEB_DIR, 'public', 'brand');
/** Desktop outputs. */
const DESKTOP_OUT = path.join(WEB_DIR, '..', 'desktop', 'build');

/** The part of sharp used here (it is Next.js's dependency, so its types are not imported). */
interface SharpImage {
  /** Scales the image. */
  resize(options: Record<string, unknown>): SharpImage;
  /** Cuts out a rectangle. */
  extract(region: { left: number; top: number; width: number; height: number }): SharpImage;
  /** Removes the plain border around the picture. */
  trim(options: Record<string, unknown>): SharpImage;
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

/** The mark's share of a square icon's side: a little room around it, as app icons have. */
const MARK_HEIGHT = 0.86;

/** Trimming: anything this close to white counts as the plain border. */
const TRIM = { background: '#ffffff', threshold: 12 };

/**
 * The parrot alone, its white margins trimmed: the picture every icon is made from.
 *
 * @returns PNG bytes.
 * Called from: main()
 */
async function parrot(): Promise<Buffer> {
  const cut = await sharp(MARK)
    .extract({ left: 0, top: 0, width: PARROT_RIGHT, height: 724 })
    .png()
    .toBuffer();
  return sharp(cut).trim(TRIM).png().toBuffer();
}

/**
 * A square icon: the parrot scaled (proportions kept, never stretched) and centred on a white
 * square. The source has no transparency, so every icon is on white, which also keeps it visible
 * on dark taskbars and tabs.
 *
 * @param mark  The parrot (from parrot()).
 * @param size  The icon's side, px.
 * @param share The parrot's share of the side.
 * @returns PNG bytes.
 * Called from: main()
 */
async function squareIcon(mark: Buffer, size: number, share = MARK_HEIGHT): Promise<Buffer> {
  const inner = Math.max(1, Math.round(size * share));
  const scaled = await sharp(mark)
    .resize({
      width: inner,
      height: inner,
      fit: 'contain',
      background: '#ffffff',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: '#ffffff' } })
    .composite([{ input: scaled, left: offset, top: offset }])
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

  // The logo the app shows: the whole wordmark, its white margins trimmed so it fills its height.
  // 192 px tall: sharp at twice the largest size it is shown at (the sign-in hero), and small
  // enough to load with every page (the 2172 px source is about 1 MB).
  const trimmed = await sharp(MARK).trim(TRIM).png().toBuffer();
  write(
    LOCKUP_OUT,
    await sharp(trimmed)
      .resize({ height: 192, kernel: 'lanczos3' })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  // The parrot alone, for the icons (kept as brand/logo-mark.png, the name earlier releases used).
  const mark = await parrot();
  write(path.join(WEB_OUT, 'logo-mark.png'), mark);

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const icons = new Map<number, Buffer>();
  for (const size of sizes) {
    // Small sizes get a little more room around the parrot, so it does not touch a tab's edges.
    icons.set(size, size <= 48 ? await squareIcon(mark, size, 0.9) : await squareIcon(mark, size));
  }
  // The SVG favicon is also shown small in tabs, so it wraps a 256 px icon.
  const tiled256 = await squareIcon(mark, 256, 0.9);
  for (const size of [16, 32, 48, 256]) {
    write(path.join(WEB_OUT, `icon-${size}.png`), icons.get(size)!);
  }
  write(
    path.join(WEB_OUT, 'favicon.ico'),
    ico([16, 32, 48].map((size) => ({ size, png: icons.get(size)! }))),
  );
  // An SVG favicon must be a vector to be sharp at every size; until the designer's vector
  // arrives it wraps the tiled 256 px icon (tabs show it small), which browsers scale down.
  write(
    path.join(WEB_OUT, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${tiled256.toString('base64')}"/></svg>\n`,
  );
  // iOS fills a transparent touch icon with black; the company site shows the mark on white.
  write(path.join(WEB_OUT, 'apple-touch-icon.png'), await squareIcon(mark, 180, 0.8));

  write(
    path.join(DESKTOP_OUT, 'icon.ico'),
    ico(sizes.map((size) => ({ size, png: icons.get(size)! }))),
  );
  write(path.join(DESKTOP_OUT, 'icon.png'), icons.get(256)!);
  write(path.join(DESKTOP_OUT, 'icon-512.png'), await squareIcon(mark, 512));
  write(path.join(DESKTOP_OUT, 'icon-1024.png'), await squareIcon(mark, 1024));
  console.log(`make-brand: source ${path.basename(MARK)} (${readFileSync(MARK).length} bytes)`);
  for (const line of written) console.log(`  ${line}`);
}

main().catch((error: unknown) => {
  console.error(`make-brand: failed (${error instanceof Error ? error.message : 'unknown'})`);
  process.exitCode = 1;
});
