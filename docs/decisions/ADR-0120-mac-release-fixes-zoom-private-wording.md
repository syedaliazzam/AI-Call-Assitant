# ADR-0120: Mac release fixes: no Chromium page zoom, accurate Private wording, snap zones on every Space

- **Status:** Accepted (25 Nov 2026, the developer's brief after the investigation, decision D-3)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §4 (Private), §5 (Overlay), §7.3 (Mac menu) (version 4.57.0)
- **Supersedes / superseded by:** amends ADR-0111 §5 (the Mac menu's page zoom) and §7 (Private on a Mac: no status line). Keeps ADR-0110 (Kite's own ⌃⌥ zoom keys) and ADR-0042 / ADR-0085 (Private is `setContentProtection` only).

## Context

The investigation of 25 Nov 2026 (`docs/investigations/2026-11-25-mac-windows-parity-and-backlog.md` §A.1, §A.2) found two Mac-only problems in desktop 1.8.0 before its release:

1. **Two zooms on a Mac.**
   - The Mac app menu (ADR-0111 §5) had View → Actual Size / Zoom In / Zoom Out (⌘0 / ⌘+ / ⌘−). These were Chromium's own page zoom, which on a Mac reaches every window, the frameless overlay too.
   - Kite's zoom is something else: CSS zoom, Settings → Zoom, and ⌃⌥= / − / 0 during a call (ADR-0110). The shell sizes the overlay window for Kite's zoom only.
   - Chromium's zoom made the overlay's page narrower in CSS pixels: a 640 DIP window at 110 % is about 582 CSS px. The panels then stacked, and the window no longer fitted its content. Chromium also applies a zoom level to every window of the same site.
2. **A misleading Private line.**
   - With Private turned off during a call, the overlay said "Private is off: the overlay shows in screen shares · Turn on". On a Mac that suggests turning Private on hides the overlay from any share.
   - It does not. Apps that capture with ScreenCaptureKit (Chrome, so Google Meet; recent Zoom and Teams) can still show it in a **whole-screen** share. Private hides it when the user shares **a window or a tab** (ADR-0111 §7).
3. **Snap zones left behind in full screen.** On a Mac the overlay joins every Space, full-screen ones too (ADR-0111 §3, `floatOverFullScreen()`). The snap-zones window shown while the overlay is dragged did not, so over a full-screen meeting the zones stayed on the normal desktop (unverified on a real Mac; found in code, investigation §A.2).

## Decision

1. **No Chromium page zoom on a Mac** (desktop, Mac build only).
   - The Mac menu's View menu keeps only Enter Full Screen. Actual Size, Zoom In and Zoom Out are gone (`apps/desktop/src/macMenu.ts`).
   - Each page load puts Chromium's zoom back to 100 % when it is not (`resetPageZoomOnLoad`, from the `web-contents-created` handler on macOS only). This undoes a level left from the 1.8.0 test builds.
   - Kite's own zoom is unchanged.
   - Windows keeps Electron's default menu, unchanged (no Windows release).
2. **Accurate Private wording on a Mac** (web, Mac only).
   - While Private is off during a call, a Mac now says: **"Private is off. On a Mac, Private hides the overlay when you share a window or tab, not your entire screen."** with **Turn on**.
   - Windows keeps "Private is off: the overlay shows in screen shares".
   - The line is on the warning line under the transcript bar (ADR-0118), so it no longer replaces the live words; ADR-0111 §7's reason against a line no longer applies. It still shows only while Private is off; Private is on at every call start (ADR-0085).
   - Screen privacy stays `setContentProtection` only. Nothing hides the app from the Dock, the taskbar or process lists.
3. **The snap zones join every Space on a Mac** (desktop, Mac build only). When the zones window is made, it gets `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, as the overlay does (`apps/desktop/src/snapZones.ts`). It is made once and reused for every drag, so Electron's short Dock-icon blink for that call happens at most once per run. Windows is unchanged.

## Consequences

- ⌘+ / ⌘− / ⌘0 do nothing in Paramount AI on a Mac. Text size and zoom are Settings → Zoom and ⌃⌥= / − / 0 during a call.
- The overlay's layout on a Mac can no longer be shrunk by a zoom the shell does not know about.
- Mac users read what Private really does when they turn it off.
- Not changed, flagged for a decision: on a Mac, Kite's **own** screen recording also captures its windows whatever Private says (its screen capture ignores content protection; `apps/desktop/src/main.ts` hides windows by opacity for screenshots). The recording warning "Private is off: Paramount AI will appear in your recording · Turn on" is therefore also inaccurate on a Mac.

## Alternatives considered

- **Point ⌘+ / ⌘− at Kite's zoom.** That would have kept the Mac habit, but ⌘= / ⌘− are every app's zoom, and ADR-0110 deliberately leaves them to the meeting app during a call. ⌃⌥ is the call's zoom.
- **Hide the Private line on a Mac.** Rejected: a user who turned Private off should still see that it is off and be able to turn it back on.

## Validation

- Unit tests:
  - `apps/desktop/tests/unit/macMenu.test.ts`: no page-zoom role or shortcut; the zoom reset on load.
  - `apps/web/tests/unit/features/live/overlay/statusLine.test.ts`: Mac and Windows wording.
  - `apps/desktop/tests/unit/snapZones.test.ts`: every Space on macOS, once; not on Windows.
- On the real Mac (release test, `docs/testing/mac-release-test.md` 5.18–5.20):
  - ⌘+ / ⌘− do nothing on the overlay and the dashboard; ⌃⌥= / − / 0 still zoom.
  - Turning Private off during a call shows the Mac line with Turn on.
  - The snap zones show over a full-screen window.
