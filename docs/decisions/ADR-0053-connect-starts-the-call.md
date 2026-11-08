# ADR-0053: Connect starts the call

- **Status:** Accepted (developer, 8 Nov 2026)
- **Date:** 2026-11-08
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Connect, overlay); `docs/design/paramount-ai-ui-spec.md` §3 (S11)
- **Supersedes / superseded by:** adjusts ADR-0029 ("Starting a call": a browser no longer asks for a second click for the overlay). Web only; no desktop release.

## Context

After **Connect**, the Connect card stayed on screen with a 5-second sound check and a **Go live** button. Only Go live showed the call and opened the overlay. People read this as an extra screen before the call.

- It dates from Day 2 (a sound check before the transcript view) and survived the S10/S11 restyle, although spec S11 lists only **Back** and **Connect** in the footer.
- Its one real job was in the browser: the Go live click let the overlay open. A Document Picture-in-Picture window needs a fresh click (transient user activation) and uses it up.
- The share picker usually takes longer than a click stays fresh. So the overlay could not simply open after the share, in the same click.

**Measured on 8 Nov 2026, Chrome 156.0.8078.81 on Windows 11** (temporary profile, a small test page):

- In one click, picture-in-picture opened first and used the click up (`navigator.userActivation.isActive` became false).
- After that, `getDisplayMedia` still opened the real share picker. With the test tab auto-selected, the share and then the microphone both succeeded.

So the overlay can open **before** the picker, inside the Connect click.

## Decision

1. **Connect starts the call.** When both channels run, the page shows the live view straight away. The sound check, its text and the Go live button are removed. A capture that fails stays on the Connect card with the error and **Try again**.
2. **The overlay opens first, inside the click.** Order on Connect:
   1. take the one-call lock;
   2. open the overlay (when calls start in it);
   3. ask for the other side, then the microphone (unchanged order, `core/audio/capture.ts`);
   4. show the live view.

   If the capture fails, that overlay is closed again. The desktop app opens its overlay over IPC, which needs no click, so one order serves both. The main window steps aside (minimises) only once the call is connected. A browser without picture-in-picture shows the existing "press Back to compact" notice.
3. **The microphone level moves onto the Connect card,** before the call (`core/audio/micPreview.ts`, `features/live/useMicPreview.ts`).
   - When the microphone is already allowed, the meter starts by itself. The desktop shell always reports this for its own address.
   - Otherwise the card shows **Test microphone**, whose click makes the browser ask. Opening the page never triggers a microphone prompt.
   - The meter's microphone is released before Connect opens the call's own capture. It feeds nothing to speech-to-text and keeps no audio.
4. **The other side's level shows in the call,** on the level bars and the existing notices. "Not hearing the other side" appears after 20 s of silence. The card cannot measure it beforehand: in a browser it needs the shared tab, which Connect asks for.
5. **Reconnect in the live view** only reopens the channels. It does not open the overlay or change the view.

**What stays:**
- **Desktop:** the start card (S10, Continue); the Connect card with audio source, microphone picker and level, speech model state, tips, Back and Connect.
- **Browser:** the Connect card with the microphone picker and level (or Test microphone), the tab-audio how-to, tips, Back and Connect.

## Consequences

- One click fewer per call, on both platforms. In a browser, the overlay no longer needs a second click.
- In a browser the picture-in-picture window is open while the share picker is shown. Cancelling the picker closes it again.
- On first use the speech model may still be downloading when Connect is pressed. The card then stays on "Connecting…" until the model is ready (unchanged), and the overlay may already be open.
- The 5-second "what was heard" check is gone. A silent channel is reported in the call instead.
- Desktop shells 1.1.0 and 1.2.0 need no change: the page only calls bridge methods they already have.
- If a future Chrome or Edge required a fresh click for `getDisplayMedia`, opening the overlay first would break sharing. `tests/e2e-prod/chrome.spec.ts` and the browser check in the phase report would show it. The fallback is the earlier order, with the overlay on its own click.

## Alternatives considered

- **Keep Go live, restyled:** an extra step that the reference app does not have, for a check the call view already gives.
- **Share first, then picture-in-picture:** the click is no longer fresh once the picker closes, so the overlay would need a second click.
- **Start the microphone meter on page load in every case:** a browser would show its microphone prompt before the user did anything.

## Validation

- **Unit:** `apps/web/tests/unit/core/audio/micPreview.test.ts`.
- **Harness:** `test:live-ui`. The Connect card has Test microphone, no Go live and no sound check, and the meter runs when the microphone is allowed.
- **Real Chrome against the call rig** (`tests/visual/rig-call.tsx` with `?overlay=on`), temporary profile, fake devices: Connect opens picture-in-picture, then the share, then the live view.
- **Real desktop shell against the rig,** temporary profile: Connect opens the overlay window and the live view.
- **Updated:** `tests/e2e-prod/chrome.spec.ts`, `tests/e2e-prod/desktop.spec.ts`, `apps/desktop/tests/visual/call-load.ts` and `call-mic-check.ts`.
- **Human check:** a real call in the desktop app and in Chrome.
