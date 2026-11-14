# ADR-0080: Drive saves only the transcript PDF, the notes PDF and the main video

- **Status:** Accepted (developer's decision, 14 Nov 2026, on the test-call investigation, plan item P2-H; decision D3: keep recording the stereo file on the computer).
- **Date:** 2026-11-14
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Settings → Google Drive), §7.1–7.2 (Drive uploads, `/api/drive/notify`)
- **Supersedes / superseded by:** updates ADR-0072's file set (decision 5, "Folders and names", and decision 11's "every expected part and its stereo file") and ADR-0077 decision 6's upload order. Everything else in ADR-0072, ADR-0073, ADR-0074 and ADR-0077 stays.
- **Investigation:** `docs/investigations/2026-11-14-test-call-issues.md` section 7 ("Drive: PDFs only, main video only")

## Context

A test call on 14 Nov 2026 saved five files to Drive: `Transcript.txt`, `Transcript.pdf`, `Notes.pdf`, `Part 1.mkv` and `Part 1 stereo.webm`. The team reads the PDFs and watches the main video; the TXT repeats the PDF, and the stereo audio file (You left, Them right) is only useful on the computer that made it. The extra files make each call folder harder to read and the stereo file held the email back until it was uploaded.

## Decision

1. **The file set per call** is the transcript PDF (`call:<start>:transcript-pdf`), the notes PDF (`call:<start>:notes-pdf`) and each recording part's main video (`rec:<id>:main`, "Part N.mkv"). The keys and names do not change, so nothing already in Drive is uploaded again.
2. **No transcript TXT for Drive.** Both builders in `core/drive/callFiles.ts` stop making it, and the uploaders (`callUploader.ts`, `uploader.ts`) skip a TXT from any builder. The review page's TXT download is unchanged.
3. **No stereo upload.** The uploaders stop listing the stereo file. It is still recorded on the computer (decision D3; `features/live/useCallRecording.ts` and `core/recording/*` are unchanged).
4. **Only the main video is expected before the email.** The page reports every part with `stereo: false` (`core/drive/runner.ts`), and the server (`server/google/report.ts`, `missingRecordingFiles`) waits only for `rec:<id>:main`, so an older open page that still reports `stereo: true` cannot hold the email back.
5. **Jobs already queued.** When the queue run reads its jobs (`runCallJobs()`, `runDriveQueue()`), a job's **not-yet-sent** TXT and stereo entries are dropped; entries already in Drive are kept, so the reports and emails about those calls still list them. A job that had failed is queued again once, so a job that only waited on a dropped file finishes.
6. **Kept for older calls and older pages:** the `transcript-txt` file kind, the server's key patterns (`call:…:transcript-txt`, `rec:…:stereo`) and the email labels "Transcript (text)" and "Stereo audio".
7. **Nothing is deleted:** files already in Drive and everything on the device stay. The desktop app needs no change (its upload accepts either track).

## Consequences

- New call folders hold exactly `Transcript.pdf`, `Notes.pdf` and `Part N.mkv`; new emails list Recording, Transcript (PDF) and Notes (PDF).
- Calls saved before keep their TXT and stereo files in Drive.
- "Upload to Drive" for an older session (`backfill.ts`, `earlierCalls.ts`) uploads only what is missing from the new set.
- The stereo file is no longer backed up anywhere but the computer that recorded it.
- An older open page (not reloaded since the deploy) may still upload a TXT or stereo file once; the server accepts it, and the email does not wait for it.

## Alternatives considered

- **Stop recording the stereo file too:** rejected for now (decision D3); it stays useful for local checks of the two channels.
- **Delete the TXT and stereo files already in Drive:** rejected; Kite never deletes saved files.
- **Remove the `transcript-txt` kind and the stereo key pattern:** rejected; older open pages and older records must still validate.

## Validation

- Unit tests: `tests/unit/core/drive/{callUploader,uploader,callFiles,runner}.test.ts` (exactly PDF + PDF + main video; queued not-sent TXT and stereo dropped, done ones kept), `tests/unit/server/google/{report,email,api}.test.ts` (only the main video is waited for; older labels still work).
- Manual (investigation section 7): record a 1-minute call with transcript saving on; the call's Drive folder holds exactly `Transcript.pdf`, `Notes.pdf` and `Part 1.mkv`; the email arrives listing those three; an older call's folder still has its TXT and stereo files; "Upload to Drive" on an older session uploads nothing twice.
