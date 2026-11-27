# ADR-0130: The model icon (✦) on the call bar is as bright as the other buttons

- **Status:** Accepted (27 Nov 2026; branch `no-system-notifications`, web only)
- **Date:** 2026-11-27
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (the overlay's bar 1) (version 4.69.0)
- **Supersedes / superseded by:** amends ADR-0094 (the model chip's look)

## Context

Bar 1 of the call overlay has the model chip (ADR-0094): a ✦ (lucide `Sparkles`) next to **AA** (Auto answer). When bar 1 is short of room the chip shows only the ✦.

The developer reported that the ✦ looks dimmer than the other buttons, on Mac and Windows, as if it were broken.

The cause is in `ModelChip` (`apps/web/src/features/live/overlay/ModelChoice.tsx`). The ✦ had its own colour:

- the **default model** (`'fast'`, today Claude Haiku): `text-ui-muted`;
- **any other model**: `text-ui-accent`, plus an accent ring around the chip.

So the dimming was on purpose: it marked "you are on the default model", against the accent colour for a model the user picked. It was **not** a disabled or loading state. The only disabled state is after the call ends (`disabled={ended}`), and it uses the same `disabled:opacity-50` as every bar button.

The other buttons draw their icons and words in `text-ui-text`. In the dark overlay that is `#FFFFFF`, while `text-ui-muted` is `#A1A1AA` (the light overlay: `#18181B` against `#3F3F46` or `#71717A`). The default model is the normal state, so the chip looked dim nearly all the time.

## Decision

Web only.

1. The default model's ✦ uses `text-ui-text`, the colour of every other bar button. It is exactly as bright as they are, on Mac and Windows, in the dark and light overlay themes.
2. A model other than the default still shows the **accent ✦ and the accent ring**. The "not the default" state is still visible, and is the only one that needs marking.
3. The tooltip ("Model: …") and the chip's words (when bar 1 has room) still name the model.
4. The chip's span carries `data-model-icon="normal" | "accent"` for tests.

## Consequences

- The ✦ no longer looks disabled. The default model has no colour of its own; the accent marks the other models.
- **AA** (Auto answer) still uses the muted colour when it is **off**. That is an on/off switch with its own dot, so it is a real state and was not part of this report.

## Alternatives considered

- **Keep the muted ✦ and add a "Default" label:** more text on a crowded bar, and the icon would still look broken.
- **Accent colour for every model:** the user could no longer see at a glance that they changed the model.

## Validation

- Unit: `apps/web/tests/unit/features/live/overlay/ModelChoice.test.tsx`: the default model's ✦ is `text-ui-text`, never `text-ui-muted`, with and without words; another model keeps the accent ✦ and ring.
- Integration: `answers.spec.ts`, `live.spec.ts` (bar 1's fit rules) pass unchanged.
- On the real apps (web change, picked up on restart): the ✦ is as bright as the other buttons on Windows 1.7.5 and Mac 1.8.1, in the dark and light themes.
