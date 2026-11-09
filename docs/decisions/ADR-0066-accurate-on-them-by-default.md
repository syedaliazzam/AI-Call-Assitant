# ADR-0066: Accurate transcription on by default, on "Them" during the call, "You" after it

- **Status:** Accepted (developer's plan of 9 Nov 2026, Phase 5a)
- **Date:** 2026-11-10
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1, §10
- **Supersedes / superseded by:** changes ADR-0044's default (Auto, no automatic download)

## Decision

- **On by default, on battery too.** The choices are On (the default), "Only when plugged in" and Off. A device that never changed the setting (the old Auto) becomes On; a stored On or Off is kept.
- **The model downloads by itself:** 5 s after the desktop app's home panel opens, the 661 MB Parakeet model starts downloading (or resumes), unless the setting is Off. A card shows the progress (`features/home/AccurateDownload.tsx`). A failure is retried at the next start of the app.
- **During the call, only the other person's lines** are rewritten. They make the questions, and auto-answer uses their new words (ADR-0062: it waits at most 1.5 s for them).
- **The user's lines after the call:** their audio is kept in memory, per line (at most 20 minutes), and after End each saved line is transcribed again and saved again (`core/transcript/afterCall.ts`). Nothing is kept when the transcript is not saved.
- **2 decoding threads** (was 4).
- **A re-ask does not wait for the accurate words.** On the synthetic calls that wait let the user's first words cancel the re-ask, and the rest of the question got a second card.

## Measured (10 Nov 2026, i5-8350U, 4 cores; synthetic headphones call, `stt:calls --accurate`)

| | No Accurate | 4 threads (2 runs) | 2 threads |
|---|---|---|---|
| WER as shown, You / Them | 7.3% / 5.1% | 0.6% / 4.0% | 0.6% / 4.0% |
| Questions answered whole, duplicates | 7/7, 0 | 7/7, 0 | 7/7, 0 |
| Question end → answer sent p50 | 2.2 s | 3.1 / 2.7 s | 3.3 s |
| One "Them" line decoded, p50 / p95 | — | 1.0 / 2.4 s | 1.7 / 3.1 s |
| Engine CPU during the call | — | 0.62 / 0.54 core | 0.40 core |
| 14 "You" lines after the call | — | 27 s | 34 s |

2 threads was chosen for its lower CPU (on battery by default), at about 0.7 s more per line. The cost of Accurate is about +1 s before an auto-answer is sent, for the better words.

## Consequences

- The 661 MB download starts without a click (on a metered connection the user can set Off).
- More CPU during calls; "Only when plugged in" saves battery.
