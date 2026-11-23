# ADR-0115: A narrower default answer width, and a "Question:" label on the answer card

- **Status:** Proposed (23 Nov 2026; branch `overlay-width-question-label`, not yet deployed)
- **Date:** 2026-11-23
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay, compact view) (version 4.52.0)
- **Supersedes / superseded by:** changes ADR-0113's default panels' width (1, the bars' whole width) for the answer panel open alone; keeps the rest of ADR-0113. Brings back a label before the question, which the call UI's rebuild (spec S15, "the question title with a 2 px accent bar") had left out.

## Context

The developer asked for two overlay changes, matching the reference product (Parakeet):

1. **A narrower default answer.** Since ADR-0113 the answer panel starts as wide as the bars (share 1 of bar 1's natural width, 833 CSS px). Long answer lines across the whole bar are hard to read at a glance during a call. The developer asked for a reading column of about 60–65 % of the bars' width. A width the user has dragged must still stick.
2. **A label on the question.** The card showed the question as a bold title with an accent bar and no label. The developer asked for a short, muted label before it, using the reference's exact word if it differs from "Q:".

Checked against the reference frames we keep (`docs/design/reference-catalog.md`, 23 Nov 2026):

- The reference labels the question **"Question:"** (bold, after an icon) and the answer "Answer:". So the label here is "Question:", styled muted rather than bold, as asked.
- The reference's answer panel in those frames is about as wide as its bars or a little wider; none shows it at 60–65 %. The 62 % default is the developer's chosen proportion, not a measurement of the reference.

## Decision

Web only. No change to the desktop shell or the bridge.

1. **The default share depends on the panels open, until the user drags.** `getOverlayPanelsWidth()` now returns null when nothing usable is stored (never dragged, unreadable, storage blocked). `overlay/panelWidth.ts` `panelsShare(stored, besideTranscript)` picks the width:
   - the user's remembered share (`kite.overlayPanelsWidth`, 0.2–1) whenever there is one, in every layout, as before;
   - otherwise, **the answer open alone: 0.62** (`OVERLAY_PANELS_WIDTH.default`; 62 % of the bars' width, about 516 CSS px at bar 1's natural 833 px);
   - otherwise, **the transcript and the answer side by side: 1** (the bars' whole width, as before).
   The block is still never under the answer's button strip (261 CSS px) and never wider than the bars. The grip, the alignment by column and the strip minimum are unchanged.
2. **The question's label.** The card's question paragraph (still named "Question", with its 2 px accent bar) starts with "Question:" in a `<span>`: 13 px, medium weight, `text-ui-muted`, a small gap after it. The question's words keep their 15 px semibold heading colour. The label is `aria-hidden` (the paragraph is already named "Question", so a screen reader does not hear it twice) and `select-none` (selecting the question does not pick it up). Copy is unchanged: it copies the answer text, never the label.

## Consequences

- A device that never dragged the grip now opens the answer alone at 62 % of the bars' width, lined up by the position's column (left edge, centred, right edge). A device with a dragged width keeps it, in both layouts.
- **Why not 62 % beside the transcript too:** the block holds both panels. At 62 % of an 833 px bar it is about 516 px, under the 600 px where the two sit side by side, so they would stack. With the transcript's default 40 % split, the answer beside it is already about 60 % of the bars' width, the same reading column.
- In a window narrower than bar 1 (the 640 default on a 1366 or 1536 laptop, where bar 1 shows 530 px), the answer alone opens at about 329 px: narrower, still above the strip. The user can widen it with the grip, and it is then remembered.
- A narrower answer wraps onto more lines, so the window is taller for the same answer (ADR-0105's height follows it, as with any width change under ADR-0113).
- The browser spec that checked the card had no label (`live.spec.ts`, S15) now checks for the muted label instead.

## Alternatives considered

- **62 % in every layout.** Rejected: it stacks the transcript and the answer by default (see above).
- **A one-time migration that rewrites stored shares of 1 to 0.62.** Rejected: a stored 1 may be a deliberate drag to full width, and the developer asked that dragged widths stick.
- **"Q:" as the label.** Rejected: the brief asked for the reference's exact word when it differs, and the reference uses "Question:". It is a one-word change if "Q:" is preferred.
- **A bold label, as in the reference.** Rejected: the brief asked for a subtle label that does not compete with the question.

## Validation

- Unit tests: `tests/unit/features/live/overlay/panelWidth.test.ts` (`panelsShare()`: 0.62 alone, 1 beside the transcript, a stored share wins and is clamped), `tests/unit/core/storage/overlayPrefs.test.ts` (null when nothing is stored, unreadable or blocked; the 0.62 default), `tests/unit/features/live/CompactView.test.tsx` (the block at 62 % alone and 100 % beside the transcript before a drag; the muted, hidden label inside the accent bar, before the question).
- Browser spec: `tests/integration/live.spec.ts` (S15 card: the label's text and weight, the question still semibold with its accent bar).
- For the developer, after deploy, on the real desktop app: the answer alone at the default width in the six positions, the label's look over a light and a dark background, and a dragged width surviving a new call.
