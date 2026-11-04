# Kite UI theme: neutral and minimal

**Status:** current, 3 Nov 2026 (ADR-0031). Replaces the navy and cyan brand theme of 30 Oct 2026. Layout, flow and hotkeys did not change; the Kite logo stays.

Contrast ratios are computed (WCAG 2.x) and tested. Text must be at least 4.5:1, focus rings and icons at least 3:1.

## 1. The look in one paragraph
Neutral greys, one blue accent for links and focus, Inter, soft radii, thin borders and very faint shadows. One solid button per view. Status is a small dot with words, not a coloured block.

## 2. Where light and dark are used
| Screen | Theme | Why |
|---|---|---|
| Dashboard, wizard, libraries, Ask Kite, Prepare, settings, admin, review, sidebar | **Light** | The working pages |
| Home panel, overlay, call window (v1.1.0) | **The one Theme setting**: Light, Dark or System (the default) | They sit beside a meeting, so they follow what the person chose |
| Sign-in | Dark panel beside a light form card | Same layout as before, in neutral colours |
| Connect view | **Dark** | Low glare during calls |
| Overlay in the desktop app | **See-through** (`k-glass`), in either theme | Sits on top of the meeting |
| Overlay in browser picture-in-picture | **Solid**, in either theme | Nothing can show through this window |

## 3. Tokens
All values are in `apps/web/src/ui/theme.css`, the only file allowed to contain colours.

**Light**

| Use | Value |
|---|---|
| Page / surface / subtle | `#F7F7F8` / `#FFFFFF` / `#F2F2F4` |
| Border | `#E4E4E7` |
| Text / muted | `#18181B` / `#71717A` |
| Primary button / its text / hover | `#18181B` / `#FFFFFF` / `#27272A` |
| Secondary button | white with a `#E4E4E7` border |
| Accent and focus | `#2563EB` |
| Success dot / success text | `#16A34A` / `#15803D` |
| Warning, danger | `#B45309`, `#DC2626` |

**Dark (live view)**

| Use | Value |
|---|---|
| Background / bar / surface / raised | `#18181B` / `#111113` / `#27272A` / `#3F3F46` |
| Text / muted | `#FAFAFA` / `#A1A1AA` |
| Primary button / its text / hover | `#FFFFFF` / `#18181B` / `#E4E4E7` |
| You / Them | `#60A5FA` / `#D4D4D8` |
| Success, warning, danger | `#4ADE80`, `#FBBF24`, `#F87171` |

**Overlay**

| Use | Value |
|---|---|
| Panel | `rgba(24,24,27,α)`, blurred (desktop); α is the opacity slider, 0.4–1, default 0.7 (ADR-0033). `#18181B` solid (picture-in-picture) |
| Border | `rgba(255,255,255,.08)` |
| Text / secondary | `#FAFAFA` / `#A1A1AA` on the solid panel, `#B4B4BB` on glass |
| Buttons | `rgba(255,255,255,.08)`, hover `.14` |
| Primary button | white with `#18181B` text |
| End | `#DC2626` with white text |
| Radius | 16 px |
| Key hints | rounded chips |

**Shape and shadow**

| Use | Value |
|---|---|
| Radius | controls 10 px, cards 16 px, modals 20 px, pills full |
| Card shadow | `0 1px 2px rgba(0,0,0,.05)` |
| Modal shadow | `0 20px 40px rgba(0,0,0,.12)` |

**Limits to remember** (each is tested)
- Muted text is 4.3:1 on the subtle background, so text there uses the body colour.
- `#16A34A` is 3.3:1 on white: dots only.
- On glass, text is checked over pure white, the worst case. That is why glass has its own lighter colours. The opacity slider dims only the panel background, never the text (ADR-0033); at the default 0.7 the primary text is 6.3:1 over white, and a text shadow carries legibility at lower settings.

## 4. Typography
Inter only, in 400, 500 and 600, self-hosted through `next/font` (no request to Google from users' browsers).

| Style | Size / weight |
|---|---|
| Page title | 24 / 600 |
| Section heading | 18 / 600 |
| Body | 15 / 400 |
| Small, labels | 13 |

Two sizes sit outside this scale on purpose: overlay answers stay at 16 to 18 px so they can be read at a glance during a call (ADR-0029), and overlay key chips are 12 px so the top bar fits its default width.

## 5. Components
| Component | Spec |
|---|---|
| **Primary button** | Solid, 500 weight. One per view. |
| **Secondary button** | White with a thin border; outlined on dark surfaces. |
| **Ghost button** | Text only, subtle background on hover. |
| **Danger button** | Danger colour text and border. Delete actions only. |
| **Card** | Surface, 1 px border, card radius and shadow. |
| **Input, textarea, select** | Control radius, 1 px border, accent focus ring. Labels are small and muted. |
| **Modal** | Modal radius and shadow, dim backdrop. |
| **Chip** | Pill, subtle background, body-colour text. |
| **Status** | Round dot with words. |
| **Focus** | Every interactive element shows the accent ring on `:focus-visible`. |

## 6. Screens
- **Sidebar:** white. Groups "Call assistant" (Create session, Call sessions, Resumes, Documents, Ask Kite) and "Prepare" (Question bank, Mock interview), then Settings and the admin links. A collapse toggle leaves icons only and is remembered per browser. The profile block has an initial, name, email, sign out and "Browser" or "Desktop app".
- **Dashboard:** a dismissible desktop-app banner (browser only). Session cards show the date, an initial avatar, company, role, chips and a status dot.
- **Choose platform:** two large choices (Desktop app, Open in browser) and "What's the difference?".
- **Wizard step 1:** in create mode, a left panel with View tutorial and three mock presets.
- **Upload:** a button opens a drag-and-drop window. Files can also be dropped on the row.
- **Wizard step 2:** rows with icons: Language, Model (Fast or Accurate; stored as `fast` and `smart`), Answer preferences (Configure), AI instructions (Add or Edit). Then Extra: Auto-answer (beta), Save transcript with a consent note, and key terms.
- **Answer preferences:** two panes: choices on the left, preview on the right; stacked on a phone.
- **Overlay (v1.1.0, ADR-0041):** slim bars with panels under them, each its own rounded piece of glass with a small gap between. See ADR-0031 for how the blur works on each system. Text on light glass reaches 4.5:1 over a black background at the default opacity (`--k-glass-light-*`).
- **Home panel (v1.1.0):** header, search and sort, session cards (date, title, description, chips, status, action), two buttons at the bottom. The menus (`ui/PanelMenu.tsx`) stay inside their window, with no native select.
- **Empty states:** a headline, one line, one primary button.

## 7. Brand assets
- **Source:** the company's `logo-mark.png` (216 × 304, transparent), in `apps/web/public/images/`. No vector exists yet, **so the designer's original is still needed.**
- **Generated** by `pnpm --filter web make-brand` (`scripts/make-brand.ts`):
  - `apps/web/public/brand/`: logo mark, favicons and the Apple touch icon;
  - `apps/desktop/build/`: `icon.ico`, `icon.png`, `icon-512.png` and `icon-1024.png`. The last two are scaled up from the 304 px source, so they are soft.
- **Dark backgrounds:** the mark has no light version, so it sits on a small white tile (`--k-logo-tile`).
- **Small icons:** 16 to 48 px and `favicon.svg` use the same white tile, so they show on dark taskbars and tabs.
- **Lockup:** `src/ui/BrandLockup.tsx` (tone light or dark; sizes xs to lg).

## 8. Rules for implementation
1. All colours, radii and shadows come from `theme.css`. A unit test fails if another file under `apps/web/src` or `apps/web/app` contains a hex colour or `rgb(`, or uses a `ui-*` colour class the theme does not define.
2. A unit test checks the values above and the contrast of every text token, including overlay text over pure white and pure black.
3. No new UI library. Restyle the existing `src/ui/` components.
4. Keep comments to the CLAUDE.md standard.

## 9. How to check it
| Gate | Command |
|---|---|
| Tokens and contrast | `pnpm --filter @kite/web exec vitest run tests/unit/ui` |
| Overlay over busy backgrounds | `pnpm --filter @kite/web test:live-ui` |
| Every page at 1440 and 390 px, and the keyboard pass | `pnpm --filter @kite/web test:ui-shots` (a running Kite, `KITE_SCREENSHOT_DIR` set, admin test account enabled for the run) |
