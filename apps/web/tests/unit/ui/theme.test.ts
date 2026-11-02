/**
 * Tests for apps/web/src/ui/theme.css and the theme rules (docs/design/kite-ui-theme.md §8):
 * - no file under apps/web/src or apps/web/app other than src/ui/theme.css contains a hex
 *   colour or rgb()/rgba(), and no class uses a Tailwind palette or the removed brand-* colours;
 * - the values given in the look-and-feel brief are the ones in the file;
 * - contrast (WCAG 2.x) of every text token on the surfaces it is used on, read from theme.css
 *   itself (variables resolved): at least 4.5:1;
 * - the overlay over a busy background: the see-through panel is composited over the worst case,
 *   pure white, at the default window opacity, and its text must still reach 4.5:1 (the native
 *   blur can only average what is behind, so white is the upper bound for any bright background).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OVERLAY_OPACITY } from '@/core/storage/overlayPrefs';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The theme file. */
const THEME_FILE = path.join(WEB_DIR, 'src', 'ui', 'theme.css');

/** The theme file's text. */
const THEME = readFileSync(THEME_FILE, 'utf8');

/** A colour as red, green, blue (0–255) and alpha (0–1). */
type Rgba = readonly [number, number, number, number];

/**
 * Every file under a folder (recursively).
 *
 * @param dir The folder.
 * @returns File paths.
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

/**
 * The custom properties declared in the first block whose selector list starts with `selector`.
 *
 * @param selector For example ':root {' or '.k-dark {'.
 * @returns Name → raw value.
 */
function block(selector: string): Map<string, string> {
  const start = THEME.indexOf(selector);
  if (start === -1) throw new Error(`no block ${selector}`);
  const body = THEME.slice(start, THEME.indexOf('}', start));
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1]!, match[2]!.trim());
  }
  return vars;
}

/** The semantic tokens (the first :root block). */
const ROOT = block(':root {');
/** The light surface tokens. */
const LIGHT = block(':root,\n.k-light {');
/** The dark surface tokens. */
const DARK = block('.k-dark {');
/** The see-through overlay's tokens. */
const GLASS = block('.k-overlay.k-glass {');

/**
 * Resolves a value to a colour, following var() references.
 *
 * @param value A raw value: '#18181b', 'rgba(…)', 'var(--k-text)' or a token name '--k-text'.
 * @param scope Tokens to look in first (a surface block), then ROOT.
 * @returns The colour.
 */
function resolve(value: string, scope: Map<string, string> = new Map()): Rgba {
  let current = value.trim();
  for (let i = 0; i < 10; i += 1) {
    const name =
      /^var\((--[\w-]+)\)$/.exec(current)?.[1] ?? (current.startsWith('--') ? current : null);
    if (!name) break;
    const next = scope.get(name) ?? ROOT.get(name);
    if (!next) throw new Error(`unknown token ${name}`);
    current = next.trim();
  }
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(current);
  if (hex) return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16), 1];
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(current);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`not a colour: ${value} → ${current}`);
}

/**
 * Paints one colour over another.
 *
 * @param top    The colour on top; its alpha decides how much shows through.
 * @param bottom The solid colour below.
 * @returns The solid result.
 */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + bottom[0] * (1 - a),
    top[1] * a + bottom[1] * (1 - a),
    top[2] * a + bottom[2] * (1 - a),
    1,
  ];
}

/**
 * WCAG relative luminance.
 *
 * @param colour A solid colour.
 * @returns 0 (black) to 1 (white).
 */
function luminance(colour: Rgba): number {
  const [r, g, b] = colour.slice(0, 3).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * WCAG contrast ratio.
 *
 * @param a One solid colour.
 * @param b The other.
 * @returns 1 to 21.
 */
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Pure white: the brightest thing a window could have behind it. */
const WHITE: Rgba = [255, 255, 255, 1];

/** The text tokens of a surface block. */
const TEXT_TOKENS = [
  '--ui-text',
  '--ui-heading',
  '--ui-subheading',
  '--ui-muted',
  '--ui-link',
  '--ui-success',
  '--ui-warning',
  '--ui-danger',
  '--ui-you',
  '--ui-them',
  '--ui-secondary',
];

describe('no colours outside theme.css', () => {
  it('finds no hex colour or rgb() in apps/web/src or apps/web/app except src/ui/theme.css', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const dir of ['src', 'app']) {
      for (const file of filesUnder(path.join(WEB_DIR, dir))) {
        if (path.resolve(file) === path.resolve(THEME_FILE)) continue;
        if (!/\.(tsx?|css|mjs|js)$/.test(file)) continue;
        scanned += 1;
        const text = readFileSync(file, 'utf8');
        for (const [i, line] of text.split('\n').entries()) {
          if (/#[0-9a-f]{3,8}\b/i.test(line) || /\brgba?\(/i.test(line)) {
            offenders.push(`${path.relative(WEB_DIR, file)}:${i + 1}`);
          }
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});

describe('only theme colours in class names', () => {
  it('finds no Tailwind palette or legacy brand-* colour class in apps/web/src or apps/web/app', () => {
    const offenders: string[] = [];
    // A colour utility with a palette name, for example bg-slate-100 or text-brand-700.
    const palette =
      /\b(?:bg|text|border|divide|ring|outline|fill|stroke|from|via|to|decoration|placeholder|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|brand)-\d{2,3}\b/;
    for (const dir of ['src', 'app']) {
      for (const file of filesUnder(path.join(WEB_DIR, dir))) {
        if (!/\.(tsx?|css)$/.test(file)) continue;
        for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
          if (palette.test(line)) offenders.push(`${path.relative(WEB_DIR, file)}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every ui-* colour class used in the app is defined in the theme', () => {
    const defined = new Set([...THEME.matchAll(/--color-(ui-[\w-]+):/g)].map((match) => match[1]!));
    const unknown: string[] = [];
    for (const dir of ['src', 'app']) {
      for (const file of filesUnder(path.join(WEB_DIR, dir))) {
        if (!/\.tsx$/.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/\b(?:bg|text|border|divide)-(ui-[a-z-]+)/g)) {
          if (!defined.has(match[1]!)) {
            unknown.push(`${path.relative(WEB_DIR, file)}: ${match[0]}`);
          }
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});

describe('the values in the brief', () => {
  it('has the light palette, radii and shadows that were asked for', () => {
    const expected: Record<string, string> = {
      '--k-page': '#f7f7f8',
      '--k-surface': '#ffffff',
      '--k-subtle': '#f2f2f4',
      '--k-border': '#e4e4e7',
      '--k-text': '#18181b',
      '--k-muted': '#71717a',
      '--k-primary': '#18181b',
      '--k-on-primary': '#ffffff',
      '--k-primary-hover': '#27272a',
      '--k-accent': '#2563eb',
      '--k-success': '#16a34a',
      '--k-warning': '#b45309',
      '--k-danger': '#dc2626',
      '--k-radius-control': '10px',
      '--k-radius-card': '16px',
      '--k-radius-modal': '20px',
      '--k-shadow-card': '0 1px 2px rgba(0, 0, 0, 0.05)',
      '--k-shadow-modal': '0 20px 40px rgba(0, 0, 0, 0.12)',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(ROOT.get(token), token).toBe(value);
    }
  });

  it('has the overlay values that were asked for', () => {
    const expected: Record<string, string> = {
      '--k-overlay-glass': 'rgba(24, 24, 27, 0.82)',
      '--k-overlay-border': 'rgba(255, 255, 255, 0.08)',
      '--k-overlay-button': 'rgba(255, 255, 255, 0.08)',
      '--k-overlay-button-hover': 'rgba(255, 255, 255, 0.14)',
      '--k-overlay-end': '#dc2626',
      '--k-overlay-blur': '16px',
      '--k-dark-text': '#fafafa',
      '--k-dark-muted': '#a1a1aa',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(ROOT.get(token), token).toBe(value);
    }
  });
});

describe('contrast of the theme tokens', () => {
  it('light text tokens are at least 4.5:1 on white and on the page', () => {
    for (const surface of ['--k-surface', '--k-page']) {
      for (const token of TEXT_TOKENS) {
        expect(
          contrast(resolve(token, LIGHT), resolve(surface)),
          `${token} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('body text is at least 4.5:1 on the subtle background; muted text is not, as the theme says', () => {
    expect(contrast(resolve('--k-text'), resolve('--k-subtle'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolve('--k-muted'), resolve('--k-subtle'))).toBeLessThan(4.5);
    expect(THEME).toContain('muted text is 4.3:1 on --k-subtle');
  });

  it('the success colour is for dots: its text token is the one that passes', () => {
    expect(contrast(resolve('--k-success'), WHITE)).toBeLessThan(4.5);
    expect(contrast(resolve('--k-success-text'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark text tokens are at least 4.5:1 on the dark background, surface and bar', () => {
    for (const surface of ['--k-dark-bg', '--k-dark-surface', '--k-dark-bar']) {
      const bg = resolve(surface);
      for (const token of TEXT_TOKENS) {
        expect(contrast(resolve(token, DARK), bg), `${token} on ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it('status text is at least 4.5:1 on its own light notice background, and body text too', () => {
    const texts: Record<string, string> = {
      success: '--k-success-text',
      warning: '--k-warning',
      danger: '--k-danger',
    };
    for (const [tone, token] of Object.entries(texts)) {
      const bg = resolve(`--k-${tone}-bg`);
      expect(contrast(resolve(token), bg), tone).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve('--k-text'), bg), `text on ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('primary buttons are at least 4.5:1, at rest and on hover, on light and dark', () => {
    expect(contrast(resolve('--k-on-primary'), resolve('--k-primary'))).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('--k-on-primary'), resolve('--k-primary-hover')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('--k-dark-on-primary'), resolve('--k-dark-primary')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('--k-dark-on-primary'), resolve('--k-dark-primary-hover')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('the focus ring is at least 3:1 on the surfaces around it', () => {
    expect(contrast(resolve('--k-accent'), WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve('--k-accent'), resolve('--k-page'))).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve('--k-dark-accent'), resolve('--k-dark-bg'))).toBeGreaterThanOrEqual(3);
  });
});

describe('overlay text over a busy background', () => {
  /** The panel at its lightest: the see-through colour over pure white. */
  const panel = over(resolve('--k-overlay-glass'), WHITE);
  /** A button on that panel, at rest and on hover. */
  const button = over(resolve('--k-overlay-button'), panel);
  const buttonHover = over(resolve('--k-overlay-button-hover'), panel);

  it('starts at full window opacity: the panel alone sets how see-through it is', () => {
    expect(OVERLAY_OPACITY.default).toBe(1);
  });

  it('every text token is at least 4.5:1 on the panel over pure white', () => {
    for (const token of TEXT_TOKENS) {
      const colour = resolve(token, new Map([...DARK, ...GLASS]));
      expect(contrast(colour, panel), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('text on the buttons is at least 4.5:1, at rest and on hover', () => {
    expect(contrast(resolve('--k-dark-text'), button)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolve('--k-dark-text'), buttonHover)).toBeGreaterThanOrEqual(4.5);
  });

  it('the solid buttons do not depend on what is behind them', () => {
    expect(
      contrast(resolve('--k-dark-on-primary'), resolve('--k-dark-primary')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('--k-overlay-on-end'), resolve('--k-overlay-end')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('dark backgrounds only help: every text token passes over pure black too', () => {
    const dark = over(resolve('--k-overlay-glass'), [0, 0, 0, 1]);
    for (const token of TEXT_TOKENS) {
      const colour = resolve(token, new Map([...DARK, ...GLASS]));
      expect(contrast(colour, dark), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the solid panel (picture-in-picture) keeps the muted grey that was asked for', () => {
    expect(contrast(resolve('--k-dark-muted'), resolve('--k-dark-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(resolve('--k-dark-muted'), panel)).toBeLessThan(4.5);
    expect(THEME).toContain("The spec's #a1a1aa is only 3.9:1 there");
  });
});
