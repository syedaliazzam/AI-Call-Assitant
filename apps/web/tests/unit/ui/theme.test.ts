/**
 * Tests for apps/web/src/ui/tokens/theme.css and the theme rules (docs/design/kite-ui-theme.md §8):
 * - no file under apps/web/src or apps/web/app other than src/ui/tokens/theme.css contains a hex
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
import { OVERLAY_OPACITY, paintedPanelAlpha } from '@/core/storage/overlayPrefs';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The theme file. */
const THEME_FILE = path.join(WEB_DIR, 'src', 'ui', 'tokens', 'theme.css');

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
const DARK = block(".k-dark,\nhtml[data-theme='dark'] {");
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
  it('finds no hex colour or rgb() in apps/web/src or apps/web/app except src/ui/tokens/theme.css', () => {
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
      '--k-page': '#ffffff',
      '--k-sidebar': '#fafafa',
      '--k-surface': '#ffffff',
      '--k-subtle': '#f4f4f5',
      '--k-border': '#e4e4e7',
      '--k-text': '#18181b',
      '--k-muted': '#71717a',
      '--k-primary': '#18181b',
      '--k-on-primary': '#ffffff',
      '--k-primary-hover': '#27272a',
      '--k-accent': '#16a34a',
      '--k-success': '#16a34a',
      '--k-warning': '#b45309',
      '--k-danger': '#dc2626',
      '--k-radius-control': '10px',
      '--k-radius-card': '16px',
      '--k-radius-modal': '20px',
      '--k-radius-session': '48px',
      '--k-radius-session-panel': '32px',
      '--k-radius-tab': '14px',
      '--k-radius-menu': '14px',
      '--k-radius-bar': '12px',
      '--k-shadow-card': 'none',
      '--k-shadow-modal': '0 8px 30px rgba(0, 0, 0, 0.08)',
      '--k-on-accent': '#fafafa',
      '--k-dot-ended': '#a1a1aa',
      '--k-dot-recording': '#ef4444',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(ROOT.get(token), token).toBe(value);
    }
  });

  it('has the overlay values that were asked for', () => {
    const expected: Record<string, string> = {
      // 1.6.3 (ADR-0075): darker and nearly solid.
      '--k-overlay-glass': 'rgba(17, 17, 20, 0.976)',
      '--k-overlay-pill': 'rgba(39, 39, 42, 0.95)',
      '--k-overlay-keycap': 'rgba(255, 255, 255, 0.16)',
      '--k-overlay-border': 'rgba(255, 255, 255, 0.08)',
      '--k-overlay-button': 'rgba(255, 255, 255, 0.08)',
      '--k-overlay-button-hover': 'rgba(255, 255, 255, 0.14)',
      '--k-overlay-end': '#dc2626',
      '--k-overlay-blur': '16px',
      '--k-dark-bg': '#0f0f11',
      '--k-dark-bar': '#141417',
      '--k-dark-surface': '#1c1c20',
      '--k-dark-border': '#2a2a30',
      '--k-dark-text': '#f4f4f5',
      '--k-dark-muted': '#a1a1aa',
      '--k-dark-primary': '#f4f4f5',
      '--k-dark-on-primary': '#18181b',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(ROOT.get(token), token).toBe(value);
    }
  });
});

describe('v1.3.1 colours and motion (ADR-0058)', () => {
  it('has the green accent and the neutral values that were asked for', () => {
    const expected: Record<string, string> = {
      '--k-accent': '#16a34a',
      '--k-on-accent': '#fafafa',
      '--k-accent-hover': '#15803d',
      '--k-accent-soft': '#f0fdf4',
      '--k-strong': '#09090b',
      '--k-card-inner': '#f6f6f7',
      '--k-dark-accent': '#22c55e',
      '--k-overlay-indicator': '#22c55e',
      '--k-overlay-text': '#ffffff',
      '--k-overlay-solid': '#18181b',
      // 1.6.3 (ADR-0075): a step lighter (was #a1a1aa).
      '--k-glass-muted': '#c4c4cc',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(ROOT.get(token), token).toBe(value);
    }
    // No blue accent left in the theme (the company letter tiles keep their blue, --k-tile-0).
    expect(THEME).not.toMatch(/#2563eb|#60a5fa|#a5cbfd|#1e3a8a|rgba\(37, 99, 235/i);
  });

  it('keeps green text readable: links and "You" use the darker green, which passes AA', () => {
    expect(LIGHT.get('--ui-link')).toBe('var(--k-accent-text)');
    expect(LIGHT.get('--ui-you')).toBe('var(--k-accent-text)');
    expect(contrast(resolve('--k-accent-text'), WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  it('pins the AA failures the developer kept, so a change to them is noticed (ADR-0058)', () => {
    // Near-white label on the green button: 3.16:1 (AA for large text only).
    const label = contrast(resolve('--k-on-accent'), resolve('--k-accent'));
    expect(label).toBeGreaterThan(3);
    expect(label).toBeLessThan(4.5);
    // Muted text on the card's inner panel: 4.47:1.
    const muted = contrast(resolve('--k-muted'), resolve('--k-card-inner'));
    expect(muted).toBeGreaterThan(4.4);
    expect(muted).toBeLessThan(4.5);
    // The green itself is a fill, dot, icon and ring colour: at least 3:1 (non-text) on white.
    expect(contrast(resolve('--k-accent'), WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('has every motion value as a token, and turns them off under "reduce motion"', () => {
    const motion: Record<string, string> = {
      '--k-dur': '150ms',
      '--k-dur-slow': '200ms',
      '--k-press-scale': '0.98',
      '--k-enter-scale': '0.98',
      '--k-slide': '4px',
      '--k-toast-ms': '3000',
    };
    for (const [token, value] of Object.entries(motion)) {
      expect(ROOT.get(token), token).toBe(value);
    }
    const reduce = THEME.slice(THEME.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toContain('--k-dur: 0ms;');
    expect(reduce).toContain('--k-dur-slow: 0ms;');
    expect(reduce).toContain('--k-press-scale: 1;');
    expect(reduce).toContain('--k-slide: 0px;');
  });

  it('finds no hard-coded animation time in a component (they use the motion tokens)', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(path.join(WEB_DIR, 'src'))) {
      if (!/\.tsx$/.test(file)) continue;
      for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
        // The live level bars follow the sound every 100 ms: a meter, not an animation.
        if (/\bduration-(?:150|200|300)\b/.test(line)) {
          offenders.push(`${path.relative(WEB_DIR, file)}:${i + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('contrast of the overlay in the light theme (v1.1.0, ADR-0041)', () => {
  it('the glass text tokens reach 4.5:1 over a dark background at the default opacity', () => {
    // The worst case for dark text on light glass: pure black behind the panel.
    const alpha = OVERLAY_OPACITY.default;
    const pane = [247, 247, 248].map((channel) => Math.round(channel * alpha));
    const surface: Rgba = [pane[0]!, pane[1]!, pane[2]!, 1];
    const themeVars = block(':root {');
    for (const token of [
      '--k-glass-light-muted',
      '--k-glass-light-accent',
      '--k-glass-light-success',
      '--k-glass-light-warning',
      '--k-glass-light-danger',
      '--k-text',
    ]) {
      const raw = themeVars.get(token);
      expect(raw, token).toBeTruthy();
      expect(contrast(resolve(token), surface), token).toBeGreaterThanOrEqual(4.5);
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
    expect(THEME).toContain('muted text is 4.4:1 on --k-subtle');
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

  it('white letters are at least 4.5:1 on every letter tile', () => {
    for (let tile = 0; tile < 8; tile += 1) {
      expect(contrast(WHITE, resolve(`--k-tile-${tile}`)), `tile ${tile}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it('the focus ring is at least 3:1 on the surfaces around it', () => {
    expect(contrast(resolve('--k-accent'), WHITE)).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve('--k-accent'), resolve('--k-page'))).toBeGreaterThanOrEqual(3);
    expect(contrast(resolve('--k-dark-accent'), resolve('--k-dark-bg'))).toBeGreaterThanOrEqual(3);
  });
});

describe('overlay panel background opacity (ADR-0033)', () => {
  /** Pure black and a busy mid-grey, the other backgrounds a meeting could show behind the panel. */
  const BLACK: Rgba = [0, 0, 0, 1];
  const BUSY: Rgba = [128, 128, 128, 1];
  /**
   * The glass panel painted at a background-opacity over a background behind the window.
   *
   * @param alpha The panel's background opacity (0.4–1).
   * @param bg    The solid colour behind the window.
   * @returns The panel's resulting solid colour.
   */
  // 1.6.3 (ADR-0075): the darker base, painted at paintedPanelAlpha() of the setting.
  const panelAt = (alpha: number, bg: Rgba): Rgba =>
    over([17, 17, 20, paintedPanelAlpha(alpha)], bg);
  const glassScope = new Map([...DARK, ...GLASS]);
  const text = resolve('--ui-text', glassScope);
  const them = resolve('--ui-them', glassScope);

  it('defaults to 82% background opacity (spec §1), with 40% the minimum and 100% the maximum', () => {
    expect(OVERLAY_OPACITY.default).toBe(0.82);
    expect(OVERLAY_OPACITY.min).toBe(0.4);
    expect(OVERLAY_OPACITY.max).toBe(1);
  });

  it('dims the panel background (a variable alpha), never the text, and adds a text shadow', () => {
    expect(THEME).toContain('background: rgba(17, 17, 20, var(--k-overlay-alpha, 0.976))');
    expect(THEME).toContain('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6)');
  });

  it('at the default (70%) the primary text stays readable over the worst case, pure white', () => {
    // body 6.26:1, them 5.15:1 (computed from theme.css).
    expect(contrast(text, panelAt(0.7, WHITE))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(them, panelAt(0.7, WHITE))).toBeGreaterThanOrEqual(4.5);
  });

  it('over a dark background every text token passes at both the default and the minimum', () => {
    // A dark background only helps: the panel stays near black whatever the opacity.
    for (const alpha of [OVERLAY_OPACITY.default, OVERLAY_OPACITY.min]) {
      for (const token of TEXT_TOKENS) {
        const colour = resolve(token, glassScope);
        expect(
          contrast(colour, panelAt(alpha, BLACK)),
          `${token} @${alpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('at the default the primary text passes over a busy background too', () => {
    // body 11.3:1, them 9.3:1 over a mid-grey at 0.7 (the full per-token table is in ADR-0033).
    expect(contrast(text, panelAt(0.7, BUSY))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(them, panelAt(0.7, BUSY))).toBeGreaterThanOrEqual(4.5);
    // At the minimum, the primary text still passes over the busy mid-grey (body 6.98:1).
    expect(contrast(text, panelAt(0.4, BUSY))).toBeGreaterThanOrEqual(4.5);
  });

  it('1.6.3 (ADR-0075): at any setting, over pure white, every text token passes (nearly solid)', () => {
    // ADR-0033 had the body text at ~2.4:1 at the 40 % minimum over white; the developer found the
    // panels too see-through, so the setting now paints 92–100 % on a darker base.
    for (const alpha of [OVERLAY_OPACITY.min, OVERLAY_OPACITY.default, OVERLAY_OPACITY.max]) {
      for (const token of TEXT_TOKENS) {
        const colour = resolve(token, glassScope);
        expect(
          contrast(colour, panelAt(alpha, WHITE)),
          `${token} @${alpha}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The secondary words ("Listening…", "Press Answer…") at 7:1 or more at the default.
    expect(contrast(resolve('--ui-muted', glassScope), panelAt(0.82, WHITE))).toBeGreaterThan(7);
  });

  it('the solid buttons and the solid picture-in-picture panel do not depend on the background', () => {
    expect(
      contrast(resolve('--k-dark-on-primary'), resolve('--k-dark-primary')),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(resolve('--k-overlay-on-end'), resolve('--k-overlay-end')),
    ).toBeGreaterThanOrEqual(4.5);
    // The picture-in-picture panel is solid --k-dark-bg (nothing shows through it).
    expect(contrast(resolve('--k-dark-muted'), resolve('--k-dark-bg'))).toBeGreaterThanOrEqual(4.5);
  });
});
