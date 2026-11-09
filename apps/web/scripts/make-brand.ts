/**
 * File: apps/web/scripts/make-brand.ts
 * Purpose: Makes Paramount AI's brand files from the final logo (apps/web/public/images/final-logo.png:
 *          the parrot and the "Paramount AI" wordmark side by side, 2172 × 724, on an almost-white
 *          background with no transparency). Shapes and colours are never changed: the script only
 *          trims, crops, scales and makes the background transparent.
 *          - The lockup (the whole logo, trimmed, transparent): apps/web/public/brand/logo-lockup.png,
 *            the file BRAND_LOGO_SRC names. It is a small copy (about 40 KB) of the 1.1 MB original,
 *            because every page shows it at 22–36 px tall.
 *          - The mark (the parrot alone, square, transparent): apps/web/public/brand/logo-mark.png, and
 *            from it the favicons (favicon.ico 16/32/48, favicon.svg, apple-touch-icon.png,
 *            icon-16/32/48/256.png) and the desktop icons (apps/desktop/build/icon.ico 16–256,
 *            icon.png 256, icon-512.png, icon-1024.png). Sizes up to 48 px sit on a white square tile,
 *            so the mark shows on dark taskbars and tabs.
 *          The parrot in the source is about 443 × 504 px, so icon-1024.png is scaled up and soft: a
 *          square mark of at least 1024 px from the designer replaces it (set MARK_SOURCE below).
 *          Usage: pnpm --filter web make-brand (the outputs are committed; run again only when the
 *          logo changes).
 * Used by: the "make-brand" script in apps/web/package.json (by hand)
 * Depends on: sharp (already installed with Next.js for image optimisation; loaded from Next.js's own
 *             dependencies, so it is not a separate dependency of Kite), node:fs
 * Architecture: docs/design/kite-ui-theme.md §7 (brand assets); docs/design/paramount-ai-ui-spec.md §0
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The final logo (source of everything here). */
const LOGO = path.join(WEB_DIR, 'public', 'images', 'final-logo.png');
/** Web outputs. */
const WEB_OUT = path.join(WEB_DIR, 'public', 'brand');
/** Desktop outputs. */
const DESKTOP_OUT = path.join(WEB_DIR, '..', 'desktop', 'build');

/**
 * Where the parrot is in the source, in source pixels (measured on 9 Nov 2026: the first run of inked
 * columns is x 89–531; the wordmark starts at x 613; ink spans y 106–609).
 */
const MARK_BOX = { left: 89, top: 106, right: 531, bottom: 609 };

/**
 * Where the wordmark's dark letters are (x range, source pixels). Inside it every near-white pixel is
 * background, including the letters' counters ("a", "o"). Outside it only background reachable from the
 * edge is made transparent, so the parrot's white face and the white "AI" letters stay white.
 */
const WORDMARK_LETTERS = { left: 600, right: 1800 };

/** A pixel is "light" (background or its anti-aliased edge) when its darkest channel is at least this. */
const LIGHT = 200;

/**
 * A point on the parrot's white face (source pixels). The face is the same white as the background
 * (254) and touches it above the beak, so the parrot's outline is first closed (see sealedParrot()).
 */
const FACE_SEED = { x: 330, y: 240 };

/**
 * Closes small gaps in the parrot's outline: inside MARK_BOX, every pixel within `radius` of ink is
 * marked, then the marked area is shrunk back by `radius` (a morphological closing with a square). Gaps
 * narrower than about twice the radius are sealed; the outline itself does not move.
 *
 * @param isInk  Whether a source pixel is ink (not light).
 * @param width  The source width.
 * @param height The source height.
 * @param radius The closing radius, px.
 * @returns For each source pixel, 1 when it is sealed ink inside the box.
 * Called from: transparentLogo()
 */
function sealedParrot(
  isInk: (x: number, y: number) => boolean,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const { left, top, right, bottom } = MARK_BOX;
  const w = right - left + 1 + 2 * radius;
  const h = bottom - top + 1 + 2 * radius;
  const x0 = left - radius;
  const y0 = top - radius;
  // A square max/min filter is separable: rows, then columns.
  const filter = (input: Uint8Array, keep: 'max' | 'min'): Uint8Array => {
    const rows = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = keep === 'max' ? 0 : 1;
        for (let d = -radius; d <= radius; d++) {
          const xx = Math.min(w - 1, Math.max(0, x + d));
          const s = input[y * w + xx]!;
          v = keep === 'max' ? Math.max(v, s) : Math.min(v, s);
        }
        rows[y * w + x] = v;
      }
    }
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = keep === 'max' ? 0 : 1;
        for (let d = -radius; d <= radius; d++) {
          const yy = Math.min(h - 1, Math.max(0, y + d));
          const s = rows[yy * w + x]!;
          v = keep === 'max' ? Math.max(v, s) : Math.min(v, s);
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx >= 0 && sy >= 0 && sx < width && sy < height && isInk(sx, sy)) ink[y * w + x] = 1;
    }
  }
  const closed = filter(filter(ink, 'max'), 'min');
  const sealed = new Uint8Array(width * height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (closed[y * w + x] && sx >= 0 && sy >= 0 && sx < width && sy < height) {
        sealed[sy * width + sx] = 1;
      }
    }
  }
  return sealed;
}

/** The part of sharp used here (it is Next.js's dependency, so its types are not imported). */
interface SharpImage {
  /** Scales the image. */
  resize(options: Record<string, unknown>): SharpImage;
  /** Cuts a rectangle out. */
  extract(region: { left: number; top: number; width: number; height: number }): SharpImage;
  /** Places images on this one. */
  composite(layers: { input: Buffer; left: number; top: number }[]): SharpImage;
  /** Encodes as PNG. */
  png(options?: Record<string, unknown>): SharpImage;
  /** The encoded bytes. */
  toBuffer(): Promise<Buffer>;
  /** The raw pixels and their layout. */
  raw(): { toBuffer(options: { resolveWithObject: true }): Promise<RawImage> };
}

/** Raw pixels as sharp returns them. */
interface RawImage {
  /** The pixels, row by row. */
  data: Buffer;
  /** Their layout. */
  info: RawLayout;
}

/** The layout of raw pixels. */
interface RawLayout {
  /** Width, px. */
  width: number;
  /** Height, px. */
  height: number;
  /** Values per pixel (3 for RGB, 4 for RGBA). */
  channels: number;
}

/** sharp's factory: from a file or bytes, or a raw/blank image. */
type Sharp = (
  input?: Buffer | string | Record<string, unknown>,
  options?: Record<string, unknown>,
) => SharpImage;

/** sharp, from Next.js's dependencies. */
const sharp = createRequire(createRequire(import.meta.url).resolve('next/package.json'))(
  'sharp',
) as Sharp;

/** The mark's share of a square icon's height: a little room around it, as app icons have. */
const MARK_HEIGHT = 0.86;

/**
 * The logo with a transparent background, as RGBA pixels. "Colour to alpha" against white: a pixel's
 * opacity is how far its lightest-to-white distance goes, and its colour is un-mixed from white, so the
 * anti-aliased edges stay smooth on any background.
 *
 * @returns RGBA pixels and the size.
 * Called from: main()
 */
async function transparentLogo(): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(LOGO).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const at = (x: number, y: number) => (y * width + x) * channels;
  const light = (x: number, y: number) => {
    const i = at(x, y);
    return Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >= LIGHT;
  };
  // Background: light pixels reachable from the edge (flood fill), plus every light pixel between the
  // wordmark's letters. The parrot's outline is closed first, with the smallest radius that keeps the
  // face from being reached.
  const flood = (sealed: Uint8Array): Uint8Array => {
    const reached = new Uint8Array(width * height);
    const stack: number[] = [];
    for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (reached[p] || sealed[p]) continue;
      const x = p % width;
      const y = (p - x) / width;
      if (!light(x, y)) continue;
      reached[p] = 1;
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - width);
      if (y < height - 1) stack.push(p + width);
    }
    return reached;
  };
  let background: Uint8Array | null = null;
  for (let radius = 1; radius <= 24 && !background; radius++) {
    const reached = flood(sealedParrot((x, y) => !light(x, y), width, height, radius));
    if (!reached[FACE_SEED.y * width + FACE_SEED.x]) {
      console.log(`make-brand: the parrot's outline is closed at radius ${radius} px`);
      background = reached;
    }
  }
  if (!background) throw new Error('Could not keep the parrot face opaque');
  for (let y = 0; y < height; y++) {
    for (let x = WORDMARK_LETTERS.left; x < WORDMARK_LETTERS.right; x++) {
      if (light(x, y)) background[y * width + x] = 1;
    }
  }
  const out = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const rgb = [data[i]!, data[i + 1]!, data[i + 2]!];
    let alpha = 255;
    if (background[p]) {
      // Colour to alpha against white (255).
      alpha = Math.max(...rgb.map((c) => 255 - c));
      // The background is 253–254, not 255: anything that faint is fully transparent.
      if (alpha <= 3) alpha = 0;
    }
    for (let c = 0; c < 3; c++) {
      out[p * 4 + c] = alpha === 0 ? 255 : Math.round(255 - ((255 - rgb[c]!) * 255) / alpha);
    }
    out[p * 4 + 3] = alpha;
  }
  return { data: out, width, height };
}

/**
 * A rectangle of the transparent logo as a PNG.
 *
 * @param logo   The transparent logo.
 * @param region The rectangle, in source pixels.
 * @returns PNG bytes.
 * Called from: main()
 */
async function cut(
  logo: { data: Buffer; width: number; height: number },
  region: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  return sharp(logo.data, { raw: { width: logo.width, height: logo.height, channels: 4 } })
    .extract(region)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * A square icon: the mark scaled (proportions kept) and centred on a canvas.
 *
 * @param mark       The mark (PNG) and its size.
 * @param size       The icon's side, px.
 * @param background 'transparent', or a colour for an opaque icon.
 * @param share      The mark's height as a share of the side.
 * @returns PNG bytes.
 * Called from: main()
 */
async function squareIcon(
  mark: { png: Buffer; width: number; height: number },
  size: number,
  background: 'transparent' | string = 'transparent',
  share = MARK_HEIGHT,
): Promise<Buffer> {
  const height = Math.round(size * share);
  const width = Math.max(1, Math.round((height * mark.width) / mark.height));
  const scaled = await sharp(mark.png)
    .resize({ width, height, fit: 'fill', kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const bg = background === 'transparent' ? { r: 0, g: 0, b: 0, alpha: 0 } : background;
  return sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([
      { input: scaled, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) },
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

  const logo = await transparentLogo();
  // The lockup: the inked area (x 89–2093, y 106–609) with a few pixels of room, at 160 px tall
  // (sharp at 36 px CSS on a 3x screen, the largest use).
  const pad = 8;
  const lockupRegion = {
    left: MARK_BOX.left - pad,
    top: MARK_BOX.top - pad,
    width: 2093 - MARK_BOX.left + 1 + 2 * pad,
    height: MARK_BOX.bottom - MARK_BOX.top + 1 + 2 * pad,
  };
  const lockup = await sharp(await cut(logo, lockupRegion))
    .resize({ height: 160, kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  write(path.join(WEB_OUT, 'logo-lockup.png'), lockup);

  // The mark: the parrot alone.
  const markWidth = MARK_BOX.right - MARK_BOX.left + 1;
  const markHeight = MARK_BOX.bottom - MARK_BOX.top + 1;
  const markPng = await cut(logo, {
    left: MARK_BOX.left,
    top: MARK_BOX.top,
    width: markWidth,
    height: markHeight,
  });
  const mark = { png: markPng, width: markWidth, height: markHeight };
  write(path.join(WEB_OUT, 'logo-mark.png'), await squareIcon(mark, 512, 'transparent', 0.96));

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const icons = new Map<number, Buffer>();
  for (const size of sizes) {
    // Small sizes (≤ 48 px) on the white square tile used on dark surfaces (decision, 31 Oct):
    // without it the mark's dark blue disappears on dark taskbars and dark browser tabs.
    icons.set(
      size,
      size <= 48 ? await squareIcon(mark, size, '#ffffff', 0.84) : await squareIcon(mark, size),
    );
  }
  // The SVG favicon is also shown small in tabs, so it wraps a tiled 256 px icon.
  const tiled256 = await squareIcon(mark, 256, '#ffffff', 0.84);
  for (const size of [16, 32, 48, 256]) {
    write(path.join(WEB_OUT, `icon-${size}.png`), icons.get(size)!);
  }
  write(
    path.join(WEB_OUT, 'favicon.ico'),
    ico([16, 32, 48].map((size) => ({ size, png: icons.get(size)! }))),
  );
  // An SVG favicon must be a vector to be sharp at every size; until a vector logo exists it wraps the
  // tiled 256 px icon (tabs show it small), which browsers scale down.
  write(
    path.join(WEB_OUT, 'favicon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${tiled256.toString('base64')}"/></svg>\n`,
  );
  // iOS fills a transparent touch icon with black: the mark sits on white.
  write(path.join(WEB_OUT, 'apple-touch-icon.png'), await squareIcon(mark, 180, '#ffffff', 0.78));

  write(
    path.join(DESKTOP_OUT, 'icon.ico'),
    ico(sizes.map((size) => ({ size, png: icons.get(size)! }))),
  );
  write(path.join(DESKTOP_OUT, 'icon.png'), icons.get(256)!);
  write(path.join(DESKTOP_OUT, 'icon-512.png'), await squareIcon(mark, 512));
  write(path.join(DESKTOP_OUT, 'icon-1024.png'), await squareIcon(mark, 1024));
  console.log(`make-brand: source ${path.basename(LOGO)} (${readFileSync(LOGO).length} bytes)`);
  for (const line of written) console.log(`  ${line}`);
}

main().catch((error: unknown) => {
  console.error(`make-brand: failed (${error instanceof Error ? error.message : 'unknown'})`);
  process.exitCode = 1;
});
