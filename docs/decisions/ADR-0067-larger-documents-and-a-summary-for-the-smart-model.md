# ADR-0067: 500k characters of documents per session, and a summary for the smart model

- **Status:** Accepted
- **Date:** 2026-11-10
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.8.0, §5, §7.1, §7.2
- **Supersedes / superseded by:** raises the document caps of ADR-0024 (§7.2: 150,000 per session, 100,000 per document)

## Context

Users want to attach more than 150,000 characters to a session (long handbooks, price books, several case studies). The live answers send every document in the cached session block on each request, and the smart-model routes (notes, Ask AI, Mock Interview, Question Bank) sent it too, uncached between calls.

Checked in the official docs on 2026-11-10 (Models overview, Pricing):

- `claude-haiku-5-5` and `claude-sonnet-5-5` both have a **1M-token context window** (128K output).
- 1M tokens is about 2.5M characters on the current tokenizer, so **500k characters is at most about 200k tokens**. The measured 480k-character test set was **164k tokens**. With the rules, a 40k-token conversation cap and an answer, a live request stays near 210k tokens, a fifth of the window.
- **Haiku 5.5 is priced by prompt length:** a request whose prompt is **over 100,000 tokens** (cache reads and writes included) pays $0.50 / $2.50 per MTok instead of $0.10 / $0.50, with a cache write of $0.625 and a cache read of $0.05. A session above roughly 250–300k characters crosses that line on every answer. Sonnet 5.5 has one price across the window ($2 / $10; cache write $2.50, read $0.10).

## Decision

1. **Caps:** 500,000 characters per session (all documents together), 250,000 per document (`core/documents/limits.ts`; the server's `MAX_DOCUMENT_CHARS` is `MAX_SESSION_DOCUMENT_CHARS` from `@kite/shared`). The wizard shows "used / limit characters used" and, above 400,000, "Very large documents can slow the first answer." Ask Kite attachments stay at 150,000: that chat sends them in full to the smart model on every message.
2. **Order:** the CV first, then the other documents oldest first (`sortDocuments()` in `core/answer/warm.ts`). The job description and the AI instructions are part of the session details, before every document. The CV is marked `kind: 'resume'` in the request. The prompt never shows the marker, so it changes no cache bytes.
3. **Live answers (Haiku):** unchanged in shape. Every document stays in the cached session block. `sessionBlock()` was split into two helpers with byte-identical output, pinned by a unit test. Cache hits after the first answer were measured (below).
4. **Smart-model routes:** `/api/notes`, `/api/ask` and `/api/prepare` (all kinds, including the Haiku feedback) get the session through `smartSessionBlock()`: the details, the CV in full, then `<documents_summary>`. The summary covers the documents other than the CV. It is written by Haiku through the new **`POST /api/summary`** (`server/summary.ts`: one section per document, names and figures copied exactly, under about 1,200 words, structured output) and kept on the session in IndexedDB (`Session.documentsSummary`, with a SHA-256 fingerprint of the summarised documents). The device writes it when a live session opens, alongside the warm-up, or before the first smart-model request otherwise. It is written again only when the documents change. A request without `documentsSummary` (a page older than this change) still gets every document, as before. If no summary can be written, the field is `''` and the smart model sees the CV and the details only.
5. `/api/summary` does **not** count towards the daily limit (like warm-ups): the device asks on its own, once per set of documents.
6. **Sync:** pushes are sized in UTF-8 bytes (`core/sync/size.ts`), the unit the server checks. String length under-counted text outside ASCII by up to 3×, so a batch of large non-English documents could pass the client and be refused by the server on every retry.

## Consequences

- Sessions can carry 3.3× more document text, and the live answers still read all of it from Claude's cache.
- **Cost rises for very large sessions.** Measured on a 480k-character session (164k tokens): the first answer (cache write) cost $0.103 and each cached answer $0.0087, so a 20-answer call comes to about **$0.27**, against about $0.02 at the old 150k cap (about 50k tokens, under the 100k price line). Each idle re-warm (4.5 minutes with no answer) adds about $0.008. Under the team's $20 a month, that is roughly 70 such calls. Sessions under about 250k characters stay under the 100k-token line and keep the low price.
- **Notes become much cheaper for large sessions:** $0.013 measured, instead of about $0.41 had every document been sent, plus a one-off summary of $0.082 per set of documents.
- The smart model now reads a summary of the non-CV documents, not their full text, so a detail missing from the summary is unavailable to notes, Ask AI and Prepare. The summary heading tells the model that. The live answers are unaffected.
- The first answer of a call with no warm-up takes longer (measured 2.9 s to the first word at 164k tokens, against 1.1–1.4 s cached). The warm-up at session open normally hides it.

## Alternatives considered

- **Send everything to Sonnet too:** about $0.41 per notes request and each Ask AI or Prepare request at 480k characters, against a $20 monthly budget. Rejected.
- **Summarise on the server per request:** no persistent store for call data on the server (ADR-0024, ADR-0049), so it would re-summarise on every request. Rejected.
- **Reuse the live answers' cache for the summary request:** it would need the answer rules (which ask for hidden reply lines) as its prefix and is only cheaper when the warm-up is still alive. Rejected for simplicity.
- **A higher cap (up to the 1M window):** past 500k characters every Haiku answer pays the long-prompt price, first answers slow further, and requests approach the 4 MB body limit for non-English text. Rejected for now.

## Validation

- Unit tests: limits, validation (500k total, CV kind, summary, 150k attachments, `/api/summary` body), `sessionBlock()` bytes unchanged, `smartSessionBlock()`, the summary route and module, CV-first ordering, notes request, UTF-8 sizing, and a two-device sync of 250k-character documents (one in a 3-byte script) through the real server store and encryption.
- `pnpm --filter web measure:large-docs` (480k-character invented set): numbers in `docs/testing/benchmark-results.md`.
- Evaluations: `answers` and `cv-embellishment`, once each (`docs/testing/answer-eval.md`).
- Rollback: revert the merge and redeploy the web app. Stored summaries are an extra session field that older code ignores. A session with more than 150,000 characters of documents then fails validation on answers until documents are removed, so check sizes before rolling back.
