# ADR-0035: See-through overlay, placement and the script bar

- **Status:** Accepted (developer, 3 Nov 2026, v1.0.2)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (compact view), §7.3 (windows.ts, hotkeys.ts, preload.ts)
- **Supersedes / superseded by:** adjusts ADR-0029 (overlay window, default place and size), ADR-0031 (glass overlay) and ADR-0033 (panel opacity). The slider, its 40–100 % range, the 70 % default and the text shadow from ADR-0033 are unchanged. Amended by ADR-0126 (26 Nov 2026): no vibrancy on macOS either; plain transparency on every system.

## Context

On a real call the overlay showed nothing of the window behind it, although the page side was already right: under `.k-glass` the page's `html` and `body` are transparent and the panel paints `rgba(24, 24, 27, 0.7)` with a text shadow. Two causes sat in the desktop window:

1. **The clear background colour was ignored.** On Windows the overlay window had `backgroundColor: '#00000000'` and `backgroundMaterial: 'acrylic'`, but not `transparent: true`. Electron 44's own documentation for `backgroundColor`: "Alpha in #AARRGGBB format is supported if `transparent` is set to `true`." So the window painted an opaque background behind the page, and a 70 % panel over it looked solid.
2. **Acrylic is drawn for the focused window.** Windows appears to draw the acrylic system backdrop only while the window is active, and falls back to a solid tint otherwise. The overlay is deliberately shown without focus (`showInactive`), so the meeting keeps the keyboard; the overlay is therefore almost never the focused window, and the blur was almost never drawn. (The earlier measurement in `windows.ts` was made on a focused window.)

macOS was already set up correctly (`transparent: true`, `vibrancy: 'hud'`, `visualEffectState: 'active'`).

Alongside this, real calls asked for: a clear way to put the overlay back (no reset of size or position existed; the default was 720 × 520 at the bottom right), preset places, snapping to the screen's edges, and a slimmer mode that shows only what to say (ParakeetAI's layout, keeping Kite's own tokens).

## Decision

1. **See-through is the main effect; the blur is a bonus.** The overlay window is `transparent: true` on every system, with a clear background on Windows and Linux. Wherever the page paints nothing, the meeting shows; the panel's own background (70 % by default, the slider) and the text shadow keep the text readable over a busy window. Acrylic stays on Windows and vibrancy on macOS, so the blur appears where the system draws it (on Windows: mostly while the user is clicking or typing in the overlay). On Windows 10 (no acrylic) the panel is simply see-through.
2. **Window details for a transparent window.** Not maximisable and not full-screen (double-clicking the drag bar must never cover the meeting). On Windows and Linux the system shadow is off: it is a rectangle around the rounded panel; the panel's border marks its edge. macOS keeps its content-shaped shadow.
3. **Page-driven resizing.** A transparent window cannot always be resized by the system's own frame, so the page puts thin handles on the panel's edges and corners and sends `resizeOverlay({ phase, edge, dx, dy })`: `start` remembers the bounds, `move` applies the distance from the start, `end` saves. The shell keeps the minimum size (460 × 260; the slim modes have their own), keeps the dragged edge on the display, and in the slim modes changes only the width. `resizable: true` stays, so the system's own resizing still works where it does.
4. **Placement.** The default is **560 × 420 at the top centre** of the primary display, 24 DIPs below the top. Presets: **Top centre** (default), **Top right**, **Bottom centre**. `placeOverlay(preset)` puts the open overlay there (on the display it is on) and remembers the preset in the shell's settings file as the place it opens next time; with no overlay open it only remembers. "Reset size and position" is `placeOverlay('top-center')`, in the overlay's ⋮ menu and in Settings → Overlay. Saved bounds that still fit a screen are restored as before.
5. **Snapping.** After a move, each side of the overlay that ended within 16 DIPs of the work area's edge snaps flush to it. Snapping waits for the same quiet moment as saving (500 ms after the last move), because on macOS the move event fires all through a drag. A resize never moves the window, and the script bar is never snapped (it sits 8 DIPs below the top on purpose).
6. **Modes.** `setOverlayMode(mode)` generalises collapsing: `full`, `collapsed` (the controls bar, 60 DIPs, as before), `script` (a slim bar, 640 × 64, at the top centre of the display the overlay is on) and `script-input` (the same bar with its one-line input, 64 + 48). Leaving a slim mode for `full` brings back the bounds the overlay had in full mode; the remembered bounds are always the full-mode bounds. The pre-1.0.2 `setOverlayCollapsed` call still works and never leaves the script bar.
7. **The script bar shortcut: Ctrl+Alt+S (⌘⌥S on macOS).** A global call shortcut, registered only during a call like Answer, delivered to the live page (which decides what the overlay shows), and also mapped as an in-page shortcut. Conflict check: a unit test keeps every Kite shortcut (global, focused and Ask Kite) distinct; a shortcut another app already holds is reported like the others (the page's notice and Settings → Hotkeys). Known clashes: on layouts where Ctrl+Alt is AltGr (Polish: AltGr+S types "ś") the global shortcut can take that letter during a call, and the in-page shortcut never fires on the typed letter; on macOS ⌘⌥S is "Save All" in some apps, taken only while a call is live.
8. **Bridge.** Four optional methods on `window.kiteDesktop`: `placeOverlay`, `getOverlayPreset`, `resizeOverlay`, `setOverlayMode`, each on its own fixed IPC channel, accepted only from the Kite origin's main frame, with every value checked by the shell (a known preset or mode; a resize step with a known phase and edge and finite distances). The preload copies only plain values across. The web platform exposes them as `overlayPlacement()`, `placeOverlay()`, `getOverlayPreset()`, `resizeOverlay()` and `setOverlayMode()`; a browser and a pre-1.0.2 desktop app report no placement, and their modes fall back to collapsing.

## Consequences

- The overlay is see-through over any meeting; the blur shows only where and when the system draws it. Readability over a busy or bright window rests on the panel's background opacity and the text shadow (measured in ADR-0033).
- Clicks on fully transparent parts of the window (outside the rounded panel) are still caught by the overlay window, not passed to the meeting. The panel fills the window, so this is only the rounded corners.
- A desktop app before 1.0.2 keeps the old window (opaque on Windows) until it updates; the web app hides the position controls there.
- Saved positions from earlier versions are kept; the new default applies to new installs, an unplugged monitor, and Reset.

## Alternatives considered

- **Keep acrylic without `transparent`:** rejected; Electron ignores the clear colour and Windows draws no acrylic for an unfocused window, which is the overlay's normal state.
- **Focus the overlay so acrylic is drawn:** rejected; the meeting must keep the keyboard (ADR-0029).
- **Dim the whole window (`setOpacity`):** rejected in ADR-0033; it fades the text.
- **A separate window for the script bar:** rejected; one window keeps one place for protection, position and the session's state.

## Validation

- `apps/desktop/tests/unit/windows.test.ts`: the see-through window options on each system; the default place and preset places; snapping; resizing from each edge with the minimum and the screen respected; the script-bar modes and their way back; the IPC checks.
- `apps/desktop/tests/unit/preload.test.ts` and `apps/desktop/tests/smoke.spec.ts`: the bridge's methods and the plain values they send.
- `apps/desktop/tests/unit/hotkeys.test.ts`, `apps/web/tests/unit/shared/hotkeys.test.ts`, `apps/web/tests/unit/platform/keymap.test.ts`: Ctrl+Alt+S reaches the page, is registered only during a call, and shares no keys with another Kite shortcut.
- Human check (the installed 1.0.2 app on Windows 11): the overlay over a busy meeting window at 70 % and 40 %, focused and unfocused; Reset, each preset, snapping, edge resizing, and the script bar.
