# ADR-0116: A plain-text documents summary that survives being cut off, and a backoff after it fails

- **Status:** Proposed (24 Nov 2026; branch `summary-plain-text`, not yet deployed)
- **Date:** 2026-11-24
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §7.2 (`/api/summary`, `server/claude.ts`), §7.4 (`summaryFailures`), §5 (Session review) (version 4.53.0)
- **Supersedes / superseded by:** changes ADR-0067's summary output (a JSON schema with one `summary` string, 3,000 tokens) to plain text with 5,000 tokens; keeps the rest of ADR-0067 (what is summarised, the fingerprint, where the summary is kept and read).

## Context

On large documents the documents summary failed in production. The route asked the fast model for a JSON reply (`jsonReply()`, structured outputs) with `SUMMARY_MAX_TOKENS = 3000`. When the model reached that limit the JSON was cut off mid-string, `JSON.parse` threw a `SyntaxError`, `describeClaudeError()` did not recognise it, and the route answered **502 `internal` after about 14.5 s**. The tokens were already paid for (about $0.09 a request at the over-100k-token Haiku rate).

The device keeps only successful summaries, so nothing stopped it asking again. Opening the session, the notes, Ask AI and each Prepare request asked for the same summary, and each one failed the same way and was paid for again.

Two numbers also disagreed: the smart routes accept a summary of up to `MAX_DOCUMENTS_SUMMARY_CHARS` (20,000 characters, about 5,000 tokens), but the model was allowed only 3,000 tokens.

## Decision

Web only. No change to the desktop shell or the bridge.

1. **Plain text, not JSON.** `server/claude.ts` gains `textReply()`: a non-streaming request with no output format that returns the text, the usage and the stop reason, and never throws for a reply cut off at `max_tokens`. `server/summary.ts` uses it instead of `jsonReply()`. The reply was already "## name" headings and bullets inside a JSON string; now it is the same text without the wrapper. The rules gain one line: "Reply with the summary only: start with the first "## " line, with no introduction and no closing remark." `jsonReply()` is unchanged for the notes and the graders.
2. **The token limit matches the character cap.** `SUMMARY_MAX_TOKENS = MAX_DOCUMENTS_SUMMARY_CHARS / 4 = 5,000` (was 3,000). The rules still ask for under 1,200 words.
3. **A cut-off reply is kept** (`finishSummary()`). When the stop reason is `max_tokens`, or the text is over 20,000 characters, the summary ends at its last complete line within the cap, a trailing "## " heading with no bullets is dropped, and a closing note is added: "(The summary stops here: it was cut short, so the documents or details after this point are not in it.)". The result is never over the cap. The route answers 200 with `cutOff: true` and logs `stopReason` and `cutOff`. Only a reply with no usable text at all (a refusal, or a cut-off before its first complete line) is an error: `EmptySummaryError`, logged with the stop reason and output tokens, answered as 502 `upstream_error`.
4. **A failure is remembered on the device, with a backoff.** Dexie version 13 adds `summaryFailures` (key: the documents' fingerprint; this device only, not in `SYNCED_STORES`; no text). When `/api/summary` answers 5xx, 400 or 413, `core/documents/summary.ts` records the failure; until its `retryAt` no page sends a request for the same documents, and the callers go on without a summary as they did after a failure before. The waits after 1, 2, 3 and 4+ failures in a row are 2 minutes, 10 minutes, 1 hour and 6 hours. A written summary removes the record; records older than 7 days are removed when a new one is saved. A page that cannot save to IndexedDB still honours the failure in memory. Sign-in failures (401, 403), rate limits (429) and network failures are not remembered: they cost nothing and clear on their own.
5. **The status is shown.** `documentsSummaryStatus()` reports `none`, `ready`, `pending` or `unavailable` (with the retry time) without asking the server. The session page's Call details shows, under Documents, "Documents summary unavailable: AI notes, Ask AI and Prepare cannot see the documents other than the CV until it is written. It will be tried again after HH:MM." Nothing is shown otherwise.

The routes that read the summary (`smartSessionBlock()`'s `<documents_summary>`, and the live answers' prefix) are unchanged: they always received a string, and its shape is the same.

## Consequences

- Large documents get a summary again: in the worst case it covers the earlier documents fully and says it stops early, instead of no summary at all.
- A summary that still fails (Claude unavailable, a refusal) is paid for at most once per wait, not once per open, notes, Ask AI and Prepare request.
- A summary of a very large document set can be up to 5,000 output tokens (about $0.0125 at the long-prompt Haiku rate), compared with 3,000 before; the input (the documents) is most of the cost either way.
- A summary written by an earlier version stays valid: it is the same text, kept under the same fingerprint.
- An existing device opens the database at version 13 the first time a new page loads; nothing existing changes.
- Failures are per device: another computer with the same session asks once itself before it backs off.

## Alternatives considered

- **Keep JSON and only raise the limit.** Rejected: any reply that reaches the limit still loses the whole summary, and the limit is reached by the size of the documents, which the user controls.
- **Stream the reply and keep what arrived.** Rejected for now: it has the same effect as `textReply()` with `max_tokens`, with more code. The background request at attach (the next step, "Fix 3") may stream.
- **Remember failures on the session.** Rejected: sessions sync to the account, so every failure would be a sync push and would show on other devices; a device-only store keyed by fingerprint also covers the same documents in two sessions.
- **Remember every failure, including 401 and offline.** Rejected: those cost nothing, and a backoff after them would delay the summary once the user signs in or is back online.

## Validation

- Unit tests: `tests/unit/server/claude.test.ts` (`textReply()`: no output format, cached rules, thinking off; a `max_tokens` reply and an empty reply are returned, not thrown), `tests/unit/server/summary.test.ts` (5,000 tokens = cap / 4; a cut-off reply kept to its last complete line with the note; a long reply cut at a line within the cap; `EmptySummaryError`; the route's 200 with `cutOff`, 502 with the stop reason and output tokens logged, no text logged), `tests/unit/core/documents/summary.test.ts` (the waits; which statuses are remembered; no request inside the wait; a failure stored by another page honoured; cleared on success; 401 and offline not remembered; in-page memory when storage fails; `documentsSummaryStatus()`), `tests/unit/core/storage/summaryFailures.test.ts` (keep, replace, clear, 7-day pruning, never in the outbox of an account cache), `tests/unit/core/storage/callsMigration.test.ts` (version 13).
- The answer and notes evaluation groups do not call the summary writer (their scenarios carry no generated summary), so they do not measure this change. The paid check that does is `pnpm --filter web measure:large-docs` (the 480k-character invented set through `writeDocumentsSummary()`); it is run only after the developer agrees to its cost.
- For the developer, after deploy: open a session with large documents, check the Vercel log shows `summary: done` with `stopReason` and no `summary: failed`, and that the notes mention facts from the later documents.
