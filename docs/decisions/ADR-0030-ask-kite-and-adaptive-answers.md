# ADR-0030: Ask Kite, adaptive answers and hallucination control

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (screens), §6 (answers), §7 (components)
- **Supersedes / superseded by:** none. Changes the core rules and their cache entry, the answer limit, the live and review order, and the database (version 6).

## Context

Answers had one shape, whatever was asked. Typed questions could only be words to say on the call. When the documents had nothing, Kite said so out loud ("Not in your notes"). A repeated question could get different figures. And nothing helped the user notice a figure Kite had made up.

## Decision

**A hidden first line, in the same request.** Each reply opens with `[[type|for|source]]`, for example `[[coding|call|docs]]`. It costs no extra call. The server removes it before the first word reaches the browser (`server/answer-meta.ts`) and sends it as a `meta` event, so every timing still counts from the first word the user can read, and no client can show it. Its cost is the few tokens Claude writes first: measured in `docs/testing/benchmark-results.md`. The first line was chosen over a last line because the card needs it while streaming (a private answer renders differently), and because deciding the type first steers the shape.

**Who an answer is for.** A question from Them is always for the call. A typed or screenshot question is detected as "For the call" (speakable, first person) or "Ask Kite" (direct, private, any topic). The switch next to the chat box (Auto, For the call, Ask Kite) is remembered per session in `localStorage`. It goes in the uncached tail, so changing it costs no cache. Private answers are never a "You" line, stay in the conversation marked "private, not said on the call" for follow-ups, get no claim check, and are left out of the AI notes, because they were never part of the call. Downloads label them "private answer".

**The Ask Kite page.** A chat outside calls, in `/ask-kite`, using `/api/answer` mode `kite`, so sign-in, streaming and error handling are the same code. It defaults to the smart model, because nobody is waiting on a call. Chats are stored in a new `chats` store (database version 6) and included in Export and in Delete all. A chat keeps its own copy of what is attached (library items, past sessions), as sessions do. Pasted screenshots are sent with their message and never stored; the chat keeps only their count.

**Ctrl+Alt+K.** The one global shortcut held outside a call, because it opens something rather than acting on the call, and its keys edit nothing in other apps. During a call, leaving the page would end the call, so the shortcut opens the chat box (in the overlay too) set to Ask Kite. On a mock interview it does nothing, for the same reason. On keyboard layouts where Ctrl+Alt types a letter (AltGr) it can clash: Settings → Hotkeys reports it.

**Adaptive answers.** The rules ask Claude to work out the role and domain from the session, and give each question type a shape. Coding has its own: approach, steps, complexity, edge cases, code, then a "Say:" line. The type shows as a small muted label, and choosing another from it answers again in that shape (a new answer, with the type in the uncached tail). The preferred coding language is sent only when it is not Python, so a session on the default keeps its bytes.

**Missing information.** Never a comment on what Kite was given. Closest real project first; then the setting "Approach answer" (the default: specific methods and steps, nothing invented) or "Full example story" (privately tagged Example, generic details, no numbers). A fact Kite cannot support gets a natural reply offering to confirm it. Every answer has a private source tag. It reads "From your CV" in interview and mock sessions and "From your documents" otherwise, because saying CV on a sales call would be wrong.

**Claim check (`core/answer/claimCheck.ts`).** After an answer finishes, plain text matching, with no model call, underlines numbers, prices, percentages, dates and names found in neither the documents nor the call, and adds a private "check before saying" line. It skips code, complexity notation and the private note. Earlier answers do not count as a source, because repeating an invented figure does not make it true. It errs towards flagging: a correct total Kite worked out (40 × 52) is underlined too, and that is worth a look before saying it. It is not run on private answers, on screenshots (their figures are on the screen, which it cannot read) or on case answers (their figures are stated assumptions, so every one would be underlined). Common technical names are allowed, or every technical answer would be covered in underlines.

**Consistency.** The browser compares the question's words with earlier questions in this call (`core/answer/similar.ts`, no model call). A similar one sends the earlier answer in the uncached tail, with an instruction to reuse its facts and wording.

**Temperature cannot be lowered.** The request asked for a lower temperature on call answers. The API refuses it: on `claude-haiku-5-5` with the SDK's API version, `temperature` and `top_k` return HTTP 400 "Extra inputs are not permitted", even at the default value (probed 2 Nov 2026, one request each). Consistency rests on reusing the earlier answer instead, and is measured by the `consistency` group.

**The answer limit** rises from 400 to 1,500 tokens: a coding answer needs it. It only stops a runaway reply; the shape rules keep ordinary answers short. Only what is written is billed.

**Newest first.** The live transcript, the overlay's transcript and the review's conversation show the newest at the top, with an "Oldest first" toggle in the review, remembered on the device. The jump-to-latest button is gone: at the top the newest line is in view, and someone who scrolled down stays put, because the browser anchors the scroll position. The live view and the overlay keep one answer card, as the team's tool does, with the call's other answers listed under it, newest first. Downloads stay in time order.

## Consequences

- The rules block grows from about 2,700 to about 7,700 characters plus examples, and its hash and every session's first cache entry change.
- **Scenarios 08, 13 and 14 changed.** They required "not in your notes", which this decision forbids. They now require a natural reply offering to confirm the detail. The grader's rubric also gained the coding shape, private answers, a headline-only reply, "As I mentioned" and an `invented` list. So `answers` scores after this change are not strictly comparable with the 9.18 baseline: see `docs/testing/answer-eval.md`.
- Older desktop installs keep working: the page skips what the shell does not have, and Ctrl+Alt+K then works only while Kite has focus.
- Export files move to version 5. Files from older versions still import.

## Alternatives considered

- **A separate classifying request:** adds a call and its delay to every answer.
- **Structured output for the answer:** would hold the first word back until the JSON field opens, and streaming a schema is harder to render.
- **The line at the end of the reply:** no effect on the first word, but the card could not know its shape while streaming, and a reply cut off at the limit would lose it.
- **A model-based fact check:** more precise, but it costs a request and adds delay after every answer. The request asked for plain text.

## Validation

Unit and harness tests, the `adaptive`, `missing-info`, `hallucination-bait`, `consistency` and `ask-kite` evaluation groups with code run in a sandbox (`scripts/lib/code-sandbox.ts`), the existing groups once, the latency run before and after, and the human checks in `docs/testing/final-test-plan.md` §5d.
