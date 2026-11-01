# Kite UI theme — Paramount Intelligence brand

**Status:** approved direction, 30 Oct 2026. **Source:** design tokens read from the live site https://www.paramountintelligence.co/ (`:root` CSS variables and computed styles of its buttons, cards and sections). Kite will live at `kite.paramountintelligence.co`, so it must look like part of the company site.

Contrast ratios below were computed (WCAG 2.x). Body text must be ≥ 4.5:1, large text and icons ≥ 3:1.

## 1. The look in one paragraph
Deep navy, one bright cyan action colour, Montserrat, and **square corners everywhere** (the site uses `border-radius: 0` on buttons, cards and bars). Flat surfaces with thin 1 px borders, no drop shadows. Light grey bands (`#f3f3f3`) alternate with white on content pages. Small uppercase **IBM Plex Mono** labels for eyebrows, timestamps, shortcuts and numbers. Copy is short, plain and confident.

## 2. Where light and dark are used
| Screen | Theme | Why |
|---|---|---|
| Live call view, compact overlay, PiP | **Dark** (navy) | Low glare during calls; matches the site's dark hero sections |
| Sign-in | Dark hero panel + light form card | Matches site hero |
| Dashboard, wizard, documents, settings, admin, review | **Light** | Matches site content pages |

(A full dark mode for the light pages is optional, Day 6 polish, using the dark tokens below.)

## 3. Tokens (copy into `apps/web/src/ui/theme.css`; the only file allowed to contain hex colours)

```css
/* Brand tokens, copied from paramountintelligence.co :root (30 Oct 2026). */
:root {
  /* Navy scale */
  --pi-navy-900: #060d1a; --pi-navy-800: #0d1f3c; --pi-navy-700: #152d56;
  --pi-navy-600: #1b3a6b; --pi-navy-500: #1e4d8c;
  /* Blues */
  --pi-blue-500: #1e6fd9; --pi-blue-400: #3b88f5; --pi-blue-300: #6ba8ff;
  --pi-royal: #204ecf; --pi-navy: #0f256e; --pi-cyan: #09b6f9;
  /* Silvers / neutrals */
  --pi-silver-400: #8fa4c4; --pi-silver-300: #b5c8e2; --pi-silver-200: #d4e0f0; --pi-silver-100: #eef3fa;
  --pi-text: #2b3245; --pi-muted: #646c7e; --pi-line: #d9dbe0; --pi-band: #f3f3f3; --pi-pale: #eaf1ff;
  --pi-on-dark: #c9d4f2; --pi-on-dark-2: #9fb3e8;
  /* Status (site has green + amber; red is a Kite addition) */
  --pi-green: #3dbe8b; --pi-amber: #f5b83d;

  /* ---- Kite semantic tokens: LIGHT pages ---- */
  --k-bg: #ffffff;            --k-band: var(--pi-band);
  --k-surface: #ffffff;       --k-border: var(--pi-line);
  --k-text: var(--pi-text);   /* 12.8:1 on white */
  --k-heading: var(--pi-navy-800);
  --k-subheading: var(--pi-royal); /* 6.9:1 */
  --k-muted: var(--pi-muted); /* 5.3:1 on white, 4.75:1 on band */
  --k-link: var(--pi-blue-500); /* 4.85:1 */
  --k-success-text: #17784f;  /* 5.5:1 — --pi-green is too light for text on white (2.35:1) */
  --k-warning-text: #8a5a0b;  /* 5.9:1 */
  --k-danger-text: #b42d2d;   /* 6.3:1 */
  --k-you: #0a79ab;           /* "You" label on light, 4.8:1 (cyan text on white fails at 2.3:1) */
  --k-them: var(--pi-royal);

  /* ---- Kite semantic tokens: DARK surfaces (live view, overlay) ---- */
  --k-dark-bg: var(--pi-navy-800);
  --k-dark-bar: var(--pi-navy-900);
  --k-dark-surface: var(--pi-navy-700);
  --k-dark-border: rgba(201, 212, 242, 0.14);
  --k-dark-text: var(--pi-on-dark);        /* 11.1:1 */
  --k-dark-strong: #ffffff;
  --k-dark-muted: var(--pi-on-dark-2);     /* 7.9:1 */
  --k-dark-provisional: var(--pi-silver-400); /* grey, still-changing transcript words, 6.5:1 */
  --k-dark-you: var(--pi-cyan);            /* 7.1:1 */
  --k-dark-them: var(--pi-blue-300);       /* 6.8:1 */
  --k-dark-success: var(--pi-green);       /* 7.0:1 */
  --k-dark-warning: var(--pi-amber);       /* 9.2:1 */
  --k-dark-danger: #ff7a7a;                /* 6.5:1 */
  --k-hero-gradient: linear-gradient(160deg, #060d1a, #0d1f3c 40%, #152d56 80%, #0d1f3c);

  /* ---- Shape, type, spacing ---- */
  --k-radius: 0;              /* signature: square corners */
  --k-border-w: 1px;
  --k-font: var(--font-montserrat), "Montserrat", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --k-mono: var(--font-plex-mono), "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace;
  --k-focus: 0 0 0 2px var(--pi-cyan); /* visible on light and dark */
  --k-dur: 150ms;
}
```

## 4. Typography
- Load with `next/font/google`: **Montserrat** 400 / 600 / 700 and **IBM Plex Mono** 400 / 500, exposed as `--font-montserrat` and `--font-plex-mono`. (next/font self-hosts at build time: no request to Google from users' browsers.)
- Page title 28 px / 700 / `--k-heading`. Section heading 20 px / 400 / `--k-subheading` (the site's h2 style). Body 15–16 px / 400, line-height 1.6. Small 13 px.
- **Eyebrow / label:** IBM Plex Mono, 11–12 px, uppercase, letter-spacing 0.08em, `--k-muted` (or `--k-dark-muted`). Used for: "YOU" / "THEM", timestamps, latency ("ANSWER · 0.9 S"), keyboard shortcuts, status.
- Numbers in metrics and the review page use the mono font.

## 5. Components
| Component | Spec (from the site unless marked Kite) |
|---|---|
| **Primary button** | bg `--pi-cyan`, text `--pi-navy` (6.0:1), 600 weight, 13.5 px, padding 11px 18px, radius 0, `box-shadow: inset 0 -3px 0 rgba(15,37,110,.18)`. Hover: bg `#2cc2fa`. **One per view.** Used for Answer, New session, Connect, Save. |
| **Secondary on dark** | transparent, white text, `1px solid rgba(255,255,255,.55)`, padding 10px 18px (site 14px 24px, smaller for the app). Hover: border white. |
| **Secondary on light** (Kite) | transparent, text `--pi-navy`, `1px solid --pi-navy`. Hover: bg `--pi-pale`. |
| **Text button / link** | `--k-link`, underline on hover. |
| **Danger button** (Kite) | transparent, `--k-danger-text`, 1px border same colour. Delete actions only. |
| **Card** | bg white, `1px solid --pi-line`, padding 24px (site 26px), radius 0, no shadow. Title in `--k-subheading`. |
| **Section band** | alternate white and `--pi-band` backgrounds on long pages (dashboard, review). |
| **Input / textarea / select** (Kite; site has none) | white bg, `1px solid --pi-line`, radius 0, padding 10px 12px, focus: border `--pi-blue-500` + `--k-focus`. On dark: bg `--pi-navy-900`, border `--k-dark-border`, text `--k-dark-text`. Labels: mono eyebrow style. |
| **Top bar / nav** | light pages: white at 95 % opacity with `backdrop-filter: blur(8px)`, 1px bottom border `--pi-line` (like the site header). Dark views: `--k-dark-bar`. |
| **Sidebar** (Kite) | `--pi-navy-900` bg, `--k-dark-text` items, active item: 3px left bar `--pi-cyan` + white text. |
| **Badge / status** | mono label with a 6px square dot (square, matching the corners): green Connected, amber Warming / Reconnecting, red Error. |
| **Modal** | white, 1px border, radius 0, backdrop `rgba(6,13,26,.6)`. |
| **Focus** | every interactive element shows `--k-focus` on `:focus-visible`. |

## 6. Kite-specific screens
- **Live view (dark):** top bar `--k-dark-bar` with logo, session name (mono), status. Transcript left, answer panel right (stack on narrow widths).
  - Speaker labels: mono uppercase, **You** `--k-dark-you` (cyan), **Them** `--k-dark-them` (blue-300). Final text `--k-dark-text`; provisional words `--k-dark-provisional` italic.
  - Answer panel: mono eyebrow "ANSWER · 0.9 S"; 3px cyan left bar; headline 15–16 px / 700 white; body 13–14 px `--k-dark-text`.
  - Action row: one primary (Answer), others secondary-on-dark; shortcut hints in mono.
- **Compact overlay / PiP:** same dark tokens, headline only + body on expand; 12–13 px; no decoration.
- **Sign-in:** left/top hero with `--k-hero-gradient`, white heading in the site's voice ("Answers while you talk." style), right/bottom white form card.
- **Empty states:** headline + one line + one primary button, e.g. "Start your first session".

## 7. Brand assets
- Download the company's own logo files from the site into `apps/web/public/brand/`: `https://www.paramountintelligence.co/logo-mark.png` and `/logo-icon.png` (ask Zain if missing or if an SVG exists).
- Product lockup: logo mark + "Kite" (Montserrat 700) + optional small mono "by Paramount Intelligence".
- Favicon and Electron app icon from `logo-icon`. Installers need 512 px and 1024 px PNGs (and `.ico` / `.icns`); if only 256 px exists, ask Zain for a larger source before Day 6 packaging.

**As built (stage U4, 31 Oct 2026):**
- **Source:** the site's `logo-mark.png` (216 × 304, transparent), copied to `apps/web/public/images/`, beside the original `company-logo.jpg` (204 × 192 JPEG on white, kept unchanged). No SVG exists. A trace to SVG (imagetracerjs, 16 and 64 colours) did not match: the gradients turn into bands with gaps, so the PNG is kept. **The designer's vector original is needed.**
- **Generated** by `pnpm --filter web make-brand` (`scripts/make-brand.ts`; sharp from Next.js, no new dependency), the mark only scaled and centred:
  - `apps/web/public/brand/`: `logo-mark.png`, `favicon.ico` (16/32/48), `favicon.svg` (wraps the 256 px PNG until a vector exists), `apple-touch-icon.png` (180, on white), `icon-16/32/48/256.png`;
  - `apps/desktop/build/`: `icon.ico` (16 to 256), `icon.png` (the window icon), `icon-512.png` and `icon-1024.png`. The last two are scaled up from the 304 px source, so they are soft.
- **Dark backgrounds** (decided 31 Oct: keep for v1): the site only shows the mark on white and has no light version, so on dark surfaces (sidebar, sign-in hero, live view, compact window) the mark sits on a small white tile (`--k-logo-tile`).
- **Small sizes** (decided 31 Oct): the 16, 24, 32 and 48 px icons (favicon, the small `.ico` entries) and `favicon.svg` put the mark on the same white square tile, so it shows on dark taskbars and dark browser tabs. 64 px and larger are transparent.
- **512 and 1024 px** stay placeholders until the designer's vector arrives (Day 6 checklist).
- **Lockup:** `src/ui/BrandLockup.tsx` (tone light or dark; sizes xs to lg).

## 8. Rules for implementation
1. All colours, radii and fonts come from `theme.css` tokens. A unit test fails if any other file under `apps/web/src` or `apps/web/app` contains a hex colour (`#[0-9a-f]{3,8}`) or `rgb(`.
2. A unit test computes the contrast of each token pair listed in §3 and fails below 4.5:1 for text.
3. Square corners: no `border-radius` except for round avatars/speaker dots if ever added.
4. No new UI library. Restyle the existing `src/ui/` components (Button, Input, Card, Badge, Sidebar, …).
5. Keep comments to the CLAUDE.md standard; reference this file in each themed component's header.

## 9. Stages (slot in before Day 6 packaging, since the installers need the icons)
| Stage | Work | Gate |
|---|---|---|
| U1 Tokens + base components | `theme.css`, fonts via next/font, restyle `src/ui/*`, `/dev/ui` page showing every component in light and dark | Hex-colour and contrast tests pass; Playwright screenshots of `/dev/ui` at 1440 px and 390 px attached in the report |
| U2 Light pages | Sign-in, dashboard, wizard, documents, settings, admin, review | Existing e2e suites pass; screenshots of each page at 1440 and 390 px |
| U3 Dark live view + overlay | Live view, compact overlay, PiP, answer panel, transcript colours | Answer harness + e2e pass; screenshots; no layout shift while answers stream |
| U4 Brand assets + polish | Logo, favicon, Electron icon, empty states, focus states, keyboard pass | Desktop smoke test shows the new icon; one batched human check by Zain: "does it look like our site?" |
