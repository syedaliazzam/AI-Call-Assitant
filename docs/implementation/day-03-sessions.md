# Day 3 — Sessions, documents and the session prompt (instructions for Claude Code)

**Goal:** Kite gets real call sessions. A user creates a session with details and documents, it is saved on their laptop, and opening it starts a live call that already knows the session: its names and terms feed speech-to-text as hotwords, and its details and documents form the cached Claude prompt that Day 4's answers will use. By the end of Day 3:

1. **Dashboard** lists the user's sessions with search and type filters, like ParakeetAI's "Call Sessions".
2. **Create session** is a two-step wizard (Details, then Preferences) with PDF / DOCX / TXT documents.
3. Sessions, documents and (optionally) transcripts are **stored locally** in IndexedDB and survive a reload, in the browser and in the desktop app.
4. **Choose platform** dialog and **Settings** page exist.
5. `/live/[id]` opens a real session; the session's **hotwords** are applied, and their effect on accuracy is **measured**.
6. `server/prompt.ts` builds the **cached session prompt**; a `warm` request at session start makes the next request a cache hit (`cache_read_input_tokens > 0`).
7. CLAUDE.md rule 5 (a comment on every type field) is complete and enforced.

**Read first:**
- `CLAUDE.md`;
- `docs/architecture/kite-architecture-v3.1.md` (version 3.2.0): §2 (features F1–F4), §5 (screens), §6.1 and §6.3 (flow and prompt caching), §7.1 (web modules), §7.2 (server, request shape, prompt structure, server rules), §7.4 (data model), §8.1 (where data lives), §9 (folders and code rules);
- `docs/decisions/ADR-0020-stt-model.md` (hotwords, real-call result) and `ADR-0023-stt-model-hosting.md`;
- `docs/testing/benchmark-results.md` (Day 2 accuracy rows).

**Branch:** `day-03-sessions`, created from an up-to-date `main`. Open a pull request into `main` at the end.

**After every stage:**
1. Run `pnpm lint && pnpm typecheck && pnpm test` (lint now includes the JSDoc rules and the header check).
2. Commit.
3. Print the stage summary (files + one-line purpose, commands to try, actions needed from the developer).
4. **STOP and wait for "continue".**

**Facts carried over from Days 1–2 (do not re-discover):**

| Fact | Detail |
|---|---|
| Speech engine | `core/stt/sttEngine.ts`: `createSttEngine({ hotwords, … })`, `setHotwords(list)` re-creates the recognizer (~2 s), so hotwords are set **before** Connect. Hotwords must be **upper case**; a score is optional (`:2` used so far). |
| Transcript | `core/transcript`: `lines()` / `window(minutes)` already exclude echo lines; `displayLines()` is display-only. Utterance shape: `{ id, speaker, text, tStart, tEnd, final }`. |
| Live screen | `/live/[id]` exists and accepts only `demo`; `features/live/demoHotwords.ts` marks where session hotwords plug in. |
| Claude | `server/claude.ts` `streamReply()` with a cached system block; `thinking` disabled for Haiku 5.5; `refused` error code; `/api/answer` currently supports `mode: 'hello'`. Prompt caching minimum is 512 tokens; cache lives 5 min. |
| Accuracy | ~27% WER on the developer's voice; names and technical terms are the main errors. Hotwords fixed both invented names exactly in a clean test (Day 1). |
| Commenting | `pnpm lint` fails on missing JSDoc, `@param`/`@returns`, file headers, "Called from" lines, test opening comments and schema comments. |

**Stop rules (apply to every stage):**
- Never log or send session details, document text, transcript text or answers anywhere except to `/api/answer` when a request is made (Day 4). Log ids, sizes, timings and counts only.
- Never commit a real customer document. Test fixtures are small, invented files created for the tests.
- If session hotwords make accuracy **worse** on the measurement in Stage 5, stop and report options. Do not tune silently.
- If an official library API differs from our docs (Dexie, pdf.js, mammoth, Anthropic SDK), follow the official docs and say what changed.

---

## Stage 0 — Finish the commenting standard (rule 5)

Carry-over from Day 2.

1. Audit every type, interface and object-shaped type alias in `apps/web`, `apps/desktop` and `packages/shared`: count fields with no comment, then fix them. Each field comment says what the value means, its unit (ms, bytes, 0..1) and any special values (`null` = …).
2. Enforce it: use an `eslint-plugin-jsdoc` rule for interface/type members if one fits; otherwise extend `scripts/check-file-headers.ts` to fail on uncommented fields in exported types and interfaces. Show a throwaway failing example, then delete it.
3. Report before/after counts.

**Check:**
- [ ] 0 uncommented fields; the check fails on a new uncommented field.

---

## Stage 1 — Local storage (IndexedDB)

**Goal:** a typed, React-free storage layer for everything that stays on the laptop.

**Install (web):** `dexie` (IndexedDB wrapper named in architecture §7.1); `fake-indexeddb` (dev, for unit tests).

| File | Contents |
|---|---|
| `apps/web/src/core/storage/db.ts` | `KiteDb` (Dexie) with stores `sessions`, `documents`, `utterances`, `answers`, `notes` exactly as §7.4, indexes for the dashboard (`createdAt`, `type`, `status`) and per-session lookups (`sessionId`). Versioned schema with a comment explaining how to add a migration. `answers` and `notes` are declared now but written on Days 4–5 (comment). |
| `apps/web/src/core/storage/types.ts` | `Session`, `SessionPreferences`, `StoredDocument`, `StoredUtterance`, `StoredAnswer`, `StoredNotes`: every field commented (units, allowed values). `SessionType` = `'interview' \| 'sales' \| 'support' \| 'internal'`. |
| `apps/web/src/core/storage/sessions.ts` | `createSession`, `getSession`, `listSessions({ search, type })` (newest first; search over company, role, description), `updateSession`, `deleteSession` (also deletes its documents, utterances, answers, notes in one transaction). |
| `apps/web/src/core/storage/documents.ts` | `addDocument`, `listDocuments(sessionId)`, `removeDocument`, `totalChars(sessionId)`. |
| `apps/web/src/core/storage/utterances.ts` | `saveUtterance` (only called when the session's `saveTranscript` is on), `listUtterances(sessionId)`. |
| `apps/web/src/core/storage/wipe.ts` | `deleteAllLocalData()`: deletes the IndexedDB database **and** the speech model cache is left alone (comment: it holds no personal data and is 204 MB to re-download); returns counts. |
| `apps/web/src/platform/storage.ts` (only if needed) | Request persistent storage (`navigator.storage.persist()`) so the browser doesn't evict sessions; report the result. Desktop and browser behave the same unless the official Electron docs say otherwise. |
| Tests | `tests/unit/core/storage/*` with `fake-indexeddb`: create/list/search/filter/update/delete, cascade delete, totals, wipe. |

**Check:**
- [ ] Unit tests cover every repository function, including cascade delete and wipe.

---

## Stage 2 — Document text extraction

**Goal:** turn PDF, DOCX and TXT files into plain text for the session prompt, on the laptop.

**Install (web):** `pdfjs-dist` (PDF text, official Mozilla library), `mammoth` (DOCX to text). One reason each, in the summary.

| File | Contents |
|---|---|
| `apps/web/src/core/documents/extract.ts` | `extractText(file: File)` → `{ name, text, chars, pages? }` or a typed `DocumentError`: `unsupported-type`, `too-large` (file over ~20 MB), `encrypted` (password-protected PDF), `no-text` (e.g. a scanned PDF with no text layer: message says OCR is not supported in v1), `failed`. Normalises whitespace; keeps paragraph breaks. |
| `apps/web/src/core/documents/limits.ts` | Character caps: per document and per session total (**~150,000 characters**, architecture §7.2), with a function that reports how much room is left. |
| pdf.js worker | Load pdf.js's worker the way its official docs describe for bundlers; comment how it is served. No COOP/COEP headers (Day 2 decision). |
| Tests | `tests/unit/core/documents/*` with tiny invented fixtures in `tests/fixtures/documents/` (a 2-page PDF, a DOCX with a table, a TXT, an encrypted PDF, an image-only PDF), plus a `SOURCES.md` saying they were generated for the tests. |

**Check:**
- [ ] Each fixture extracts as expected; each error case returns the right typed error.

---

## Stage 3 — Dashboard, Create session wizard, Choose platform, Settings

**Goal:** the screens a user sees before a call, matching ParakeetAI's flow (architecture §5).

| File | Contents |
|---|---|
| `apps/web/src/features/dashboard/Dashboard.tsx` | Replaces the empty state: session cards (date, company, role, type, status), search box, type filter tabs (All / Interview / Sales / Support / Internal), "Create session" button, empty state when there are none, and a "Download desktop app" banner placeholder (comment: links go live on Day 6). |
| `apps/web/src/features/dashboard/SessionCard.tsx` | One session: open (goes to Choose platform), edit, delete (with confirm). |
| `apps/web/app/(app)/sessions/new/page.tsx`, `apps/web/app/(app)/sessions/[id]/edit/page.tsx` | Thin routes for create and edit. (`/sessions/[id]` review is Day 5.) |
| `apps/web/src/features/session-setup/SessionWizard.tsx` | Two steps with Back / Next / Create; keeps entered data when moving between steps; validates required fields. |
| `apps/web/src/features/session-setup/DetailsStep.tsx` | Type, company, role or topic, description, documents (drag-and-drop or picker; shows each file's characters and errors; shows remaining room against the cap). |
| `apps/web/src/features/session-setup/PreferencesStep.tsx` | Language (English only in v1, shown disabled), model (Fast = Haiku, Smart = Sonnet), answer format / length / tone, AI instructions, **key terms** (optional free text: names and terms to listen for, one per line, feeds hotwords), save-transcript toggle (default on), auto-answer toggle (disabled, "Beta on Day 6"). |
| `apps/web/src/features/session-setup/ChoosePlatformDialog.tsx` | "Desktop app" / "Open in browser", plus "What's the difference?" (architecture §4 table). In the browser, "Desktop app" says the installer arrives on Day 6. In the desktop app, the dialog is skipped. Uses `getPlatform().kind` for display only. |
| `apps/web/app/(app)/settings/page.tsx`, `apps/web/src/features/settings/Settings.tsx` | Default preferences for new sessions, hotkey list (read-only; global hotkeys are Day 4), share-protection toggle shown as "Day 5", **Delete all local data** (confirm, then show the counts deleted). |
| `apps/web/src/ui/Sidebar.tsx` | Settings enabled. |
| `apps/web/src/ui/*` | Small shared pieces as needed (Dialog, Tabs, Toggle, Select, Textarea), fully commented. |

`features/` never touches IndexedDB or files directly: it uses `core/storage` and `core/documents`.

**Check:**
- [ ] Create a session with two documents, reload the page: the session and documents are still there. Same in the desktop app.
- [ ] Search and type filters work; edit and delete work; delete removes its documents too.
- [ ] Delete all local data empties the dashboard.

---

## Stage 4 — Live sessions and session hotwords

**Goal:** `/live/[id]` runs a real session, and the session's names and terms reach speech-to-text.

| File | Contents |
|---|---|
| `apps/web/app/(app)/live/[id]/page.tsx` | Loads the session from IndexedDB (not found → message and a link to the dashboard). `/live/demo` is removed, or kept only as a dev tool if still useful (say which and why). |
| `apps/web/src/core/stt/sessionHotwords.ts` | `buildHotwords(session, documents)` → upper-case phrases with scores. Sources, in priority order: the **key terms** field, company, role/topic, then names and terms found in documents (proper-noun phrases and acronyms that repeat). Caps the list (for example 100 phrases) and phrase length; drops common words; deduplicates. Every rule commented with why. Unit-tested on invented session data. |
| `apps/web/src/features/live/LivePage.tsx` | Uses the session (title, company) instead of the demo; calls `setHotwords` **before** Connect; shows "Listening for N key terms" in the Connect view. `demoHotwords.ts` is deleted. |
| Transcript saving | When `saveTranscript` is on, final lines are saved with `core/storage/utterances`; when off, they stay in memory only and are discarded at End (architecture §7.4). Echo lines are never saved. |
| `/dev/stt-test` | Gains a "Use session" picker so the accuracy test can run with a session's hotwords. |

**Measure (developer, Chrome, plugged in):** create a test session whose key terms include "Bluefin Route", "Northwind Logistics" and "professional plan". On `/dev/stt-test` with that session, read the 3 test sentences. Then repeat with hotwords off. Record WER for both in `benchmark-results.md`. Expected: sentence 3 improves clearly. If WER gets worse, stop and report (stop rules).

**Check:**
- [ ] A real session opens in `/live/[id]` with its hotwords applied; the Connect view shows the count.
- [ ] Transcript saving honours the toggle; reloading a session with saving on shows its saved lines (simple list; full review page is Day 5).
- [ ] WER with and without session hotwords recorded.

---

## Stage 5 — The cached session prompt and warm-up

**Goal:** the server can build Day 4's prompt, and the cache is warm before the first answer.

| File | Contents |
|---|---|
| `packages/shared/src/api.ts` | `AnswerRequest` extended to the §7.2 shape: `mode` (`hello` / `warm` / `answer` / `chat` / `screenshot`), `model` (`fast` / `smart`), `session` (type, company, role, instructions, style, documents), `transcript`, `question`, `image`. Every field commented. `answer`, `chat` and `screenshot` are accepted by the type but return "not implemented yet: Day 4/5" from the route. |
| `apps/web/src/server/prompt.ts` | `buildPrompt(request)` → system block + session block (both with `cache_control`) + messages. System rules from §7.2 (headline ≤ 15 words, ≤ 5 bullets, only session facts for personal claims, say what to clarify if unsure) **plus**: the transcript is machine-made and may contain misheard names and terms; infer the intended words from context and from the session's documents. The session block is serialised **byte-for-byte identically** every time for the same session (fixed field order, no timestamps or random ids). |
| `apps/web/src/server/validate.ts` | zod schema for the extended request; caps from §7.2 (documents ≤ ~150k characters total; request ≤ 4 MB); clear 400 errors naming the field, never echoing its content. |
| `apps/web/app/api/answer/route.ts` | Handles `mode: 'warm'`: builds the cached blocks and makes the smallest request the official Anthropic docs allow for writing the cache (check whether `max_tokens: 0` is accepted; if not, use the documented minimum and say so). Returns `done` with usage (`cache_creation_input_tokens`, `cache_read_input_tokens`) and timings. `hello` keeps working. |
| `apps/web/src/core/answer/warm.ts` | `warmSession(session, documents)`: called when a live session opens; re-called if the session's documents change; never blocks the UI; logs only timings and token counts. |
| `/dev/claude-test` | Gains "Warm with session…" (pick a session) and shows cache write/read for two consecutive warm calls. |
| Tests | `prompt.test.ts` (identical bytes for the same session; documents and instructions included; no transcript in the cached part), `validate.test.ts` (caps, field errors), route tests with the SDK mocked (`warm` returns usage; `answer` returns the Day 4 message). |

**Check:**
- [ ] Two warm calls for the same session within 5 minutes: the first writes the cache, the second shows `cache_read_input_tokens > 0` (developer checks on `/dev/claude-test`, locally and in production).
- [ ] No session, document or transcript text appears in any log.

---

## Stage 6 — Real checks, deploy, docs and wrap-up

**Developer checks (Claude Code gives exact steps and waits for results):**
- [ ] **Browser:** create a session with two documents and key terms → reload → still there → Open in browser → Connect → live transcript works with "Listening for N key terms".
- [ ] **Desktop app:** the same session list appears (note: the desktop app has its own IndexedDB, so sessions created in the browser do **not** appear there; confirm and document this clearly as expected behaviour) → create a session in the desktop app → reload → still there → live works.
- [ ] **Hotword effect on a real call (optional, recommended):** a 2-minute call with a colleague using a session whose key terms include the company and product names; note whether names now come out right.
- [ ] **Warm-up:** cache write then cache read in production.
- [ ] **Delete all local data** works in both.

**Deploy:** `vercel deploy --prod` (developer runs it); check `/` (dashboard), create session, `/live/[id]` and the warm-up in production.

**Docs:**
- `docs/architecture/kite-architecture-v3.1.md`: bump to **3.3.0**: §5 (screens as built), §7.1 (storage, documents, session hotwords), §7.2 (request shape, `warm`, prompt rules incl. the imperfect-transcript note), §7.4 (data model as built), §8.1 (documents stored locally; the browser and the desktop app have separate local data).
- `docs/decisions/ADR-0024-local-session-storage.md` (new): IndexedDB via Dexie, separate data per browser profile and desktop app, no sync in v1 (backlog), persistence request, delete-all behaviour, and the risk that local data is unencrypted on the laptop (mitigation: OS disk encryption, delete-all, session expiry).
- `docs/decisions/ADR-0020-stt-model.md`: add the session-hotwords result.
- `README.md`: sessions, documents, settings, warm-up.

**Finish:**
1. Run all checks, commit, push `day-03-sessions`.
2. Give the developer the PR link (compare link), a title and a description with measured results and known risks.
3. Print the Day 3 checklist and STOP.

---

## Day 3 checklist (copy into the PR)

- [ ] Rule 5: every type field commented; enforced in lint.
- [ ] Dashboard: list, search, type filters, edit, delete.
- [ ] Create session wizard: details, documents (PDF/DOCX/TXT with clear errors), preferences, key terms.
- [ ] Sessions and documents survive a reload, in the browser and in the desktop app (separate data stores, documented).
- [ ] Choose platform dialog and Settings (incl. Delete all local data).
- [ ] `/live/[id]` runs a real session; session hotwords applied; WER with and without hotwords recorded.
- [ ] Transcript saving honours the toggle; echo lines never saved.
- [ ] `server/prompt.ts` with a byte-identical cached session block and the imperfect-transcript rule.
- [ ] `warm` mode: second call shows `cache_read_input_tokens > 0` (local and production).
- [ ] Architecture 3.3.0, ADR-0024, ADR-0020 update, README.
- [ ] No session, document or transcript text in any log.
