# ADR-0123: Your own spoken questions are answered on a key press (Ctrl+Enter on your own, Ctrl+Shift+Space always); no Voice mode

- **Status:** Accepted (25 Nov 2026, the developer's WP3 brief, item 2)
- **Date:** 2026-11-25
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Overlay), §6.1 (Trigger), §7.3 (hotkeys) (version 4.61.0)
- **Supersedes / superseded by:** amends ADR-0082 §4 (Ctrl+Shift+Space was the voice question: listen, then send after a pause) and ADR-0095 §1 (Voice mode on bar 1 and in the ⋮ menu). Keeps ADR-0070 / ADR-0076's rules for the other person's questions unchanged, ADR-0101's voice question for Ctrl+Alt+Enter, and ADR-0115's "Question:" label.

## Context

The team uses Paramount AI two ways: on a call (answer the other person) and on their own (practice, or a video playing, asking the assistant things aloud). Voice mode (ADR-0095) needed a switch, kept the user's words out of the transcript while on, and was easy to leave on. The developer asked for the "personal assistant" to be always available with no button or setting, and for it never to answer by itself.

## Decision

Web only. No change to the desktop shell, the bridge, the keys or the answer prompt.

1. **Who Ctrl+Enter (⌘↵) answers** (`core/answer/ownQuestion.ts` `pressTarget()`):
   - **On a call:** the other side ("Them") has spoken within the last **`ON_CALL_WINDOW_MS` = 120 000 ms** (two minutes), and an other-side source is connected. Ctrl+Enter answers only the other person's newest question, **exactly as before** (`pressQuestion.ts`, `newestQuestion.ts`). The user's own spoken lines are never answered by it in this mode; private questions during a call go through the chat bar (ADR-0122) or Ctrl+Shift+Space.
   - **On your own:** the other side has not spoken in that window, or there is no other source. Ctrl+Enter answers the user's own newest spoken question or request from the "You" transcript.
   - The rule is read at the moment of the press. System audio such as a video counts as the other person (accepted by the brief).
2. **Ctrl+Shift+Space (⌘⇧Space)** always answers the user's own newest spoken question, in both modes (for when the user is muted in the meeting). It no longer listens for a new voice question (ADR-0082). No button. **Ctrl+Alt+Enter** is unchanged: a screenshot, then a listened voice question (ADR-0082, ADR-0101, ADR-0121), Esc cancels.
3. **The user's newest question** (`chooseOwnQuestion()`): the newest turn of "You" lines (consecutive lines with no "Them" words between them and gaps under `OWN_TURN_GAP_MS` = 2.5 s) that asks something: a question by `questionKind.ts`, or a request to the assistant ("explain…", "write me…", "summarise…"). Ordinary talk, greetings, talk about the call, noise and other languages do not count; it looks back past them. At most the newest 200 words are sent. A turn answered already shows its card again ("Showing the earlier answer…") instead of a second request. A turn still grey waits up to `OWN_WAIT_MS` = 1.5 s for the last words ("Finishing the question…"; a second press sends at once). Nothing asked yet: "No question of yours yet. Ask it aloud, then press the key again, or type it in Chat."
4. **Never automatic.** Only a key press answers the user's own words. Auto-answer still answers only the other person (its rules read only "Them" lines; unchanged).
5. **Same request as a typed question.** The words are sent as the user's own question (mode `chat`, the chat switch's target), exactly the way a typed or voice question already was. **No prompt text changed.**
6. **Card label.** The overlay's card says **"Your question:"** for the user's own words (typed, voice, or spoken and picked from the transcript; `AnswerEntry.yours`, `CompactAnswer.yours`) and **"Question:"** for the other person's.
7. **The hint on bar 2.** Before Clear, a small muted hint shows what Ctrl+Enter answers now: the key-cap and **Them** or **You** (green, like the user's chips). Screen readers get "Ctrl+Enter answers the other person's newest question" / "…your own newest question". No tooltip window. The live page publishes `CompactState.pressTarget`; `usePressTarget()` flips it with one timer when the two minutes run out, and at once when the other side speaks again.
8. **Voice mode has no control any more.** Bar 1's Voice toggle, the ⋮ menu's Voice switch and its first-use tip are removed; the live page no longer publishes `voiceMode` or `voiceTip` and ignores `voice-mode`. Its engine (`core/voice/voiceMode.ts`, `useCallDictation`'s `setVoice`) and the status line's words for it stay in the code, unreachable, for a separate clean-up.

## Consequences

- A user practising alone no longer needs a switch: ask aloud, press Ctrl+Enter.
- On a call, nothing about Ctrl+Enter changes. A user who asks aloud during a call and presses Ctrl+Enter gets the other person's question (or its earlier card), by design; Ctrl+Shift+Space or the chat bar answer them.
- The user's spoken questions now stay in the transcript as "You" lines (Voice mode kept them out). They count as replies for the other person's question rules, as any "You" line always did.
- Bar 1 is narrower by the Voice toggle (and wider by Chat, ADR-0122).
- The call timing log has two new triggers, `own-question` and `own-question-key`, and a `press-decision` of `own-answer` / `own-answered` / `own-none` (no words).

## Alternatives considered

- **Answer the user's own questions automatically on your own.** Rejected by the brief: never automatic.
- **Keep Ctrl+Shift+Space as the listened voice question and add a separate key.** A new global key needs a desktop release; the brief gives Ctrl+Shift+Space the new meaning.
- **A mode switch on bar 1.** Rejected: no button or setting; the two-minute rule decides, and the hint shows it.
- **Remove Voice mode's engine now.** It is shared with the dictation that Ctrl+Alt+Enter still uses; removing it safely is a separate change.

## Validation

- Unit: `tests/unit/core/answer/ownQuestion.test.ts` (the two-minute window, no other source, questions and requests vs ordinary talk, turns, look-back, answered once, grey, long turns, other languages); `StatusBar.test.tsx` (the hint), `CompactView.test.tsx` ("Your question:"), `ModelChoice.test.tsx` (no Voice control), `liveChannel.test.ts`, `hotkeys.test.ts`.
- Integration (`tests/integration/sim-calls.spec.ts`): on a call they ask → them; I ask aloud → Ctrl+Enter still answers them; Ctrl+Shift+Space and Chat answer me during a call; their last words 119 s ago → the hint flips to You within the window's end, and Ctrl+Enter answers my question once (not my ordinary talk); no other side → mine, or the notice with nothing sent; auto-answer on never answers my speech; Ctrl+Alt+Enter still listens and Esc cancels.
- No answer prompt or server change (`git diff` of `apps/web/src/server` is empty for this item), so no eval group is affected.
