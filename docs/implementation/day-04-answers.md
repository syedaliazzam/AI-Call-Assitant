# Day 4 — Answers: context, consistency, quality and speed (instructions for Claude Code)

**Goal:** the core of Kite. During a live call the user presses a key (or a button) and a short, correct answer streams in within about a second. The answer uses the session's details and documents, **the whole conversation so far**, and **the answers already given in this call**, so it stays consistent and builds on what was said. Each answer can be rated, which feeds Day 5's learning step.

**Read first:**
- `CLAUDE.md`;
- `docs/architecture/kite-architecture-v3.1.md` (version 3.3.0): §2 (F5–F7, F12), §6 (flow, latency targets, prompt caching), §7.1–7.5, §8, §11;
- `docs/decisions/ADR-0020` (accuracy limits, hotwords) and `ADR-0024` (local storage);
- `apps/web/src/server/prompt.ts`, `claude.ts` and `core/answer/warm.ts` as built on Day 3.

**Branch:** `day-04-answers`, from an up-to-date `main`. Pull request into `main` at the end.

---

## How to work today

Day 4 is split into **12 small stages**. Each stage has a **gate**: a list of checks that must pass before the next stage starts.

**For every stage:**
1. Build only what the stage lists.
2. Run the stage's gate, plus `pnpm lint && pnpm typecheck && pnpm test`.
3. If the gate passes: commit (Conventional Commit), push, print a **short stage report** (files, gate results with numbers, anything surprising), and **continue to the next stage without waiting**.
4. If the gate fails: try to fix it **within the stage's scope**. If it still fails, or the fix would change the design, **STOP and report the options**.

**Verify yourself** wherever possible: unit tests, Playwright harness tests, dev-only scripts that call the real Claude API through our server code (printing only token counts and timings), production deploys, and an automated production check with a dedicated test account (Stage 11). The developer only does what truly needs a person, in ONE checklist at the end.

**Stop rules:**
- Never log or print transcript, document, session, question or answer text. Log ids, sizes, token counts and timings only. Scripts that show text locally need an explicit `--show` flag and are never run in CI.
- If an evaluation score drops after a prompt change, revert that change and report.
- If p50 to the first answer word is above 1.0 s after the levers in architecture §6.2, stop and report options.
- If an official API differs from our docs (Anthropic SDK, Electron `globalShortcut`, Chrome APIs), follow the docs and say what changed.

---

## Prompt design for Day 4 (used by Stages 1–4)

Three cache breakpoints, and the conversation part only ever **grows at the end** (append-only):

| Part | Content | Cached | Changes |
|---|---|---|---|
| System block | Kite's rules (Day 3) + consistency rules + a "Learned preferences" slot (empty until Day 5) | Yes (breakpoint 1) | Never during a call |
| Session block | Session details, description, instructions, style, key terms, documents (Day 3) | Yes (breakpoint 2) | Only if the session is edited |
| **Conversation block** | The call so far as a timeline: **stable** final lines (You/Them, mm:ss) and **earlier answers in this call** (question + headline + bullets), in time order | Yes (breakpoint 3) | **Grows by appending only** |
| Tail | Lines that aren't stable yet, then the question | No | Every request |

**Why append-only:** Claude's cache matches the start of the prompt. If the conversation only grows at the end, each request reuses everything sent before and only processes the new part, so a long call stays fast.

**Stable line:** final, at least about 5 s old, and already passed the echo filter. A stable line never changes after that. Anything that could still change (merges, echo removals, grey text) stays in the uncached tail.

**Consistency rules (system block):**
- "Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed."
- "If the same question is asked again, build on the earlier answer instead of starting over."
- Keep Day 3's rules: headline of 15 words or fewer, at most 5 bullets, only session facts for personal claims, say what to clarify, and the imperfect-transcript rule.

**Long calls:** keep the whole call verbatim up to a cap (about 20,000 tokens, roughly 90 minutes of speech). Past the cap, drop the oldest lines and say so ("Earlier part of the call omitted"). A summarised history is backlog.

---

## Stage 1 — Request types and validation

| Build | Details |
|---|---|
| `packages/shared/src/api.ts` | `AnswerRequest` gains `conversation` (stable lines + earlier answers, each with a kind, time and text) and `tail` (unstable lines). `mode` `answer` and `chat` enabled in the type. Every field commented. |
| `apps/web/src/server/validate.ts` | zod for the new fields; caps (conversation about 20,000 tokens estimated, request ≤ 4 MB); 400 errors name the field and never echo its content. |

**Gate:**
- [ ] Unit tests: valid requests pass; every cap and missing field gives the right 400 code.
- [ ] Old `hello` and `warm` requests still validate.

## Stage 2 — Prompt v2 (three cached blocks + tail)

| Build | Details |
|---|---|
| `apps/web/src/server/prompt.ts` | Builds system, session and conversation blocks with `cache_control`, then the tail and question, exactly as in "Prompt design". Consistency rules added. Long-call cap applied. Byte-stable serialisation. |

**Gate:**
- [ ] **Prefix-growth test:** for requests N and N+1 in the same call, N+1's cached part starts with exactly N's cached part (byte for byte).
- [ ] Same inputs give identical bytes; a changed session changes only the session block.
- [ ] Cap test: beyond the cap, the oldest lines are dropped and the note appears.
- [ ] Consistency text and the imperfect-transcript rule are present.

## Stage 3 — The answer route (`answer` and `chat`)

| Build | Details |
|---|---|
| `apps/web/app/api/answer/route.ts` | `answer` and `chat` stream `delta` / `done` / `error`. `done` includes usage (cache write and read) and timings. `max_tokens` about 400 (§6.2). One retry only before any text arrives (Day 1 rule). |
| `apps/web/src/server/claude.ts` | Streaming with the three breakpoints; thinking setting per model (Day 3). |

**Gate:**
- [ ] Route tests with the SDK mocked: streaming order, errors, 401 when signed out, no text in logs.
- [ ] **Real API script** `scripts/verify-answer-cache.ts` (dev only): 3 answers on an invented session with an invented, growing conversation. Prints only usage and ms. Pass: calls 2 and 3 show cache reads at least as large as everything before the new part, and small writes.

## Stage 4 — Stable lines and question selection

| Build | Details |
|---|---|
| `apps/web/src/core/transcript/stability.ts` | `splitStable(lines, now)`: stable vs tail, by the rules above. |
| `apps/web/src/core/transcript/question.ts` | `selectQuestion(lines, now)`: the "Them" lines since the user last spoke (echoes excluded), trimmed to the latest question-like span; if Them hasn't spoken since, the last Them line. Returns text and line ids. |

**Gate:**
- [ ] Unit tests on invented transcripts: a question split over two lines; the user interrupting; an echo line in between; no Them speech yet; a line becoming stable exactly at 5 s.

## Stage 5 — Request builder and answer client

| Build | Details |
|---|---|
| `apps/web/src/core/answer/context.ts` | `buildAnswerRequest(session, documents, transcript, answersSoFar, mode, typedQuestion?)`: stable conversation + earlier answers in time order + tail + question; caps. Pure. |
| `apps/web/src/core/answer/answerClient.ts` | Streams `answer`/`chat`; cancel; one request at a time (a new one cancels the old); timings: key press → request sent → first word → headline complete → done. |

**Gate:**
- [ ] Unit tests: request shape, earlier answers placed by time, caps, cancel, single in-flight request, timings recorded.
- [ ] A test that two consecutive requests from the builder pass Stage 2's prefix-growth check.

## Stage 6 — Answer panel, top bar and chat (browser)

| Build | Details |
|---|---|
| `features/live/TopBar.tsx` | Answer · Chat · Clear · End (Screenshot shown disabled, "Day 5"). |
| `features/live/AnswerPanel.tsx` | The question used (with "from N lines"), the headline as it streams, then bullets; cancel; previous/next; copy; time to first word. |
| `features/live/ChatBox.tsx` | Typed question → `chat`; Enter sends; Escape clears. |
| In-page hotkeys | The §7.3 shortcuts while Kite has focus. |

**Gate:**
- [ ] Playwright harness test (no sign-in, like Day 2's speech harness; runs in CI): fixture transcript → hotkey → mocked streaming answer → headline appears before bullets; cancel stops it; previous/next work; copy works; chat sends a typed question.

## Stage 7 — Saving answers, ratings and notes

| Build | Details |
|---|---|
| Storage | Each answer saved in `answers` (§7.4) with mode, question, text, model, timings, **rating** (👍/👎/none) and **note**. Saved even when "Save transcript" is off, because the review page (Day 5) and the learning loop need them; the preferences screen says so. Deleted with the session. |
| `AnswerPanel` | 👍 / 👎 and an optional "What was wrong / better answer" note. |

**Gate:**
- [ ] Unit tests for the storage functions; the harness test extended: rate an answer, reload, the rating is still there; deleting the session removes its answers.

## Stage 8 — Desktop global hotkeys

| Build | Details |
|---|---|
| `apps/desktop/src/hotkeys.ts` | Electron `globalShortcut` with the §7.3 defaults, forwarded to the page through `window.kiteDesktop.onHotkey` (preload + `packages/shared` types). Unregistered on quit. If a shortcut is taken by another app, the page shows which one. |

**Gate:**
- [ ] Unit tests (Electron mocked): registration, forwarding, unregister, conflict reporting.
- [ ] Desktop smoke test: the hotkey message path reaches the page (simulated from the main process).
- [ ] (Human, end of day) the hotkey works while another app has focus.

## Stage 9 — Answer-quality evaluation set and baseline

| Build | Details |
|---|---|
| `apps/web/tests/eval/scenarios/*.json` | About 12 invented scenarios: session (type, details, a short document), a transcript, the question, and what a good answer must and must not contain. Cover: sales pricing from a document; support troubleshooting; an interview question; a follow-up that refers back; **the same question asked twice, minutes apart**; **new information that should change an earlier answer**; misheard names ("your fin drove" for Bluefin Route); a question the documents can't answer (must say what to clarify); a typed chat question. |
| `scripts/eval-answers.ts` | Runs each scenario through the real server prompt with Haiku, then grades each answer with Sonnet against a written rubric: required facts present, nothing invented, headline ≤ 15 words, ≤ 5 bullets, consistent with earlier answers, follows the style. Prints a score table only (`--show` prints answers locally). Not run in CI. |
| `docs/testing/answer-eval.md` | The rubric, how to run it, a results table per prompt version. |

**Gate:**
- [ ] The script runs end to end; the baseline score table is recorded.

## Stage 10 — Prompt tuning (at most two rounds)

**Do:** look at the lowest-scoring scenarios, change the prompt, re-run the evaluation. Keep a change only if the overall score goes up and no scenario drops by more than one point. At most two rounds.

**Gate:**
- [ ] The final score is at least the baseline; every round is recorded in `answer-eval.md` with what changed; any losing change is reverted.

## Stage 11 — Latency measurement and production checks (automated)

| Build | Details |
|---|---|
| `/dev/latency` (admin) | Runs 20 answers on a fixture session and transcript through the **real** client path, one after another, and shows p50/p95 for: key press → request sent, → first word, → headline complete, → done; plus cache read/write per request. Copy results (numbers only). |
| Test account | A dedicated production test user (for example `kite-e2e@…`, role user), created with the existing admin tooling. Its password is generated and stored only in `apps/web/.env.local` as `KITE_E2E_EMAIL` / `KITE_E2E_PASSWORD` (gitignored), never printed, and documented in the README so it can be disabled from `/admin/users`. For `/dev/latency` (admin only), use a separate admin test account the same way, or ask the developer first. |
| `apps/web/tests/e2e-prod/*.spec.ts` | Manual-run Playwright suites (not CI) against production with the test account: sign in → create a session with an invented document and key terms → open → "Listening for N key terms" → the live page's warm-up response shows a cache read → Connect with a fake microphone (Chromium fake-audio flags, official recordings) and, if possible, a fake shared tab → Answer → headline streams → rate it → End → saved transcript survives a reload → delete the session. Plus the same core flow in the desktop app with Playwright for Electron against production. |

**Gate:**
- [ ] `vercel deploy --prod` succeeds; HTTP checks as on Day 3.
- [ ] The production e2e suites pass in Chrome and in the desktop app.
- [ ] `/dev/latency` run in production from the developer's laptop (automated with the admin test account, or by the developer): p50/p95 recorded. If p50 to the first word is above 1.0 s, apply the §6.2 levers in order (confirm cache hits, shorten the tail, lower `max_tokens`, check the region), recording before and after each; stop and report if still above.

## Stage 12 — Docs and wrap-up

| Build | Details |
|---|---|
| Architecture **3.4.0** | §6.1 flow, §6.3 caching (three breakpoints, append-only conversation, stable lines), §7.2 request shape, §7.3 hotkeys, §7.4 answers fields (rating, note), a new "Learning loop" subsection (Day 4 feedback, Day 5 lessons). |
| `docs/decisions/ADR-0025-answer-context-and-learning.md` (new) | Why the whole call and earlier answers are sent, the append-only cache design, consistency rules, the long-call cap, the evaluation set, and the learning loop (local, user-approved). |
| README | Answer, Chat, hotkeys, `/dev/latency`, `eval-answers`, the production e2e suites and the test accounts. |
| PR | Measured latency, evaluation scores, known risks, the Day 4 checklist. |

**End-of-day human checklist (about 10 minutes):** only what automation can't do.
1. **Desktop app:** the global Answer hotkey works while the meeting app (or any other window) has focus.
2. **A real conversation:** in Chrome or the desktop app, a 3-minute call (a colleague, or a YouTube interview as "Them"): press Answer twice on related questions, and judge whether the second answer builds on the first. Rate both.
3. If `/dev/latency` wasn't automated: run it in production in Chrome and in the desktop app, and paste both results.

Then STOP and give the PR link and description.

---

## Day 5 preview: the learning loop (built on Day 5)

- **After each call**, the notes step (Sonnet) also proposes up to 3 short **lessons** from the call's ratings and notes (for example "Give prices per seat and per month").
- The user **approves, edits or rejects** each lesson. Approved lessons are stored locally (per session type or for all sessions) and managed in **Settings → What Kite has learned**.
- Approved lessons go into the system block's "Learned preferences" slot (cached) in future calls, capped at about 20.
- Nothing is learned without the user's approval, and nothing leaves the laptop except as part of an answer request.

## Day 4 checklist (copy into the PR)

- [ ] Stages 1–12 gates passed (stage reports linked or summarised).
- [ ] Answer and Chat stream headline then bullets; cancel, previous/next and copy work.
- [ ] Requests carry the whole call (append-only cached) plus earlier answers; prefix-growth test passes; cache reads confirmed against the real API.
- [ ] Question selection tested on invented transcripts.
- [ ] Desktop global hotkeys and browser in-page hotkeys work.
- [ ] Ratings and notes stored with each answer.
- [ ] Evaluation: baseline and final scores recorded.
- [ ] Latency: 20 answers in production, p50/p95 against targets.
- [ ] Production e2e suites pass in Chrome and in the desktop app.
- [ ] Architecture 3.4.0, ADR-0025, README.
- [ ] No question, answer, transcript or document text in any log.
