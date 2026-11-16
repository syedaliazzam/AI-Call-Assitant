# ADR-0094: Switch the answer model during a call, from the overlay

- **Status:** Accepted
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6.1, §7.1, §7.2 (version 4.34.0)
- **Supersedes / superseded by:** extends spec §6 (the per-session model and the admin's switch for the deeper model) and ADR-0075 (bar 1's fit rules).

## Context

A session's answer model is chosen before the call, under AI preferences: Fast (Claude Haiku, the default) or Smart (Claude Sonnet). An admin can turn Smart off (Admin → Usage), and the server then answers a Smart session with Fast. During a call there was no way to change it: a user who wanted a more thorough answer for one hard stretch of the call, or faster answers again afterwards, had to leave the call. The developer asked for the same choice in the compact view (the overlay), web only.

## Decision

- **Where:** the overlay's ⋮ menu gets a Model row ("Fast — quickest answers", "Smart — more thorough, slower", the current one checked), and bar 1 gets a small chip ("Fast" / "Smart") next to Auto answer that opens the same choice in a popover. The chip sits in the part of bar 1 that gives way: it becomes its icon at the same step as Auto answer's bolt (ADR-0075) and never pushes Exit, ⋮ or the Transcript switch out. Smart is shown disabled, with the tooltip "Turned off by your admin", when the deeper model is off. The menu, the popover, the tooltips and the toast are drawn in the page (ADR-0042), so they stay inside the protected window.
- **How it applies:** the overlay sends `{ type: 'model' }` over the live channel; the live page (LiveAnswers) applies it from the next answer. An answer already streaming keeps its request, so it finishes on the model it was sent with. Smart is checked with `GET /api/models` first; when it is off nothing changes and the overlay says so.
- **Saved:** as this session's model on this device (`updateSessionPreferences()`, which merges inside the IndexedDB transaction, so a later answer-preference change never puts back the old model). AI preferences then show the same value. Other users and the global settings are never touched.
- **Warm-up:** a switch warms the new model's prompt cache in the background (mode `warm`, with the conversation sent so far), so the first answer after it reads the cache instead of writing it. Warm-ups do not count towards the daily limit.
- **Feedback:** once the live page reports the new model, the overlay shows a short toast under bar 1 (above it on the bottom row): "Smart model on — answers may take a bit longer" or "Fast model on — quickest answers". It hides after 3 s, and the window grows for it as for a menu.
- **Records:** `POST /api/answer`'s `done` event gains `model` (the tier that really answered, after the admin's switch). The answer card's record and the saved answer keep that tier, and the call's timing trace has `model` per answer (and in each card row of its download), plus a `model` event when it changes. Tiers only, never text.
- **Unchanged:** Ask AI and AI notes keep their own models. The server still enforces the allow-list (`fast` / `smart` only) and the admin's switch on every request.

## Consequences

- One more control on bar 1. At the desktop overlay's default width (980) every word still shows in every state (measured, `live.spec.ts`).
- A switch to Smart costs one cache write on Sonnet (the session's documents and the conversation so far). It is a user action, and it saves the slower first answer that would write the same cache anyway.
- An older live page (a cached tab from before this change) does not publish `model`, and the overlay then shows no chip and no Model row. An older server sends no `model` in `done`, and the record then keeps the tier that was asked for.

## Alternatives considered

- **Apply to the streaming answer (cancel and re-ask):** it throws away words the user may already be reading, and spends a second request. Rejected.
- **Save the whole preferences object, as the answer-preferences change did:** it can put back a model changed in the same call. Replaced by the merging update for both.
- **Optimistic toast on click:** it would claim Smart even when an admin had just turned it off. The toast waits for the live page instead.

## Validation

- `tests/integration/answers.spec.ts` (real live page and overlay): an answer streaming on Fast while Smart is picked finishes and is saved as Fast; a `warm` request with Smart follows; the session stores Smart; the next answer asks for and is saved as Smart; back to Fast from ⋮; with Smart off, picking it changes nothing and shows the tooltip.
- `tests/integration/live.spec.ts`: the chip's fit rules at the default and narrowest desktop sizes (Fast / Smart, recording, Private off, Auto, Click-through) and at 900–460 px; popover, tooltip and toast inside the window on the top and bottom rows; no chip for an older live page.
- Unit: the channel command, the merging update, the `done` tier (route and client), the trace's model per answer, and the overlay's markup.
