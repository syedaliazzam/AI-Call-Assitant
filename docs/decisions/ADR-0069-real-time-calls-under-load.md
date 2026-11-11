# ADR-0069: Calls stay in real time on a busy computer (1.5.1)

- **Status:** Accepted (developer, 11 Nov 2026: "Report approved. Implement fixes 1–8 exactly as planned, plus 9")
- **Date:** 2026-11-11
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` 4.10.0, §5, §6.1, §6.2, §7.2, §7.4, §10
- **Supersedes / superseded by:** refines ADR-0034 and ADR-0066 (Accurate's queue), ADR-0043 and ADR-0062 (which question Answer takes), ADR-0067 (one document's cap), Day 6 Stage 4e (the silent-Them notice)

## Context

A real call on desktop 1.5.0 (11 Nov 2026, CV-only session) had answers 34–54 s after each question, the other person's lines very late, Ctrl+Enter answering the previous question, a duplicate answer, a card for "How are you doing?", a "(screenshot)" card, an earlier short call with no "Them" lines, and no Start Menu shortcut. The investigation (Vercel logs of that call, the code, a real-time harness on the i5-8350U laptop under a synthetic cover, an install check on a Windows runner) found:

- **Claude was not the cause:** first text 0.44–1.09 s on every request, cache hits, no errors, retries or rate limits (10M input tokens a minute).
- **The live speech engine fell behind real time** whenever the laptop neared saturation, and nothing bounded its queue: 12.7 s p50 / 20 s p95 behind with Accurate, 26 s p50 / 56 s max with Accurate and screen recording, while v1.3.2 on the same laptop kept up. The app itself had grown from about 1.1 cores (v1.3.2) to 2.6–4.0: the overlay renderer alone 0.09 → 0.6–0.9 core (a message and a re-render for every grey word, levels 8 times a second); Accurate's queue was unbounded (rewrites 11–22 s late at p95).
- Presses then answered what was already in the transcript. Independently, the user's own grey words ("So, um…" over the end of a question) pushed the newest question out of the window, a press while any answer streamed was dropped silently, and requests had no timeout.
- "Alright, uh How are you doing?" read as a question (the leftover "?" counted as a word); screenshot answers skipped the repeat guard; an empty chat bar's screenshot shortcut took a bare screenshot; the export gave the first call no divider.
- Large documents: about 476 KB uploaded per answer; two warm-ups per open; one document capped at 250k.
- The installer never recreates a missing Start Menu shortcut on an update (electron-builder's keep-shortcuts path), and the app never set its AppUserModelID.

## Decision

1. **Bounded backlog in the speech worker** (`core/stt/backlog.ts`). The worker measures how long each chunk waited (arrival − capture − the smallest such offset). Over 1 s: "You" audio is set aside (kept, at most 90 s) so the other side keeps up; over 3 s: the other side's audio is skipped until back under 1 s (the words so far become a line first); under 0.3 s for 5 s: normal, the set-aside audio decoded at up to 3 chunks per new chunk, and the rest at End before the final flush. The page gets a `backlog` message and the numbers in `stats`.
2. **Accurate never competes.** Web: `core/transcript/refineQueue.ts`: one rewrite runs, at most one waits (the newest), none older than 3 s, none while the worker is behind; auto-answer waits at most 0.5 s (1 s at first; 0.5 s from 11 Nov 2026, to reach the 3.5 s target), and only for a rewrite already running. Desktop 1.5.1: the engine's process runs at below-normal priority with one thread, and its own queue holds at most one waiting line.
3. **The overlay costs less.** State messages at most every 200 ms (the latest always delivered, the end of a call at once); level messages every 250 ms (was 120).
4. **Ctrl+Enter answers the newest speech at once.** Only a finished reply ends the question window (the user's grey words over the end of a question no longer push it out); a lone fragment among the new lines still looks back to its question (answering new lines as they stood sent 1–3-word fragments on the after-fix runs, so that part of the plan was reverted the same day); a press for newer speech during a streaming answer cancels it and answers; no reply within 8 s → sent again once, then "Claude is slow to start. Press Answer again."; screenshot answers join the repeat guard and mark their lines answered.
5. **Question rules.** Fillers and forms of address left over from a greeting are not a question; auto-answer drops Claude's `smalltalk` replies (a press still gets one); every answer's trigger (key, button, auto, chat, screenshot…) is logged; the chat bar's screenshot shortcut needs typed text.
6. **Large documents.** Request bodies of 64k characters or more are gzipped (`server/requestBody.ts` unpacks them and applies the 4 MB limit as sent and unpacked); one warm-up per open (reused for 60 s); the summary after the warm-up; one document may hold 500,000 characters, stored as parts of at most 250,000 (`core/documents/parts.ts`), each a normal synced record.
7. **Export:** every call of a multi-call session has its divider with its real start; a call that heard nothing from the other side says so.
8. **Installer (desktop 1.5.1):** `customInstall` creates the Start Menu shortcut whenever it is missing (with the AppUserModelID); the app sets `app.setAppUserModelId('co.paramountintelligence.kite')`.
9. **Silent channels.** `core/audio/channelSilence.ts`: a channel with no level for 15 s while the other talks gets a notice in the overlay and the call window ("We can't hear your microphone — check the 🎤 picker." / "We can't hear the other side — check the audio source."), with one click to the device list and platform advice (Windows privacy, default speaker). Device changes during a call re-open the default microphone or fall back to it (`core/audio/deviceWatch.ts`). While "You" is set aside: "Your lines will be filled in after the call."
10. **Call timing log** (`core/live/callTimings.ts`): ids and times only, the last five calls on the device, downloadable from Settings → Transcription with p50 / p95.

## Consequences

- Positive: transcript and answers stay near real time on a busy laptop; presses answer the newest speech; fewer wrong cards; large-document answers upload about 4× less.
- Negative: under heavy load the user's lines arrive later (at End at the latest) and, past 3 s behind, some of the other side's words are skipped (the notice says so). Accurate rewrites fewer lines when busy. A remark pressed for is sent to Claude (a "nothing to answer" reply costs one small request).
- Requires desktop 1.5.1 for the priority, threads, queue and installer changes; the rest is the web app.

## Alternatives considered

- **A second speech worker per channel:** doubles memory (two 204 MB models) and does not help when the CPU is saturated.
- **Dropping Accurate during calls:** loses the better words when the laptop has room; skipping only when busy keeps them.
- **Anthropic's Files API for documents:** would keep document text on Anthropic between calls (a data-handling change needing its own decision); gzip gives most of the upload saving without it.

## Validation

- Unit: `tests/unit/core/stt/backlog.test.ts`, `core/transcript/refineQueue.test.ts`, `core/live/{callTimings,callNotice,liveChannel}.test.ts`, `core/audio/{channelSilence,deviceWatch}.test.ts`, `core/documents/parts.test.ts`, `core/storage/sessions.test.ts`, `core/answer/{answerRunner151,repeatGuard,warm}.test.ts`, `core/transcript/{question,questionKind}.test.ts`, `core/review/conversation.test.ts`, `server/requestBody.test.ts`; desktop `accurate.test.ts`.
- The real-time timing matrix before and after (`docs/testing/benchmark-results.md`, "Calls under load, 1.5.1"); the Windows install check (GitHub Actions); the team-member demo with the call timing log.
