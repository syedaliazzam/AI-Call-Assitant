/**
 * Tests for apps/web/src/ui/theme.css and the theme rules (docs/design/kite-ui-theme.md §8):
 * - no file under apps/web/src or apps/web/app other than src/ui/theme.css contains a hex
 *   colour or rgb()/rgba(), and no class uses a Tailwind palette or the removed brand-* colours;
 * - contrast (WCAG 2.x) of every text token on the surfaces it is used on, read from theme.css
 *   itself (variables resolved): light tokens on white and on the grey band, dark tokens on
 *   the dark background, surface and bar, and navy on the cyan primary button: at least
 *   4.5:1. The two documented exceptions (the link and the "You" label are for white
 *   surfaces only, 4.37:1 and 4.36:1 on the band) are checked on white only, and the theme
 *   file says so.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The theme file. */
const THEME_FILE = path.join(WEB_DIR, 'src', 'ui', 'theme.css');

/** The theme file's text. */
const THEME = readFileSync(THEME_FILE, 'utf8');

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

/** The brand and semantic tokens (the first :root block). */
const ROOT = block(':root {');
/** The light surface tokens. */
const LIGHT = block(':root,\n.k-light {');
/** The dark surface tokens. */
const DARK = block('.k-dark {');

/**
 * Resolves a value to a six-digit hex colour, following var() references.
 *
 * @param value A raw value: '#09b6f9', 'var(--pi-cyan)' or a token name '--pi-cyan'.
 * @param scope Tokens to look in first (a surface block), then ROOT.
 * @returns The colour as '#rrggbb'.
 */
function resolve(value: string, scope: Map<string, string> = new Map()): string {
  let current = value.trim();
  for (let i = 0; i < 10; i += 1) {
    const name =
      /^var\((--[\w-]+)\)$/.exec(current)?.[1] ?? (current.startsWith('--') ? current : null);
    if (!name) break;
    const next = scope.get(name) ?? ROOT.get(name);
    if (!next) throw new Error(`unknown token ${name}`);
    current = next.trim();
  }
  if (!/^#[0-9a-f]{6}$/i.test(current))
    throw new Error(`not a solid hex colour: ${value} → ${current}`);
  return current.toLowerCase();
}

/**
 * WCAG relative luminance of a hex colour.
 *
 * @param hex '#rrggbb'.
 * @returns 0 (black) to 1 (white).
 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * WCAG contrast ratio.
 *
 * @param a One colour.
 * @param b The other.
 * @returns 1 to 21.
 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

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
});

describe('contrast of the theme tokens', () => {
  it('light text tokens are at least 4.5:1 on white', () => {
    const white = resolve('--k-surface');
    for (const token of TEXT_TOKENS) {
      expect(contrast(resolve(token, LIGHT), white), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('light text tokens are at least 4.5:1 on the grey band, except the link and You (white only)', () => {
    const band = resolve('--k-band');
    for (const token of TEXT_TOKENS.filter((t) => t !== '--ui-link' && t !== '--ui-you')) {
      expect(contrast(resolve(token, LIGHT), band), token).toBeGreaterThanOrEqual(4.5);
    }
    // The exceptions are real, and the theme file tells developers about them.
    expect(contrast(resolve('--ui-link', LIGHT), band)).toBeLessThan(4.5);
    expect(THEME).toContain('use links and the "You" label on white surfaces only');
  });

  it('dark text tokens are at least 4.5:1 on the dark background, surface and bar', () => {
    for (const surface of ['--k-dark-bg', '--k-dark-surface', '--k-dark-bar']) {
      const bg = resolve(surface);
      for (const token of TEXT_TOKENS) {
        expect(contrast(resolve(token, DARK), bg), `${token} on ${surface}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
      expect(contrast(resolve('--k-dark-provisional'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status text is at least 4.5:1 on its own light notice background, and body text too', () => {
    for (const tone of ['success', 'warning', 'danger']) {
      const bg = resolve(`--k-${tone}-bg`);
      expect(contrast(resolve(`--k-${tone}-text`), bg), tone).toBeGreaterThanOrEqual(4.5);
      expect(contrast(resolve('--k-text'), bg), `text on ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('navy text on the cyan primary button, and on its hover colour, is at least 4.5:1', () => {
    expect(contrast(resolve('--pi-navy'), resolve('--pi-cyan'))).toBeCloseTo(6.0, 1);
    expect(contrast(resolve('--pi-navy'), resolve('--k-primary-hover'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it('matches the ratios in the theme document', () => {
    expect(contrast(resolve('--k-text'), '#ffffff')).toBeCloseTo(12.8, 1);
    expect(contrast(resolve('--k-dark-you'), resolve('--k-dark-bg'))).toBeCloseTo(7.1, 1);
  });
});
