# Production readiness investigation: 12–13 Nov 2026 calls

- **Date:** 13 Nov 2026
- **Scope:** investigation and architecture design only. No product code, migrations, deploys or releases were changed.
- **Versions:** desktop 1.6.2, web = production at the time of the calls (main at `4ac4a9f`).
- **Machine:** Intel Core i5-8350U (4 cores / 8 threads, 1.7 GHz base, 15 W), 23.8 GB RAM, Intel UHD Graphics 620 (driver 31.0.101.2121), Windows 11 Pro 10.0.26200, Balanced power plan.

**What this document covers:**
- Root causes of the seven problems you observed.
- Two follow-up questions: the Drive recording upload and the missing "saved" emails.
- The capture and recording architecture as it is today.
- The target architecture with Deepgram on both channels.
- A latency budget, the question-selection rules, the call data model, hotkeys, recording, and a phased plan with test steps.

## How to read this

- **PROVEN** means the code makes it certain, or a measurement on this machine or a production record shows it.
- **SUSPECTED** means it is plausible but not shown; each one says what would prove it.
- Code references are `path:line` at `4ac4a9f`.
- No transcript text, document text, secret, email address or id appears here: only times, counts and states.

## Evidence used

| Source | What it gave | Privacy |
|---|---|---|
| Code reading (`apps/web`, `apps/desktop`, `packages/shared`) | the mechanisms, `file:line` | — |
| Vercel CDN request records, production, 12 Nov 08:38 → 13 Nov 02:03 local | every request's time, path, status, desktop/browser, edge region. Runtime logs were gone: the Hobby plan keeps 30 min. | paths only; session ids replaced by S1, S2 … |
| A **copy** of the desktop profile's `kite.callTimings` (the call timing log, last 5 calls) | per-line and per-answer times, the speech worker's backlog each second, notices | ids and times only (the log holds no text) |
| A **copy** of the desktop profile's IndexedDB, read in a hidden window with string values replaced by their length | which records exist per call: lines, notes, answers, Drive job, recordings | counts, states and times only |
| `recordings.json` and the recording files in Documents › Paramount AI › Recordings | frame timestamps (Mediabunny, no decoding); per-100 ms levels of the stereo file | numbers only |
| `powercfg /batteryreport` | AC or battery during each call | — |
| Production DB `drive_notification`, read-only transaction | status, attempts and created/sent times of the notification records | no ids, no content |
| Vercel env var and deployment timestamps | when SMTP settings reached production | names only, values never read |
| Measurements on this machine (13 Nov, 01:45–02:30, on AC) | screen capture and encoder CPU per process; the local speech stack's CPU on the real-call replay; network round trips | — |
| Deepgram streaming from this machine (13 Nov, ~02:06–02:30) | Nova-3 and Flux first-word, last-word, end-of-turn and flush latency; WER on synthetic calls and on the real call's "You" channel; US vs EU endpoint; multichannel | about 107 audio-minutes ≈ $0.82 of the free credit; numbers only in this document |

---

# A. The problems, one by one

## A1. Recording ON breaks the call (Them questions missing, answers to an old question, ~11 fps)

### Reproduction

1. Run desktop 1.6.2 **on battery**, with Accurate on (the default).
2. Start a call with the Claude voice assistant as Them.
3. Turn on Screen + audio recording and talk for 10 minutes.
4. Compare with recording off.

### Evidence

The call is 13 Nov 00:49:38 → 01:06:08. Its recording ran from 00:50:21 for 557 s, i.e. call seconds 42–599. All rows below are PROVEN from the timing log and the files.

| | Recording ON (call s 42–599) | Recording OFF (s 0–42, 599–989) |
|---|---|---|
| Speech worker state, seconds | ok 47 · you-paused 222 · **dropping 26** | ok 118 · you-paused 252 · dropping 0 |
| Worst queue wait p50 / p95 / max | 281 / 3,556 / 4,596 ms | 161 / 1,703 / 2,464 ms |
| "Dropping" episodes (Them audio skipped) | **20** (1–3 s each, waits 3.0–4.6 s) | **0** |
| Them speech → first grey words, p50 / p95 | 1.62 / 2.87 s | 1.26 / 2.06 s |
| Them speech end → final line, p50 / p95 | **3.03 / 3.97 s** | 2.05 / 2.68 s |
| "You" speech end → final line, p50 | 46.5 s ("You" set aside nearly all the time) | 82 s |
| Auto-answer: speech end → asked, p50 | 3.66 s (n=3) | 0.74 s (n=5) |
| Speech end → first answer word, p50 / p95 | **4.6 / 20.4 s** | 2.0 / 42 s (one old-question press) |
| Presses answering speech that ended long before a **newer** Them line | 1 (the newer line was 17 s newer) | 1 (36.7 s newer) |
| Recording frame rate | **11.37 fps** steady (frame gap p50 84 ms, p95 122 ms, longest 1.0 s) | — |
| `deferredDroppedMs` ("You" audio thrown away) | 41.4 s for the call | |

**Them speech that never became a line (PROVEN).**
- Method: the stereo file's right channel (Them), voice above the noise floor for at least 0.8 s, compared against the log's Them lines with ±1.5 s slack.
- During the recording, **10 of 30 Them speech segments, 36 s of 107 s, produced no Them line at all.**
- Them was not quiet: −22 dBFS p50 in the file after its −6 dB mix gain, the same as the 11 Nov call (−21 dBFS).

**Power (PROVEN, battery report).**
- The laptop went **onto battery at 00:48:57** and stayed there until 01:39.
- The 12 Nov 22:25 call was on AC, and its recording held **14.6 fps** (11 Nov 14:31: 14.7 fps).

**Recording itself is light on AC (PROVEN, measured today on AC, screen capture with the encoder writing nothing).**

| Phase, 35 s each | Browser | GPU | Page | Total | Frames delivered |
|---|---|---|---|---|---|
| Idle (a small animated window only) | 0.01 | 0.23 | 0.14 | 0.37 core | — |
| Screen capture 720p, max 15 fps | 0.13 | 0.19 | 0.11 | 0.42 | 14.4 fps, 0 discarded |
| **Kite Standard:** hardware H.264, MKV, 720p, max 15, 1.5 Mbps | 0.12 | 0.20 | 0.10 | 0.42 | 14.6 fps, 0 discarded |
| Proposed light: H.264, 960×540, max 10, 0.8 Mbps | 0.06 | 0.20 | 0.12 | 0.38 | 9.9 fps |
| Fallback: VP8, 720p, max 15 (software, in the page) | 0.12 | 0.16 | **0.31** | 0.58 | 14.6 fps |

- Hardware H.264 is really available: WebCodecs `prefer-hardware` is supported, and the GPU reports video_encode enabled.
- Capture plus hardware encode costs about **+0.05 to +0.13 core** over idle.

### Root causes

**R1. The local speech engine cannot keep up on this laptop on battery, with or without recording. PROVEN.**
- One WASM thread decodes both channels and also runs AEC3, the coupling gate and the backlog logic (`core/stt/stt.worker.ts:436-480`, `numThreads:1` at `:270`).
- Smart Turn, punctuation and Accurate (a utility process, 1 thread, below-normal priority, `apps/desktop/src/main.ts:620-636`) compete for the same 4 throttled cores, and so does the Claude voice app.
- Even with recording off, the worker was behind by more than 1 s for 252 of 370 s, so **all "You" audio was set aside** (`core/stt/backlog.ts:25`).
- Recording adds the screen capture (browser and GPU processes), a third AudioContext with a compressor mix and two Opus MediaRecorders in the call's own renderer (`core/recording/recorder.ts:130-158, 276-330`). That was enough to push the worker past 3 s, so **Them audio was skipped** (`backlog.ts:28`, `stt.worker.ts:465-469`): 20 times, only while recording.

**R2. The stuck-engine watchdog restarts the engine during normal talk. PROVEN mechanism, PROVEN that it happened.**
- The watchdog counts sound on **either** channel (`features/live/LivePage.tsx:801-802`) but progress only from decoded lines. While "You" is set aside, the user speaking for 8 s with Them silent looks like a stuck engine (`core/stt/watchdog.ts:19`, `LivePage.tsx:733`).
- `restartEngine()` (`LivePage.tsx:681-710`) loads a **second 200 MB model on an already saturated CPU**. It then stops the old worker. That discards its set-aside "You" audio (41 s were thrown away), plus whatever chunks were still queued.
- Proof that it happened: the worker's `droppedMs` only grows while a worker lives. The log ends with `droppedMs = 0` after 26 s in the dropping state, so the final worker started **after** the last drop. Restarts are not written to the timing log (gap: see I. Trace).
- Them speech lost around restarts and during dropping explains the 10 Them segments with no line, and the "question not captured at all".

**R3. The press then answers what is in the transcript: an older question, or a fragment. PROVEN.**
- When the newest question is missing or late, the press falls back to "the newest real question of the call" (`core/answer/pressQuestion.ts:116-176`, `core/transcript/question.ts:219-224`), and the repeat guard shows that **old card** (`core/answer/repeatGuard.ts:204-213`). See E.

**R4. The ~11 fps. PROVEN by elimination, with one SUSPECTED detail.**
- The code asks only for a maximum frame rate (`platform/recording.ts:31-36`), so frames come at the capturer's pace.
- On 13 Nov they came steadily every ~84 ms (not in bursts): the capture thread was being starved, not idling on a static screen.
- The same code on AC gives 14.4–14.7 fps (two earlier recordings, and today's test).
- So: the battery-throttled CPU was saturated by the speech stack. Exactly which thread in the browser/GPU process missed its schedule is SUSPECTED; it needs a trace on battery.

### Proven vs suspected
- PROVEN: R1, R2, R3, and that recording correlates with all the dropping.
- SUSPECTED: how much each process contributed on battery. Prove it with a per-process CPU run on battery (I. Phase 0 test T0.2).

### Severity
P0 (production blocker).

### The fix
1. Move speech-to-text off this laptop (Deepgram on both channels, section C). The local engine becomes a fallback only.
2. Fix the watchdog: count only the channel the worker actually decodes, and never restart while backlog ≠ ok.
3. Fix the press rules (E).
4. Make recording yield under load (H).

## A2. Latency: Them words late, question detected late, ~3 s to the answer

### Evidence
PROVEN, from the 00:49 call's timing log, recording-off part:
- Them first grey words come **1.26 s** after speech starts (p50).
- The final line comes **2.05 s** after speech ends.
- Auto-answer asks **0.74 s** after the end (p50).
- The request takes **1.34 s** (p50; p95 1.92 s) from sent to first word, with small documents (4,983 characters; requests of 10–30 KB).
- Speech end → first word: **2.0 s p50**. With recording on: 4.6 s.

### Root causes
1. The local streaming model itself:
   - first words 0.6–0.86 s on a free CPU (benchmark 1.5.2), 1.26 s here;
   - final lines wait for 1.0 s of decoded trailing silence (`stt.worker.ts:48, 289`) or 1.2 s without a new word (`core/stt/channel.ts:41`).
2. Auto-answer timing (`core/answer/autoAnswer.ts:41-64`):
   - it waits for the end-of-turn model (pause message after 300 ms of quiet, `channel.ts:47`, plus Smart Turn, 0.3–0.5 s);
   - else 1.2 s, or 3 s if the words look cut off;
   - plus up to 0.5 s for Accurate.
3. The request path:
   - Pakistan → Mumbai edge → **iad1** function (`apps/web/vercel.json`), measured from here as TTFB 0.51 s p50 for a trivial authenticated route;
   - `countRequest` (a database round trip) runs **before** the Claude call (`app/api/answer/route.ts:222-233`);
   - Claude Haiku's first token: 0.59 s server-side with the CV only (benchmark v1.2.0);
   - the hidden meta line before the first visible word;
   - up to 200 ms of overlay state throttling (`core/live/liveChannel.ts:622`).

### Severity
P0 for the target.

### The fix
Section D: Deepgram first words in ~0.3–0.5 s, turn end from Deepgram, Finalize on press, speculative answer at the pause, and the request path trimmed.

## A3. Ctrl+Enter answers an incomplete question

### Evidence
PROVEN:
- 15 of the call's 29 presses were answered from **grey** words.
- In 19 of 29 presses, the Them line being spoken had ended up to 2.2 s **before** the press, yet its final arrived **0.1–3.3 s after** the press.
- The words Claude got were whatever the worker had emitted by then.

### Root cause
PROVEN:
- Nothing flushes or waits for pending audio when the key is pressed. The worker has no flush message (`stt.worker.ts` `onmessage`: load/attach/accept/reset/detach/set-hotwords/ping/stop).
- The press reads `transcript.lines()` synchronously (`features/live/useLiveAnswers.ts:555`).
- It only waits when the grey line is **not yet** a question (`pressQuestion.ts:146-154`). "How would you design a rate limiter for a public" counts as a question and is sent as is.
- The "grey press is asked again when the words grow" rule never fires for the usual 1–3-word tail:
  - grey `tEnd` is page arrival time, final `tEnd` is capture time, so the final looks older (`core/transcript/transcript.ts:582` vs `channel.ts endUtterance`);
  - `GROWN_WORDS = 2` (`autoAnswer.ts:271, 403`).
  - This was reproduced with the real code by the investigation's throwaway scripts.

### Severity
P0.

### The fix
- On press: Deepgram **Finalize** (Nova-3) or "processed up to the press" (Flux), wait at most 300–400 ms, then build the question.
- One clock for all line times.
- Any growth within 2 s re-asks the question on the same card (E).

## A4. Ctrl+Enter sometimes doesn't answer and seems to "toggle listening"

### Evidence and cause
**PROVEN, the press waits.**
- When the newest Them line is grey and not yet a question, the press waits up to 8 s (`pressQuestion.ts:30`) and shows **"Listening for the question…"** (`useLiveAnswers.ts:97, 612`). The overlay strip normally says "Listening…", so it reads as listening being toggled.
- 4 of the call's presses waited before sending: 0.9, 1.3, 1.6 and 3.3 s.
- A **second press restarts** the wait instead of forcing an answer (`useLiveAnswers.ts:597`).

**PROVEN, silent no-ops.**
- A press for the same speech while it streams is ignored, and a press on already-answered speech shows the old card (`repeatGuard.ts:199-213`).
- Neither gives feedback nor a log entry. The log only records presses that were sent (`useLiveAnswers.ts:682-693`).

**SUSPECTED: another app holds the shortcut.**
- `globalShortcut.register` fails silently when another app holds Ctrl+Enter (`apps/desktop/src/hotkeys.ts:23, 139-155`). The key then goes to the focused app; if that is the Claude voice app, it may act on it.
- To prove it, look at Settings → Hotkeys (it checks for taken keys), or the "taken" notice in the overlay.

**Ruled out:**
- A focused button being clicked: `keymap.ts:156-161` calls `preventDefault`.
- Call hygiene: it needs 10/30 minutes without Them audio (`core/live/hygiene.ts`).

### Severity
P1.

### The fix
G.

## A5. Them (system audio) quiet or late with the Claude voice assistant

### Evidence
- **Not quiet.** PROVEN: Them was −22 dBFS p50 / −15.5 dBFS p90 in the stereo file, which is mixed at −6 dB, so roughly −16 dBFS at the source. That is well above the gate's −48 dBFS floor (`core/stt/gate.ts:107`). The earlier call was the same.
- **Late and lost:** this is A1 and A2.
- The **15 "We can't hear the other side" notices** in the call fire when Them has no level for 15 s while the user talks (`core/audio/channelSilence.ts:18`).
- PROVEN against the stereo file for the 8 inside the recording: Them was silent (0.0 s voiced) in the 15 s before each one. 4 came while the user was answering (9–13 s voiced), 4 while both were nearly quiet.
- So the notice is literally true but meaningless in an interview, where Them is silent while you answer.

### Root cause
Lateness and loss are A1/A2. The notice rule is wrong for interviews.

### SUSPECTED, for the "quiet" impression
- The Claude app may play to the **communications** device. Windows loopback captures the default render device. Nothing re-opens Them when the default device changes; only the mic is re-opened (`LivePage.tsx:1095-1098`).
- To check: Sound settings → Playback; see whether the Claude app's output is "Default Device" or "Default Communications Device"; Communications tab → "Do nothing".

### Severity
P1.

### The fix
- Deepgram on Them (C).
- Re-open the loopback when the default output device changes.
- The silence notice only when Them has been silent for more than 60 s **and** the user is not speaking.

## A6. "Start again": the session page shows the old transcript and AI notes

### Evidence
PROVEN, desktop profile copy at 01:44:
- The 00:49 call saved **62 lines (47 Them, 15 You) and 36 answers**, all synced (outbox empty).
- The session's only AI-notes record is still the **00:21 call's** (created 00:22:45).
- `/api/notes` was called at 01:06:08 and returned 200, but nothing was saved.
- At 01:06:20 the browser opened the session page.
- At 01:06:26 the desktop **panel's** Drive uploader ran (the shell shows the panel at every call end, `apps/desktop/src/main.ts:736`). It processed the session's existing job, which did not contain the 00:49 call.

**Why both the notes and the Drive queue are missing:**
- PROVEN that both are missing.
- SUSPECTED which of two things caused it:
  - (a) the call page closed or navigated before the notes reply arrived. Notes are saved only by that page after a 200, and the Drive queue runs only in that page;
  - (b) the page stayed, the notes reply body failed to read (`generateNotes` then returns `failed`), and the Drive queue still waits on the Accurate rewrite of the "You" lines (`LivePage.tsx:978-995, 1023`). Today's replay shows "You" lines set aside most of the call, and the rewrite runs one line at a time on a busy CPU.
- Your answer settles it: did the call window close, or did you navigate it, within a minute of End? Either way the fix is the same: after-call work outside the page (F3).

### Root causes
1. **Notes are one record per session, keyed by the session id.** PROVEN.
   - `core/storage/types.ts:346-353`, `core/storage/db.ts:107-108`.
   - A new call only replaces them if its notes save. Here they never saved, so the session page shows another call's notes with no label saying which call.
2. **The after-call work lives in the call page and is lost if the page closes, or waits on the slow Accurate rewrite.** PROVEN mechanism; which of (a)/(b) above happened is SUSPECTED.
   - Notes (`LivePage.tsx:999-1017`), the Accurate rewrite of every "You" line (`:978-995`) and the Drive queue (`:1023-1027`) all run after End.
   - The shell protects the window only while `callActive` is true (`main.ts:295-302`), and End sets it false.
   - Notes are a single non-streaming response (`core/notes/generate.ts:183-200`). Closing the page ~12 s after End loses them.
3. **The session page reads only the browser's local copy, once.** PROVEN.
   - `features/review/SessionReview.tsx:114-124`; `core/review/load.ts:54-65`; no listener on `onSyncApplied`.
   - "View transcript" on the desktop opens the system browser (`features/home/LauncherSessions.tsx:301-305`), whose copy is from before the call until a reload.
4. **One transcript list per session, oldest call first.** PROVEN (`features/review/ConversationSection.tsx:373-377`). The old calls fill the top.

### Severity
P0 (data looks wrong).

### The fix
F (a call record; notes per call; the session page lists calls newest first and reloads after sync); after-call work moved out of the page's lifetime (I, P0-4).

## A7. Drive: no video, an older call's transcript, two transcripts

### Evidence

**The Drive job (PROVEN, profile copy).** The session has **one** Drive job (`driveUploads` keyed by session id, `db.ts:220-222`) with five calls:
- 11 Nov 23:19:56
- 12 Nov 23:16:01
- 12 Nov 23:16:59
- 12 Nov 23:19:09
- 13 Nov 00:21:46

**The 00:49 call is not in the job:** neither its transcript nor its recording was ever queued.

**What did upload (PROVEN).**
- Every recording of a queued call: 11 Nov 23:19 and 12 Nov 23:16, main + stereo, `done`.
- Transcripts (TXT + PDF) of all five queued calls.

**Never queued, so never uploaded (PROVEN).**
- The 12 Nov 22:25 call (2 recording parts), whose call ended before the company folder was chosen (`POST /api/google/folder` at 23:14:56). Nothing re-queues a call made before the folder existed.
- The 13 Nov 00:49 call.

**The transcript with "Nothing was heard from the other side" (PROVEN).**
- It is the **12 Nov 23:19:09** start of the same session: its timing log has **0 Them lines** (25 You lines; the Them channel heard nothing).
- It is not a mix-up of calls; it was a separate start.

**The two transcripts (PROVEN).**
- Each call saves a **TXT and a PDF** (`core/drive/callFiles.ts:146-157`).
- There are also two separate 23.16 starts (23:16:01 and 23:16:59), each with its own TXT + PDF.

**Upload order (PROVEN, CDN).**
- The 00:21 call's transcript files were uploaded at **00:49:34–36**, while the next call was starting.
- Its notes PDF and 4 notification reports followed at 01:06:28–35, from the panel's uploader.

### Root causes
1. **The call is queued only after notes, the "You" rewrite and recording finalising have all settled, inside the call page.** PROVEN (`LivePage.tsx:1023-1027`). That chain never completed for the 00:49 call (A6: page gone, or the rewrite still running), so the call was never queued.
2. **A call made before Drive was set up is never queued later.** PROVEN (`core/drive/queue.ts`; there is no backfill for one call).
3. **One Drive job per session, files in strict order.** PROVEN.
   - A recording that fails or pauses stops every file after it, including the next call's transcripts (`core/drive/uploader.ts:409-410`).
   - Not what happened here, but the same family of failure.
4. **A latent shell bug that would also stop recordings.** PROVEN in code, not what happened here.
   - If the call window closes **during** a call, `main.ts:303-312` clears the shell's `callActive` but never calls `drive.setCallActive(false)`.
   - The next "call ended" message is then ignored because nothing changed (`main.ts:731`).
   - From then on the shell answers every recording upload with `paused` (`apps/desktop/src/drive/upload.ts:163`, `drive/host.ts:104-107`) until another call starts and ends.

### Severity
P0.

### The fix
F (one Drive job per call; transcripts and notes before recordings; each file independent; "queue missing calls" for calls made before Drive was set up) and the shell fix (needs a desktop release).

## A8. Follow-up: the recording still not uploaded after the company folder was chosen

### End-to-end path in 1.6.2 (PROVEN; ADR-0074)

1. **After End**, `queueCallForDrive(session, {startedAt, endedAt})` adds the call to the session's job and sets it `queued` (`core/storage/driveUploads.ts:54-87`). This runs only once all after-call work has settled (A7 cause 1).
2. **`runDriveQueue`** (`core/drive/uploader.ts:808-…`), in any open Kite page (`features/drive/DriveUploader.tsx`, mounted in the app layout):
   - returns at once if a call is active;
   - lists the shell's recordings index (`kiteDesktop` → `apps/desktop/src/recordings/manager.ts`, `recordings.json`);
   - matches recordings to calls by **start-time window**, not by the recording's `meetingId` (`uploader.ts:237-246`).
3. **For each recording file:**
   - the page asks the shell for its size (`drive/host.ts:103`);
   - `POST /api/drive/uploads` makes the server start a Google **resumable upload** with the company token. It returns only the session address (`uploadUrl`) and a signed ticket (`server/google/api.ts:839-857`), or `exists` when a file with this tag is already there;
   - the page passes the address to the shell, which uploads in 8 MiB chunks **without any token**, starting at the server-given offset, and returns the MD5. It answers `paused` while a call is active (`drive/upload.ts:155-170`);
   - `POST /api/drive/uploads/complete`: the server checks size, MD5 and tag, and only then accepts the Drive id.
   - A resume uses `POST /api/drive/uploads/offset`.
4. **Transcripts and notes** go through `POST /api/drive/files` (server-side upload).
5. **The report:** `POST /api/drive/notify` (A9).

**In this case:** the recordings that went through this path did upload (23:16 and 23:19, main + stereo; `uploads`, `uploads/complete` at 23:16–23:19 in the CDN records). The two missing videos (12 Nov 22:25 and 13 Nov 00:49) **never entered the path**, because their calls were never queued.

### What you can check on your machine now
1. Meetings (desktop): the 12 Nov 22:25 (two parts) and 13 Nov 00:50 recordings are listed as "Saved on <this computer>". The files exist (`Documents › Paramount AI › Recordings`, 1.8 + 2.2 MB and 14.2 MB).
2. In the Drive session folder, `Recordings` holds only "2026-11-11 23.19 Part 1" and "2026-11-12 23.16 Part 1" (each with its stereo file). `Transcripts` holds files for 11 Nov 23.19, 12 Nov 23.16 (twice), 12 Nov 23.19 and 13 Nov 00.21, and **nothing for 00.49/00.50**.
3. The session card's Drive status on the desktop shows the job as done, because the missing call is not in it.
4. Nothing re-uploads these two calls today without the fix. The browser's "Upload to Drive" button (on a session the browser has no job for) guesses calls from the browser's copy and can create **duplicate** transcripts (`core/drive/backfill.ts:41-104`), so don't use it on this session before the fix.

## A9. Follow-up: no "call saved" email

### Evidence
**Production records (PROVEN, read-only query).** The account has **5** `drive_notification` records, **all `not-set-up`, 0 send attempts**:
- 11 Nov 23:21 (the session's first record);
- 12 Nov 23:22 (per call);
- three at 13 Nov 01:06 (per call).

SMTP was never tried.

**SMTP config (PROVEN, Vercel).**
- `SMTP_HOST`/`SMTP_PORT` were added 11 Nov 23:31, after the first record (23:21) was written: that one is a true "not set up".
- `SMTP_USER` 22:43, `SMTP_PASS` 22:44 and `NOTIFY_FROM_EMAIL` 22:45 on 12 Nov, followed by production deploys at 22:45:38, 23:05 and 00:14.
- So all later reports ran with SMTP configured.

### Root cause: a per-call email bug. PROVEN.
1. This session's Drive job was created on 11 Nov, before the combined email.
2. When the 1.6.x uploader first saw it, it marked the **whole job** `manualEmail = job.notified` (= true), meaning "never email automatically; Send email by hand" (`core/drive/uploader.ts:815-818`).
3. Every later call of the session is reported with `manualOnly: true` (`uploader.ts:626`).
4. The server stores each call's record as `not-set-up` (`server/google/api.ts:1232`), and `sendIfDue` returns at once because the status is not `collecting` (`api.ts:1142`).
5. So **no call started again in a pre-1.6 session is ever emailed automatically.**

### Not the cause here, but it would delay emails: the all-files rule
- A call's email waits until **every expected recording file** is in Drive, or 24 h after the first report (`server/google/report.ts:18, 184-193`).
- The 24 h path is re-checked only on Settings requests or by the **daily** cron at 06:00 UTC (`vercel.json`), so the wait can be up to ~48 h.
- A call that is never reported (00:49) gets no record at all, so not even the 24 h fallback applies.

### The Gmail SMTP settings themselves are unproven
- No email has been attempted with them.
- Settings → Google Drive → **Send test email** (`handleTestEmail`, `api.ts:~1360`) proves them in one click.

### Recommended rule (this replaces "all files or 24 h")
1. **Email 1, "Call saved", is sent as soon as the call's transcript and notes are in Drive.** It holds the call's date and length, links to the TXT/PDF/notes, a link to the session's `Recordings` folder, and "Recording: uploading…" when a recording is expected.
2. **Email 2, "Recording saved"**, is sent only if a recording was expected and was not in email 1, as soon as all its parts are in Drive. It is short: links to the part(s). No second email if the recording was already in email 1.
3. If the recording is not in Drive 24 h later, a short "Recording not uploaded: open Paramount AI on <computer>" email replaces email 2. The cron runs **hourly** instead of daily.
4. A call with no transcript saved (Save transcript off) still gets email 1 with the recording folder link.
5. `manualEmail` no longer exists per job. Calls already emailed keep their `notified` flag per call (ADR-0073), and that flag alone prevents duplicates.
6. One-time repair for the existing records: the four per-call `not-set-up` records of this session are offered in Settings → Recent notifications with **Send email** (this already works by hand). No automatic resend of old calls.

---

# B. Capture and recording architecture today

## B1. The graph

```
                         ┌──────────────────── Call page renderer (main window, backgroundThrottling:false) ───────────────────┐
 Mic ─ getUserMedia ───► │ MediaStream "You" (echoCancellation/noiseSuppression/AGC on, platform/media.ts:25-56)              │
  (AEC/NS/AGC in the     │                                                                                                    │
   audio service)        │  AudioContext #1 (hardware rate) ─ 2× Analyser ─ setInterval 50 ms (main thread): levels, silence, │
                         │      notices, watchdog sound (core/audio/capture.ts:196-266)                                       │
 System audio ─ getDisplayMedia(video:true, audio:{processing off}) ─ shell grants {screen, audio:'loopback'} (desktop/media.ts│
  (WASAPI loopback in    │      :100,164-177); video track stopped at once (platform/desktop.ts:53-56,162-165) → "Them"       │
   the audio service)    │                                                                                                    │
                         │  AudioContext #2 @16 kHz ─ AudioWorklet ×2 (render thread) ─ 100 ms Float32 chunks ─ MessagePort ─┐│
                         │                                                                                                   ││
                         │  Web Worker: speech (1 thread, sherpa-onnx WASM zipformer, numThreads 1)   ◄──────────────────────┘│
                         │    AEC3 (WASM) on You with Them reference → coupling gate → energy gate → decode Them / hold You  │
                         │    backlog controller (pause You >1 s, drop Them >3 s) → partial / final / pause / stats → main    │
                         │  Web Worker: Smart Turn (ORT WASM, 1 thread; 8 s of audio per pause)                               │
                         │  Web Worker: punctuation (ORT WASM, 1 thread)                                                      │
                         │  Main thread: transcript, auto-answer (250 ms tick), presses, overlay publish (200 ms), answers    │
                         │                                                                                                    │
                         │  RECORDING ON adds:                                                                                │
                         │   getDisplayMedia #2 {video ≤1280×720, frameRate max 15, audio:false} → shell grants video only    │
                         │     (no second loopback; Them track not replaced) (platform/recording.ts:31-36)                    │
                         │   AudioContext #3 @48 kHz: You×0.5 + Them×0.5 → compressor (limiter); stereo merger + 2 limiters   │
                         │     (core/recording/recorder.ts:130-267), same Them track objects (not cloned)                     │
                         │   MediaRecorder #1: video/x-matroska avc1.42E01F (hardware H.264) + Opus 96k, 1.5 Mbps, 1 s slices │
                         │   MediaRecorder #2: stereo Opus 64k, 1 s slices                                                    │
                         │   each slice: blob.arrayBuffer() on main thread → IPC invoke (~200 KB/s)                           │
                         └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Browser (main) process: screen capturer, IPC, file appends in order (apps/desktop/src/recordings/manager.ts:402-429)
 GPU process: H.264 encode (Media Foundation hardware), compositing
 Utility process "accurate" (Parakeet TDT, native sherpa-onnx, 1 thread, BELOW_NORMAL; desktop/main.ts:620-636)
 Utility process "finaliser" (Mediabunny, normal priority, at part stop; main.ts:654-658)
 Overlay window renderer: state from the call page every 200 ms, levels every 250 ms (BroadcastChannel)
```

## B2. Questions answered

**Does recording re-acquire or replace the system-audio track?** No. PROVEN:
- The second request is video-only, and the shell grants it without loopback (`desktop/media.ts:100,177`).
- The recorder wraps the same track objects (`recorder.ts:259-267`).
- The only `ended` handlers detach a channel or stop the recording (`capture.ts:287-297`, `recorder.ts:328`).

**Does it change the sample rate?** No. The speech graph has its own 16 kHz context. The recorder has its own 48 kHz context.

**Does it starve the speech worker or the main thread?** Yes, through CPU, not through the audio graph. PROVEN:
- On battery the extra capture + mix + Opus + IPC tipped an already saturated worker over 3 s: 20 drops, only while recording (A1).
- Main-thread delay from recording was measured earlier as p95 2 ms (benchmark "Meeting recording").

**CPU per process with recording on vs off on this machine:**
- See the A1 table (capture + hardware encode, on AC).
- The local speech stack's own cost is in C6.
- The running laptop is shared with the Claude app, VS Code and so on. Background load before the tests was 30–40% of all 8 threads.

**Is hardware encoding really used?** Yes. PROVEN: WebCodecs `prefer-hardware` H.264 is supported, and encoding added no page-process CPU (0.10 core page vs 0.11 for capture alone). VP8 would cost +0.2 core in the page.

**The ~11 fps:** see A1 R4.

---

# C. Target architecture: Deepgram on both channels

## C1. Overview

```
 Mic ─► getUserMedia (EC/NS/AGC on) ─┐                                       ┌─► wss Deepgram  (You)  ──► Update/turn events ─┐
                                     ├► AudioWorklet 16 kHz Int16, 80 ms ─► "audio" Web Worker:                               │
 Loopback ─► getDisplayMedia ────────┘     (both channels, one clock)         AEC3 on You (Them as reference) → coupling gate │
                                                                             └─► wss Deepgram  (Them) ──► Update/turn events ─┤
                                                                               ring buffer 10 s per channel (fallback/replay) │
 Page main thread ◄── transcript events (both channels, capture-clock times) ◄──────────────────────────────────────────────┘
   question rules (E) · speculative answer at the pause · press = Finalize/processed-up-to ≤300 ms · /api/answer (stream)
 Server (Vercel iad1):  POST /api/stt/token  (signed-in user → Deepgram /v1/auth/grant, ttl 60 s; DEEPGRAM_API_KEY server-only)
 Fallback (per channel): Deepgram socket lost / no Updates for 3 s while speech is heard / offline → local sherpa-onnx worker
   (model already on disk; warmed at call start, idle) fed from the ring buffer; notice "Cloud transcription unavailable —
   using on-device"; back to Deepgram after 30 s of a healthy socket.
```

- **Audio goes from the device straight to Deepgram over WebSocket.** It never passes through Vercel. Only the token request goes to Kite's server.
- **Two streams, not one multichannel stream** (C4).
- **Models:** Flux (`flux-general-en`) on Them, Nova-3 on You (C3). Either can be switched per channel.

## C2. Auth: short-lived tokens. PROVEN working from this machine.

- `POST /api/stt/token`: Better Auth session required; the daily-limit table counts call starts, not tokens; rate-limited per user (e.g. 30/min).
- It calls `POST https://api.deepgram.com/v1/auth/grant` with `Authorization: Token $DEEPGRAM_API_KEY` and `{"ttl_seconds": 60}`, and returns `{token, expiresIn, host}`. The key is never returned or logged.
- The route lives in a new `apps/web/src/server/deepgram.ts` (`import 'server-only'`) plus a thin `app/api/stt/token/route.ts`.
- The browser connects with `new WebSocket(url, ['bearer', token])`.
  - Measured: that is accepted on `/v1/listen` and `/v2/listen`, for every one of the 16 test streams.
  - Measured: the token is needed only at the handshake; streams ran 8+ minutes past the 60 s TTL (as Deepgram documents).
- Measured from here: grant **0.86–2.4 s** (0.9 s typical) and connect 0.22–0.93 s.
  - So sockets are opened at **Connect**, before the call, never at a key press.
  - A reconnect fetches a fresh token (the 60 s TTL is enough for the handshake).
- Use a **dedicated Deepgram key** with the Member role (needed for grant), in its own project, with a usage alert in the Deepgram console.

## C3. Nova-3 vs Flux, measured on this machine

**Setup:**
- 16 kHz linear16 mono, 80 ms chunks, paced at real time, US endpoint unless noted, from Pakistan.
- Synthetic call: two Windows voices, 195 s (`apps/web/eval-results/calls`).
- Real call: the 11 Nov stereo file's Them channel (the Claude voice through loopback), 497 s, with its hand-marked question spans.
- Latencies are measured from the moment the audio was "spoken". "First word" = arrival of the first message with a word of the line, minus that word's end.

| Metric (p50 / p95) | Nova-3 (`endpointing=300`, `utterance_end_ms=1000`) | Flux (`eot 0.7`, `eager 0.5`) | Local engine today (00:49 call, rec off) |
|---|---|---|---|
| First word, synthetic Them | 677 / 1,039 ms | **454 / 932 ms** | 1,260 / 2,060 ms after speech start |
| First word, synthetic noisy Them | 690 / 1,038 | **315 / 937** | — |
| Last word of a line visible after it ends | 736 / 1,706 | **≈0 / 315** (Updates every ~240 ms) | final 2,050 / 2,680 |
| Final words after the line ends | 779 / 5,584 | 1,520 / 5,281 (at EndOfTurn) | 2,050 / 2,680 |
| End of turn after the question ends | speech_final 778 / 1,530, but **12–17 premature** end signals inside multi-sentence turns; UtteranceEnd 1,751 / 1,855 | EndOfTurn **1,575 / 2,325**; EagerEndOfTurn **1,252 / 1,924**; 7 premature EndOfTurn in 12 turns, 2 TurnResumed | auto-answer asks 740 / 2,330 |
| Flush on press | **Finalize** sent 100 ms after the line ended → final words at **418 / 1,079 ms**, last word included 19/20 | `ForceEndTurn` → EndOfTurn at 505 ms, but last word included only **6/20** (not a flush) | none |
| WER, synthetic Them (headphones / noisy) | 13.7% / 11.2% | **7.6% / 7.6%** | 5.1% as shown, 4.0% with Accurate (benchmark, same audio) |
| WER, synthetic You | 8.1% / 8.6% | 7.6% / 8.1% | 7.3%, 0.6% with Accurate |
| Punctuation | yes (smart_format) | yes: 8 of 9 "?" present | needs the punctuation worker |
| **Real call Them (Claude voice via loopback): first word** | 719 / 1,121 ms | **297 / 612 ms** | 0.6 / 0.8 s replay on AC, free CPU; 1.26 / 2.06 s in the 00:49 call |
| Real call Them: last word visible | 764 / 937 | **13 / 292** | final line 1.6 / 2.0 s (replay) |
| **Real call Them: end of turn** after the question ends | speech_final 827 / 1,672 (1 premature); UtteranceEnd 1,812 / 2,009 | **EndOfTurn 525 / 774**; **Eager 460 / 647**; 14 early EndOfTurn + 16 TurnResumed in 26 questions (the Claude voice pauses inside questions) | auto-answer sent 0.6 / 1.4 s (replay) |
| EU endpoint (`api.eu.deepgram.com`), real call Them first word / end of turn | 638 / 933 · 762 / 1,575 | **233 / 531 · 443 / 700** | — |
| **Real call "You" WER** (the user reading answer cards aloud; the replay's own scorer, 18–19 lines, ~264 reference words) | **32.2%** | 53.9% (16 lines; Flux cut the reading into short turns: 27 TurnResumed) | **57.9%** (live engine, same scorer, today's replay) |
| Real call "You": first word / end of turn | 541 / 1,014 · 815 / 1,811 ms | 408 / 964 · 646 / 1,306 ms | — |
| Token grant + WebSocket open, from Pakistan | 0.87–1.13 s + 0.22–0.80 s | same | — |
| Cost per channel-hour (list, pay-as-you-go) | $0.462 (+$0.078 keyterms) | $0.462 (+$0.078 keyterms) | $0 (CPU) |

**Reading the numbers honestly:**

- **Accuracy on synthetic voices does not separate the engines.** The clear Windows TTS voices are already easy for the local engine (benchmark: "much easier to recognise than real speech").
- **On a real voice it does.** For the user's own speech on the 11 Nov call (scored the same way, against the answer cards they read aloud):
  - Nova-3 makes **about half the errors** of the live engine: 32.2% vs 57.9%;
  - Flux is close to the live engine at 53.9%. It splits read-aloud speech at every hesitation; merging its turns does not rescue it with this scorer.
  - The absolute numbers are high because the person paraphrases while reading; only the comparison counts.
  - The samples are small (16–19 lines).
  - The Them channel (Claude's TTS voice) has no reference text. Confirm both channels with T1.3 on real voices.
- **End of turn on the real Claude voice is fast.** Flux EndOfTurn is 0.53 s p50 and Eager 0.46 s p50; the synthetic calls' 1.3–1.6 s came from the TTS files' long trailing silence and line gaps.
  - The cost: 14 of 26 questions got an early EndOfTurn that a TurnResumed then took back. The Claude voice pauses between the sentences of one question.
  - Answering on Eager/EndOfTurn therefore needs the cancel/re-ask rule (D1, E rule 6).
  - Tuning to test in T2.3: `eot_threshold` 0.8, `eager_eot_threshold` 0.6.
- **EU is faster than US from Pakistan:** first word −64 ms, end of turn −82 ms. It also keeps processing in the EU.
- **Multichannel has the same latency** as a single stream (Nova-3: 707 vs 719 ms first word) but only exists for Nova-3.

**Recommendation: Flux for Them, Nova-3 for You, both on the EU endpoint.**

- **Them** needs speed and turn events: question end, early answers, cancellation. Flux gives first words in 0.3 s and end of turn in 0.5 s on the real voice.
- **You** needs accuracy (your lines feed the notes, the transcript and reply detection). Nova-3 halved the live engine's errors; Flux did not.
  - Reply detection needs only "the user started speaking", which Nova-3 gives with `vad_events` (`SpeechStarted`) and interim words in ~0.5 s.
- Same price per minute. Two separate streams make the mix possible.
- If T1.3 on real voices shows Flux as accurate on Them as Nova-3, keep this split. If not, Nova-3 on Them with its own end-of-turn rule (UtteranceEnd 1.8 s is too slow, so our pause rule on interim words plus Finalize) is the alternative.

Parameters:
```
wss://api.eu.deepgram.com/v2/listen
  ?model=flux-general-en
  &encoding=linear16&sample_rate=16000          (mono, 80 ms = 2,560-byte chunks)
  &eot_threshold=0.7&eager_eot_threshold=0.5&eot_timeout_ms=5000
  &keyterm=<term>&keyterm=<term>…               (≤ 50 terms, C7)
  &mip_opt_out=true                             (C10)
```
- The token is minted on the same host (`https://api.eu.deepgram.com/v1/auth/grant`); measured working.
- The host is a server setting (`DEEPGRAM_HOST`), so the US endpoint is one change away.
You channel (Nova-3):
```
wss://api.eu.deepgram.com/v1/listen
  ?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1
  &interim_results=true&smart_format=true&punctuate=true
  &endpointing=300&utterance_end_ms=1000&vad_events=true
  &keyterm=<term>…&mip_opt_out=true
```
- Both channels sit behind one adapter, and the model is chosen per channel by a server setting.
- The language follows the session's language: English → the above; any other → Nova-3 `language=multi` on both channels (Flux multilingual covers only 10 languages).

## C4. Two streams vs one multichannel stream

| | Two streams (recommended) | One stream, `channels=2&multichannel=true` |
|---|---|---|
| Latency (Nova-3, real call Them) | 719 / 1,121 ms first word | 707 / 1,097 ms: the same |
| "You" WER (real call) | 32.2% | 33.1%: the same |
| Model | a different model per channel (Flux Them, Nova-3 You) | **Nova-3 only**, the same for both: Flux documents no multichannel, so there are no turn events |
| Parameters | per channel (keyterms, thresholds, AEC'd You only) | the same for both |
| Failure | one channel can fail over alone | both channels fail together |
| Billing | per channel | per channel (same) |
| Complexity | 2 sockets, 2 tokens | 1 socket, interleaving |

## C5. Echo and You/Them separation

**Headphones.** The mic never hears Them. Separation is exact by construction (two devices, two sockets).

**Speakers.** The mic hears Them about as loud as the user (−1.4 dB, 10 ms late, ADR-0070).

| Step | Kept where | Why |
|---|---|---|
| 1. Browser EC/NS/AGC on the mic | as today | cannot cancel another app's sound |
| 2. **AEC3** (WASM, Them as reference) on You **before** it is sent | a small "audio" worker (AEC3 + coupling gate, no decoding; ~3% of a core) | the only step that removes Them's voice from the audio itself |
| 3. Coupling gate (chunk silenced when it is mostly Them) | same worker | catches what AEC3 leaves at the start of a reply |
| 4. Text echo rules (You words that repeat recent Them words) | `core/transcript/echo.ts`, as today | last line of defence |

**Measured leakage without steps 2–3:**
- The 11 Nov call was on laptop speakers.
- Its stereo file's "You" channel is the mic before AEC3 (only the browser's echo cancellation, which cannot cancel another app).
- Sent raw to Nova-3, **396 of 804 "You" words (49%)** fell inside Them's question spans, while the user was silent. That is the interviewer's voice, and it would be shown under "You".
- So AEC3 **before** Deepgram is required on speakers. T1.4 checks the result.

## C6. What is switched off while Deepgram is active, and the CPU drop

| Component | With Deepgram | Note |
|---|---|---|
| sherpa-onnx live decode (both channels) | **off** (warmed, idle, as the fallback) | memory only |
| Accurate (Parakeet) during the call and the "You" rewrite after it | **off** | it is also what kept the call window busy after End (A6) |
| Backlog controller (set aside You, drop Them) | **off** | replaced by a socket send queue that never drops; failover if `bufferedAmount` exceeds 5 s |
| Smart Turn worker | **off** | Flux turn events plus the pause rule |
| Punctuation worker | **off** | Flux punctuates |
| Stuck-engine watchdog | replaced | "no Update for 3 s while speech is heard on that channel" → failover |
| AEC3 + coupling gate | **on** (You only) | ~3% of a core |

**Measured on this machine, on AC, CPU-seconds per process over 500 s:**
- **Local stack:** live worker + Smart Turn + punctuation + AEC3, no Accurate, on the real-call replay: **0.33 core** in its Chromium process.
  - The same replay kept up there: first words 0.6/0.8 s, finals 1.6/2.0 s, 12/12 presses right.
  - So the local engine is fine on a cool, plugged-in laptop and collapses on battery under extra load (A1).
- **Accurate:** 0.40 core at 2 threads (ADR-0066 benchmark). Now 1 thread at below-normal priority, so less, but it runs longer.
- **Deepgram path:** 17 concurrent real-time streams cost the Node test client **0.03 core** in total. Two browser sockets sending 32 KB/s each are negligible; AEC3 is ~0.03 core (ADR-0070).
- **Recording** (capture + hardware H.264): +0.05–0.13 core (A1).

**Expected with recording on:**
- On AC: about **0.6–0.7 core less** (0.33 local stack + ~0.3 Accurate, minus ~0.03 AEC3).
- On battery: the same work takes roughly twice the core-time at the lower clocks, so the saving is larger. T3.1 measures it on battery.
- That is enough room for the capture to hold 15 fps: on AC it already does with the local stack running.

**Why recording can no longer starve speech:**
- Nothing on the device decodes speech, so there is no queue that can fall behind or drop.
- A busy CPU now only delays sending 80 ms chunks by milliseconds.
- Deepgram's servers do the decoding.

## C7. Keyterms

- **Built from the session:**
  - the company name and domain stem;
  - the role title;
  - the session's Key terms field;
  - proper nouns and product/tech terms from the CV and the job description.
  - `core/stt/sessionHotwords.ts` already extracts these for sherpa. Reuse it, capped at **50 terms**, plain terms only (Flux takes no weights).
- **Same list on both channels.** You says the CV's terms; Them says the company's and the job's.
- **Updated mid-call** with Flux's `Configure` message (no reconnect). For example, when a document is added.
- Cost: +$0.0013 per channel-minute (Deepgram's keyterm add-on).

## C8. Ctrl+Enter with Deepgram

1. Note the press time on the capture clock: `T = audio clock now`.
2. Flux: wait until an Update with `audio_window_end ≥ T − 0.1 s` has arrived ("processed up to the press").
   Nova-3: send `{"type":"Finalize"}` and wait for the `from_finalize` result.
3. **Cap the wait at 300 ms**; measured Nova-3 Finalize 418 ms p50 from the end of speech when sent 100 ms after it.
4. Build the question from the newest unanswered Them speech (E) and send.
5. If more Them words arrive for the same speech within 2 s, re-ask on the same card (E rule 6).

## C9. Fallback

- **Per channel:** Deepgram error or close; no Update for 3 s while that channel's level shows speech; `navigator.onLine === false`; or a token failure.
  → Switch that channel to the local engine.
  - The local worker is loaded at Connect and kept idle, so it is ready.
  - Feed it the channel's last 10 s ring buffer first, so the gap's words are not lost.
  - Show: "Cloud transcription is unavailable — using on-device transcription (less accurate)."
- **Retry Deepgram** in the background (1, 2, 5, 10, 30 s). Switch back after 30 s of a healthy socket, at a pause (never mid-line).
- The call timing log records each switch.
- The browser (no Accurate) gets the same fallback with the WASM worker.

## C10. Privacy

Call audio now leaves the device: both voices go to Deepgram while transcription is on. This needs a new ADR, since it reverses "Audio never leaves the device".

Text to change:
- `apps/web/src/features/legal/PrivacyPolicy.tsx:49`. "Call audio is never sent." becomes:
  > "During a call, both your microphone and the other side's audio are streamed to Deepgram, Inc. to turn speech into text. Deepgram returns the text and does not keep the audio (we opt out of Deepgram's model improvement program). Audio is never stored by Paramount AI. If Deepgram cannot be reached, speech is turned into text on your computer."
- The same file's list of who handles data (`:81`): add Deepgram.
- `apps/web/src/ui/AuthCard.tsx:16`: "Audio never leaves your computer" becomes "Audio is transcribed by Deepgram and never stored".
- `apps/web/src/features/help/SyncHelp.tsx:20`, `features/help/guideText.ts`.
- Comments in `core/audio/capture.ts:16`, `micPreview.ts:13`, `TabPreview.tsx:14`.
- `docs/architecture/kite-architecture-v3.1.md` §1 (table row "Speech-to-text"), §8.1 (where data lives).
- `CLAUDE.md` ("Audio never leaves the device").

Decide also:
- `mip_opt_out=true`. The documentation does not say whether opting out changes the price; confirm with Deepgram.
- `redact_usage=true` (keyterms not kept in Deepgram's usage records).

## C11. Cost: 4 users at ~2 h/day

| Per month | Them only | **Both channels (decided)** |
|---|---|---|
| 30 days (240 call-hours) | $110.88 + $18.72 keyterms = **$129.60** | $221.76 + $37.44 = **$259.20** |
| 22 working days (176 call-hours) | $81.31 + $13.73 = $95.04 | $162.62 + $27.46 = **$190.08** |

- Deepgram list prices: Flux $0.0077/min, Nova-3 $0.0077/min (monolingual), keyterms $0.0013/min.
- The $200 free credit covers about the first month.
- **Cheaper option (P3):**
  - send only voiced audio plus a 2 s tail, with `KeepAlive` in silence;
  - in the 00:50 recording, Them was voiced ~19% of the time and You ~48%;
  - that could cut the bill by about half, but it must be measured, because Flux's turn timing depends on hearing the silence.
- **Not Deepgram, but related:** speculative answers raise Claude requests (Deepgram says +50–70% with eager end-of-turn). That matters for the ~$20/month Claude limit in CLAUDE.md, which is already tight for 240 call-hours.

---

# D. Answer latency budget

**Sources:**
- "Now" is the 00:49 call's timing log (recording off; recording on in brackets).
- Deepgram rows are from C3.
- The server split comes from earlier benchmarks; this call's server logs had expired.

| Stage | Now p50 / p95 | Target design | Expected p50 |
|---|---|---|---|
| Them speech → first words on screen | 1.26 / 2.06 s (1.62 / 2.87) | Flux Updates (real call: 0.30 / 0.61 s US, 0.23 / 0.53 s EU) | 0.25–0.35 s |
| Question's last word → visible | final line 2.05 / 2.68 s (3.03 / 3.97) | Flux Updates every ~240 ms | ≈0.1–0.3 s |
| Last word → "question over" signal | auto 0.74 / 2.33 s (3.66 / 3.97) | Flux **Eager 0.46 / 0.65 s** (US; 0.38 / 0.51 EU) → speculative send; EndOfTurn 0.53 / 0.77 s confirms; TurnResumed cancels | 0.4–0.5 s |
| Press → question complete | not waited (15/29 presses used grey words) | processed-up-to / Finalize, cap 300 ms | 0.1–0.3 s |
| Decision → request sent | 3 ms / 0.9 s (3.3 s) | no waits; body ready (C8) | <20 ms |
| Network to server (PK → bom1 edge → iad1) | ~0.25–0.3 s of the 1.34 s below | warm HTTP/2 connection (`preconnect`, one request kept open by the warm-up) | 0.2–0.25 s |
| Server before Claude (auth + `countRequest` DB, serial) | 30–100 ms | `countRequest` in parallel with the Claude call | 10–30 ms |
| Claude first token (Haiku, cached prefix) | ~0.45–0.6 s (benchmark) | relevant document chunks only (≤ 8k tokens, D3); cache hit on the session prefix | 0.35–0.5 s |
| Meta line + overlay | ≤200 ms throttle | first delta to the overlay at once | ≤50 ms |
| Sent → first word on screen | **1.34 / 1.92 s** (1.27 / 1.69) | sum of the 4 rows above | 0.65–0.85 s |
| **Question end → first answer words** | **2.0 s** (rec on 4.6 s); p95 42 s | send at Flux EndOfTurn (or Eager) | **≈1.2–1.4 s** at EndOfTurn; ≈1.1–1.3 s at Eager; p95 < 2 s |

## D1. Speculative answering, re-evaluated with the real numbers
- On the real Claude voice, Flux **EndOfTurn** comes 0.53 s p50 after the question ends and **Eager** 0.46 s. Speculating on Eager saves only ~70 ms.
- The question is really what to do with the **early** end-of-turns: 14 of 26 questions, where the voice paused between sentences.
- Rule:
  1. Send at EndOfTurn (or Eager, if you choose speed over cost).
  2. Stream into the card, **held hidden for up to 400 ms**.
  3. On `TurnResumed` or new words within the hold: cancel silently.
  4. After the answer is shown: keep it, and re-ask on the same card when the turn really ends (as the rerun rule does today).
- **Claude cost:** about +30–50% requests from early ends (measure in T2.3). Cancelled requests are billed for their input, ~10% of the normal price with the cached prefix.
- Lever: `eot_threshold` 0.8 cuts early ends at the price of a later EndOfTurn; T2.3 compares 0.7 and 0.8.

## D2. Warm connection and cache
- Today one warm-up per open, reused for 60 s, plus an idle re-warm every 270 s (`core/answer/warm.ts`, `keepWarm.ts`). Keep that.
- Add a tiny authenticated `HEAD /api/answer/ping` every 25 s during a call, so the browser keeps the HTTP/2 connection to the edge open. That saves a TLS handshake (≈180 ms measured).
- **Cache hit rate is unknown for these calls:** `cache_read_input_tokens` reaches only the console (`useLiveAnswers.ts onDone`). Add it to the trace (I).

## D3. Relevant chunks instead of whole documents
- Today every request carries all documents (`toSessionContext`, `core/answer/warm.ts`). Measured earlier: 2.1 s p50 request time at ~456k characters vs 1.1 s with the CV only (benchmark 1.5.1/1.5.2).
- Proposal:
  - keep in the cached prefix the CV and the documents summary that already exists (ADR-0067);
  - put in the uncached tail the top 3–5 document chunks for this question;
  - rank chunks with BM25 over chunks made when the document is saved; no new service.
- Expected: request time stays at the CV-only level whatever the document size.

## D4. Haiku settings
- Thinking is already off (`server/claude.ts:70-72`).
- `ANSWER_MAX_TOKENS` 1,500 does not affect the first token.
- The model id comes from env (`KITE_MODEL_FAST`). Keep it.

## D5. Region
- The function stays in `iad1`, next to Anthropic's API (the US).
- From Pakistan the edge is Mumbai (bom1). The edge → iad1 leg is part of the 0.25–0.3 s and cannot be removed without moving Claude.
- Deepgram US is ~310 ms TCP connect from here; EU is ~175 ms. Streaming results arrive 64–82 ms sooner from EU (C3), so EU is recommended.

## D6. The auto-answer wait for Accurate
- Today it waits up to 0.5 s (`autoAnswer.ts:57`). It disappears with Deepgram.

## D7. Expected end-to-end result
- **About 1.2–1.4 s p50** from the end of a question to the first answer words, sending at Flux EndOfTurn on the EU endpoint.
- **About 1.1–1.3 s** sending at Eager.
- **p95 below 2 s**, because nothing on the laptop can fall behind.
- Reaching ≤1 s p50 also needs the request leg at ≤0.6 s: the warm connection (D2), `countRequest` in parallel, and the chunked documents (D3).
- A **press** is ≤0.3 s (processed-up-to) + ≈0.7–0.85 s, so about 1.0–1.15 s after the key.

---

# E. Question selection: why an old question is answered, and the rules

## E1. How a press chooses today

1. A continuation on the last card.
2. Wait while the newest grey Them line is not yet a question, up to 8 s.
3. The unanswered Them lines since the user's last reply.
4. Otherwise the newest real question of the whole call, which looks back over statements and greetings.

References: `pressQuestion.ts:116-176`; `useLiveAnswers.ts:555-693`.

- Unless the pick "looked back", the text sent is rebuilt by `selectQuestion` (`question.ts:214-239`), which **joins answered question lines** before the new one.
- The repeat guard then:
  - shows an existing card for already-answered speech (`SHOW_EXISTING_MS = ∞`);
  - ignores a same-speech press while that answer streams (`repeatGuard.ts:188-219`).
- Lines get ids at their first grey words (`u<n>`), and a merged grey line aliases to the line before it (`transcript.ts:578, 677, 782-791`).

## E2. Paths to an old question

| # | Path | Status |
|---|---|---|
| 1 | The newest question is not in the transcript yet: late, dropped by the backlog, or lost in an engine restart (A1). Step 3 is empty, step 4 returns the old question, and the guard shows its old card. | PROVEN in code; seen in this call (two presses answered speech 17 s and 37 s older than the newest Them line) |
| 2 | The new question has no "?" in live words, so it reads as a statement and step 4 looks back to the previous question | PROVEN in code (throwaway script) |
| 3 | The new question starts within 1.5 s (4 s if cut off) of an answered line and merges into it (`core/transcript/merge.ts:21-25`), so "old + new" is sent as one | PROVEN in code |
| 4 | The user's reply is missing (set aside by the backlog, ≤2 words, or started over Them), so `selectQuestion` prepends answered lines | PROVEN in code |
| 5 | Auto-answer joins two questions while the reply is set aside | documented, benchmark 1.5.1 |

## E3. Rules for the new design (press and auto)

1. **One clock.** Every line, grey or final, carries capture-clock times: Deepgram word times plus the stream's start offset on the audio clock. Never page arrival time.
2. **Caught up before choosing.** A press waits until Them is processed up to the press, or Finalize returns, **at most 300 ms**. While catching up it never falls back to an older question; on a timeout it uses what is there and marks the card "may be incomplete".
3. **Newest by time.** The question is all Them speech that **starts after the end of the newest answered span**, kept per segment even when lines merge. Exactly those words are sent as `question`; `selectQuestion` is not re-run on them.
4. **No look-back when newer speech exists.** If there is unanswered Them speech, send it even if it reads as a statement. Claude's `none` reply already handles non-questions. An old card is shown only when no new Them speech exists since it, labelled "Already answered — no new question".
5. **A reply** is a You line of more than 2 words that **starts** at least 0.5 s after Them stopped (unchanged). With Deepgram, You is never set aside, so replies are always seen.
6. **Completeness.** If the asked lines gain **any** word within 2 s, re-ask on the same card (`GROWN_WORDS` 2 → 1, one clock). This applies to presses, early autos and finals.
7. **Feedback, never silent.** Same speech while streaming: "Already answering". A second press while waiting answers at once. Every press decision (sent / shown-existing / ignored / waited) goes to the timing log.
8. **Gaps.** If Them audio was lost (fallback switch, socket gap), the transcript shows "[audio gap]", and a press across the gap says so rather than answering the question before it.
9. **Auto-answer** uses rules 1–6 with the speculative trigger (D1). It answers a question at most once, except for a rule-6 re-ask.

---

# F. Session and call data model

## F1. Today

| Data | Keyed by | Store | Calls separated? |
|---|---|---|---|
| Transcript lines | `<session>:<random per saver>:<line>`; records hold only `sessionId`, `tStart` (`core/storage/types.ts:230-243`) | `utterances` (synced, kind `utterance`) | only by guessing: a 30 min gap or an answer's `callStartedAt` (`core/review/conversation.ts:78-98`) |
| Answers | id + `callStartedAt` | `answers` (synced) | yes |
| **AI notes** | **session id** | `notes` (synced) | **no: one per session** |
| Recordings | id + `meetingId` (real per-call UUID) | `recordings` (synced) + shell index | Drive matches them by **time window** (`uploader.ts:237-246`) |
| **Drive job** | **session id** | `driveUploads` (device only) | `calls[]` inside one job, files in one ordered list |
| Drive file keys | `call:<start ms>:transcript-txt/-pdf/notes-pdf`, `rec:<recId>:main/stereo` | Drive tags | yes |
| Email record | session id for the first call, `<session>~<start>` for later ones (`server/google/report.ts:34-70`) | `drive_notification` | yes, but `manualEmail` is per job (A9) |
| Session page | reads this browser's IndexedDB **once** (`SessionReview.tsx:114-124`) | — | one list, oldest first |

## F2. Why each symptom happened

- Old notes: A6, causes 1–2.
- Old transcript on top: A6, causes 3–4.
- Older call's transcript on Drive and two transcripts: A7 (a separate 23:19 start; TXT + PDF).
- No video: A7 cause 1, A8.
- No email: A9.

## F3. The correct model: every start is a call

**`StoredCall`** (new Dexie store `calls: 'id, sessionId, startedAt'`, new sync kind `call`):
```
{ id (uuid, made at Connect), sessionId, startedAt, endedAt, durationMs, deviceId,
  saveTranscript, recording: 'off'|'audio'|'screen',
  notesState: 'writing'|'saved'|'skipped'|'failed',
  drive: { deviceId, state: 'waiting'|'queued'|'uploading'|'done'|'error', reason? },
  sttEngine: 'deepgram'|'local'|'mixed' }
```

- **Lines, answers and recordings get `callId`.**
  - `startTranscriptSaver({ callId })` already accepts it (`core/transcript/saver.ts:77`).
  - The recording's `meetingId` = `callId`.
  - Answers get `callId`, and `callStartedAt` is kept.
- **Notes per call:** new store `callNotes: 'callId, sessionId'`, sync kind `callNotes`. The old `notes` store becomes read-only legacy.
- **Drive per call:** new store `driveCallJobs: 'callId, sessionId, state, updatedAt'`.
  - Order: transcript TXT, transcript PDF, notes PDF, then recordings.
  - Each file independent: one file failing never stops another file or another call.
  - File keys stay `call:<startedAt>` and `rec:<recId>`, so existing Drive tags still match and nothing is duplicated.
- **Email per call:** each new call's record is `<session>~<startedAt>`; the plain session key stays for legacy only. Two emails per call per A9.
- **After-call work leaves the page's lifetime:**
  - At End the page writes the call record (`endedAt`, `notesState: 'writing'`, `drive.state: 'waiting'`) **at once**, before anything else.
  - A small "after-call" runner (`core/live/afterCall.ts`, mounted in the app layout like `DriveUploader`, so in the panel too) picks up calls whose notes or Drive work is unfinished: it generates notes, queues Drive and retries.
  - Closing the call window no longer loses anything. The "You" rewrite is gone with Deepgram.
- **Session page:**
  - lists calls **newest first**, each with date, length, transcript, notes ("No notes — nothing was heard" when skipped), answers, recordings and Drive status;
  - waits for the first sync pull ("Syncing…") and reloads on `onSyncApplied`.
- **Calls made before Drive was set up:** Settings → Google Drive offers "Upload N earlier calls", built from call records, not guesses.

## F4. Migration

- **Dexie version 12:** new stores only.
- **No SQL migration:** `call_record.kind` and `id` are text. Add `call` and `callNotes` to `SYNC_KINDS` and the zod enum (`server/calldata/validate.ts:25`) in the same deploy. Older open pages ignore unknown kinds on pull (`core/sync/engine.ts:349-350`).
- **Legacy calls are derived on read, never written:**
  - group old lines by the random id inside their ids (`session:callId:line`), falling back to answers' `callStartedAt`;
  - attach the old `notes` row to the call whose start matches `notes.callStartedAt`.
  - Writing derived records would make each device invent different ids.
- **Existing `driveUploads` jobs:** finish only their unfinished files, then freeze. `manualEmail` is ignored for calls queued after the deploy.
- **Desktop:** the `closed` handler must call `drive.setCallActive(false)`. That needs desktop **1.6.3**. Everything else is web-only.

---

# G. Hotkeys and focus

- **Cause:** A4. The wait notice that reads as "listening", a second press restarting the wait, silent no-ops, and possibly a shortcut taken by another app.
- **Fix (web only):**
  1. A second press while waiting answers at once.
  2. The wait is capped at 300 ms (E rule 2) instead of 8 s. The notice becomes "Finishing the question…" and is shown only after 150 ms.
  3. Every press shows a result: a new card, "Showing the earlier answer", "Already answering", or "Nothing new to answer".
  4. At call start, if Answer (Ctrl+Enter) could not be registered, the overlay shows a persistent "Ctrl+Enter is used by another app: press Answer or pick another key", with a link to Settings → Hotkeys. Today it is only a short "taken" notice.
  5. The press time is stamped in the shell's `globalShortcut` callback and passed in the IPC message (for the trace).

---

# H. Recording: light and never at the expense of speech

1. **Standard becomes 960×540, max 10 fps, 0.8 Mbps, hardware H.264.**
   - Measured 9.9 fps, −0.04 core vs 720p15; about half the file size.
   - Screen text stays readable at 540p for meeting replays. Keep "High" (1080p30) as an option.
2. **No software video during a call.** Without hardware H.264, offer Audio only, never VP8 in the call's renderer (+0.2 core measured).
3. **Video yields under load.**
   - When the page sees CPU pressure (the Compute Pressure API `serious`/`critical` in Chromium, or with the local fallback active, backlog ≠ ok), call `screenTrack.applyConstraints({frameRate:{max:5}})`. Restore after 30 s of `nominal`.
   - Audio recording is never touched.
4. **Move the recording mix and encoders out of the call renderer.**
   - Put them in a hidden recorder window: its own renderer process, `os.setPriority` below normal, `backgroundThrottling:false`.
   - It receives the two audio tracks by re-requesting them (mic: `getUserMedia`; Them: a second loopback). **A second loopback request must first be tested on Windows** (unknown behaviour; measure before relying on it).
   - Until then, keep the mix in the page; with Deepgram the page has room.
5. **Finaliser** (Mediabunny) runs at below-normal priority (`main.ts:654-658` today is normal).
6. **Target:** a steady 15 fps at 720p (or 10 fps at 540p) on this laptop, **on battery**, during a Deepgram call.
   - Measured on AC: 14.6 fps with capture + encode.
   - On battery it must be re-measured (T0.2), because the 11 fps came from the speech stack's load, which Deepgram removes.

---

# I. Implementation plan

**Effort:** S ≤ ½ day, M 1–2 days, L 3–5 days.
**Release:** "web" ships with a Vercel deploy; "desktop" needs a new shell release.

## Phase 0: before building (½ day)

| # | Item | Notes |
|---|---|---|
| T0.1 | Turn on the **timing trace** (below) in production behind a setting | so every test produces numbers |
| T0.2 | You, once: a 10-minute call **on battery**, recording on, current build, trace on; send the downloaded log | it proves R1/R4 per process with the trace's CPU samples |
| D0.1 | Deepgram: a dedicated key (Member role), usage alert, `mip_opt_out` price confirmed | your action |

## Phase P0: production blockers

| # | Change | Files | Risk | Effort | Release | Migration |
|---|---|---|---|---|---|---|
| P0-1 | Deepgram token route | `src/server/deepgram.ts` (new), `app/api/stt/token/route.ts` (new), `.env.example` (name only) | low | S | web | — |
| P0-2 | Deepgram engine adapter (Flux, both channels), audio worker (AEC3 + coupling gate, no decode), one clock, ring buffers | `src/core/stt/deepgram.ts` (new), `src/core/stt/audio.worker.ts` (new, from `stt.worker.ts`'s AEC3/coupling parts), `src/core/stt/sttEngine.ts` (engine choice), `src/core/audio/capture.ts` (attach), `src/platform/*` (none) | medium | L | web | — |
| P0-3 | Fallback to local per channel; notices; failover trace | `src/core/stt/failover.ts` (new), `features/live/LivePage.tsx` (engine wiring, watchdog replaced) | medium | M | web | — |
| P0-4 | Watchdog fix (local fallback): count only the decoded channel; no restart while backlog ≠ ok | `src/core/stt/watchdog.ts`, `LivePage.tsx:733, 801-802` | low | S | web | — |
| P0-5 | Question rules E3 (one clock, caught-up, newest-by-time, no look-back, completeness, feedback); press = processed-up-to/Finalize ≤300 ms | `src/core/answer/pressQuestion.ts`, `autoAnswer.ts`, `repeatGuard.ts`, `src/core/transcript/{transcript,merge,question}.ts`, `features/live/useLiveAnswers.ts` | medium | L | web | — |
| P0-6 | Call record + notes per call + after-call runner + session page newest-first with sync reload | `src/core/storage/{db,types,calls,callNotes}.ts`, `src/core/sync/{mapping,capture}.ts`, `src/server/calldata/validate.ts`, `src/core/live/afterCall.ts` (new), `features/review/*`, `LivePage.tsx:890-1040` | medium | L | web | Dexie v12, new sync kinds, no SQL |
| P0-7 | Drive per call, transcripts first, independent files, "upload earlier calls" | `src/core/drive/{uploader,queue,callFiles}.ts`, `src/core/storage/driveUploads.ts` | medium | M | web | Dexie v12 (same bump) |
| P0-8 | Email rule (A9): email 1 at transcript + notes, email 2 for the recording, hourly cron, `manualEmail` ignored for new calls | `src/server/google/{api,report,email}.ts`, `src/core/drive/uploader.ts:626, 815-818`, `vercel.json` (cron) | low | M | web | none (text keys) |
| P0-9 | Privacy texts (C10) and the ADR (audio to Deepgram) | `features/legal/PrivacyPolicy.tsx`, `ui/AuthCard.tsx`, `features/help/*`, architecture doc, `CLAUDE.md` | low | S | web | — |
| P0-10 | Shell: `drive.setCallActive(false)` on window close; finaliser below normal | `apps/desktop/src/main.ts:303-312, 654-658` | low | S | **desktop 1.6.3** | — |

## Phase P1: latency and robustness

| # | Change | Files | Effort | Release |
|---|---|---|---|---|
| P1-1 | Speculative answer at the pause, hold 400 ms, cancel on resume | `autoAnswer.ts`, `useLiveAnswers.ts`, `answerClient.ts` | M | web |
| P1-2 | `countRequest` in parallel with Claude; first delta to the overlay at once; HTTP/2 keep-alive ping | `app/api/answer/route.ts:222-233`, `core/live/liveChannel.ts`, `core/answer/keepWarm.ts` | S | web |
| P1-3 | Keyterms from the session to Deepgram (`sessionHotwords.ts`), `Configure` on change | `core/stt/deepgram.ts`, `core/stt/sessionHotwords.ts` | S | web |
| P1-4 | Hotkey feedback and the "taken" warning (G) | `useLiveAnswers.ts`, `LiveStrip.tsx`, `CompactLive.tsx` | S | web |
| P1-5 | Silence notice fixed (A5); loopback re-opened on output-device change | `core/audio/channelSilence.ts`, `core/audio/deviceWatch.ts`, `LivePage.tsx:1095-1098` | S | web |
| P1-6 | Recording: 540p10 Standard, no VP8 in calls, frame-rate yield under pressure (H1–H3) | `packages/shared/src/recording.ts:46`, `core/recording/{format,recorder}.ts`, `features/live/useCallRecording.ts` | S | web |

## Phase P2: cost and size

| # | Change | Effort | Release |
|---|---|---|---|
| P2-1 | Relevant document chunks instead of whole documents (D3) | M | web |
| P2-2 | Voiced-audio-only sending with KeepAlive (C11), only if the measured turn latency is unchanged | M | web |
| P2-3 | Recorder in its own process (H4), after the second-loopback test | L | desktop |

## The timing trace (timestamps only)

- **Turn on:** Settings → Transcription → **"Timing trace"** (device-only, off by default), or `localStorage['kite.trace']='1'`.
- **Storage:** extends `core/live/callTimings.ts`. Same storage, same download, and the same privacy rule: ids and Unix ms only, never words.

Events recorded:
- **Audio:** per channel, the first chunk's audio-clock ↔ `performance.now()` offset every 10 s (clock drift).
- **STT:**
  - per Them/You line: speech onset (first voiced chunk), first Update/partial, last word change, Flux `EagerEndOfTurn`, `EndOfTurn` or `TurnResumed` with confidence, final;
  - engine (`deepgram`/`local`) per line;
  - socket open/close/error times and codes;
  - failover switches;
  - `bufferedAmount` max per second.
- **Press:**
  - the shell's `globalShortcut` callback time (passed through IPC) and the page receive time;
  - the processed-up-to wait (start, end, timed out?);
  - the decision (`sent`, `shown-existing`, `ignored-streaming`, `waited`);
  - whether newer unanswered Them speech existed;
  - asked word count vs final word count of the same lines.
- **Auto:** the time the rule became due vs acted; speculative sent, held, shown or cancelled.
- **Request:**
  - gzip done, fetch called, response headers, first meta, first visible delta;
  - the server's `ms` timings (auth, limit, stream open, first text);
  - `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens` (numbers).
- **Overlay:** the first state containing the answer's first words, and the next paint.
- **Recording:** chosen mime type, frames delivered/discarded per 10 s (`track.stats`), frame-rate yields.
- **Process load:** every 5 s, `performance.now()` event-loop lag; Compute Pressure state; on desktop, the shell's `app.getAppMetrics()` cumulative CPU per process type.
- **After-call:** notes request start/end/status, call queued for Drive, each Drive file's start/end/status, and the notify result (`collecting`/`sent`/…).

## Manual tests for you (after each phase is built)

| Test | Steps | What you should see |
|---|---|---|
| **T1.1 Deepgram live** (P0-1..3) | Trace on. Desktop, headphones. Start a session, Connect, play 6 interview questions from the Claude voice app, answer each aloud. End, download the timing log. | Them words appear while the voice speaks (first words <0.5 s in the log). Your lines appear within ~0.5 s of you stopping. No "set aside" or "catching up" notices. Log: engine `deepgram` on every line, 0 failovers. |
| **T1.2 Fallback** (P0-3) | During a call, turn Wi-Fi off for 20 s, keep talking, turn it on. | Within ~3 s: "using on-device transcription". Your words and Them's keep appearing (slower). After Wi-Fi returns, the notice goes away within ~30 s. The log shows two switches, no lost line around the gap. |
| **T1.3 Accuracy, real voices** (decides C3) | Read a 2-minute scripted interview (we provide the text) with a colleague on a real Meet call, speakers on. | WER is computed locally from the call's TXT export against the script (the text stays on your machine). Target: Them and You each clearly below the local engine's WER on the same script, with the same audio replayed through the local engine (`call:real` on the stereo file). |
| **T1.4 Speakers echo** (P0-2) | Same as T1.1 with laptop speakers instead of headphones. | Them's questions never appear under "You" (the log's echo counters ≈ 0). |
| **T2.1 Press complete** (P0-5) | Press Ctrl+Enter immediately as each question ends (6 times). | Every card shows the whole question; no card starts with a fragment. The log: wait ≤300 ms, asked words = final words. |
| **T2.2 Press newest** (P0-5) | Ask two questions back to back without replying; press after the second. Then press again 5 s later without new speech. | First press: the second question. Second press: "Showing the earlier answer", the same card. |
| **T2.3 Latency** (P1-1, P1-2) | Auto-answer on, 6 questions. | Log: question end → first answer word p50 ≈1.0–1.3 s, p95 <2.5 s. |
| **T3.1 Recording on** (P1-6, H) | On battery: T1.1 with Screen + audio recording on. | Same transcript timings as T1.1. The recording plays at 10 fps (540p) or 15 fps (720p) steady (the log's frames per 10 s). |
| **T4.1 Start again** (P0-6) | End a call; on the desktop card press Start again; talk for 2 minutes; End; immediately close the call window; open View transcript. | The session page shows **two calls, newest first**, each with its own date, length, transcript and notes. Within 30 s of closing, the new call's notes appear (the panel finished them). |
| **T4.2 Drive** (P0-7) | Recording on, company folder set. End the call and close the window. | Within ~1 minute: Transcripts gets this call's TXT, PDF and Notes PDF (named with its own start time); Recordings gets its MKV and stereo file within a few minutes. No older call's files are uploaded again. |
| **T4.3 Email** (P0-8) | The same call. | Email 1 "Call saved" within ~1 minute of the transcript upload, with the recording "uploading…". Email 2 "Recording saved" when the video is in Drive. Settings → Recent notifications: `sent` ×2 for this call. |
| **T4.4 Earlier calls** (P0-7) | Settings → Google Drive → "Upload earlier calls". | The 12 Nov 22:25 (2 parts) and 13 Nov 00:49 calls upload once, with no duplicate transcripts. |
| **T4.5 SMTP now** | Today, before any fix: Settings → Google Drive → **Send test email**. | The test email arrives. If not, the page shows the SMTP error reason. |
| **T5.1 Desktop 1.6.3** (P0-10) | Close the call window during a call (it minimises), then quit from the tray during a call; restart; end a normal call with recording. | The recording uploads after the call (not "paused"). |

---

# J. Follow-up answers

- **Is `docs/testing/calls/` tracked by git?** No. The whole folder is ignored (`.gitignore:54`, `docs/testing/calls/`), and `git ls-files docs/testing/calls` lists nothing. `real-call-2026-11-11.stereo.webm` was never committed. Nothing was changed.
- **Where the Deepgram key was read from:** the repo-root `.env.local` (ignored by `.env*`). The measurement scripts read it and never printed it. `DEEPGRAM_API_KEY` in Vercel is a Secret, which `vercel env pull` cannot read.
- **Deepgram spend for this investigation:** about 107 audio-minutes (17 streams, one of them 2-channel), ≈ $0.82 at list price, from the free credit.
- **Local leftovers (git-ignored):** today's replay wrote `docs/testing/calls/results/invest-1113-{run,score}.json`, and a code-reading agent wrote `agent-e-current-score.json` there. Scratch scripts and raw Deepgram messages are only in the session's temp folder.

---

# Summary

## Top 5 root causes
1. The on-device speech engine can't keep up on this laptop on battery. The worker was behind for most of the call, "You" was set aside, and with recording on Them audio was skipped 20 times. A third of Them speech never became a line.
2. The stuck-engine watchdog restarts the engine during normal talk (it counts the user's set-aside speech as "stuck"). That reloads a 200 MB model on a saturated CPU and throws away queued audio.
3. Presses read whatever is in the transcript: grey words with no flush (incomplete questions), or a fallback to "the newest question of the call" when the new one is late, merged or unpunctuated (old questions).
4. After-call work (notes, the Drive queue) runs inside the call page after End, and the page can close before it finishes. Notes and the Drive job are also one per session, so the session page shows another call's notes and the call never reaches Drive.
5. Emails: a per-job `manualEmail` flag set on pre-1.6 sessions makes every later call's record `not-set-up` (0 attempts). The email also waits for all recording files, or 24 h.

## Recommended architecture
- Both channels stream from the device straight to Deepgram's EU endpoint over two WebSockets: **Flux for Them** (turn events) and **Nova-3 for You** (accuracy). They use 60 s tokens minted by `/api/stt/token`; the key stays on the server.
- Before sending, the mic passes through **AEC3 + the coupling gate** (Them as reference). Text echo rules stay.
- Flux Updates (~240 ms) give the transcript.
- Flux **EndOfTurn** (0.53 s p50 on the real Claude voice) sends the answer, held for 400 ms. `TurnResumed` cancels it, or re-asks on the same card.
- **Ctrl+Enter** waits for Deepgram to have processed audio up to the press (≤300 ms), then sends the newest unanswered Them speech by time.
- **Local sherpa-onnx is only a per-channel fallback**, warmed and idle. Accurate, Smart Turn, punctuation and the backlog controller are off during Deepgram calls.
- **Every start is a call record.** Notes, Drive job and email are per call. After-call work runs in a layout-level runner that survives the call window.
- **Recording** at 540p10 hardware H.264, yielding frame rate under pressure; never software video in a call.

## Expected latency and monthly cost
- **Latency:** question end → first answer words ≈ **1.2–1.4 s p50** at Flux EndOfTurn (≈1.1–1.3 s at Eager), p95 < 2 s. A press gives first words ≈1.0–1.15 s after the key. Today: 2.0 s p50 with recording off, 4.6 s with it on.
- **≤1 s** needs the request leg cut to ≤0.6 s (D2, D3, P1-2).
- **Deepgram, 4 users × 2 h/day, both channels with keyterms:** **$259/month** at 30 days, **$190/month** at 22 working days. The $200 free credit covers the first month.

## Decisions needed from you
1. **Flux for Them + Nova-3 for You, on Deepgram's EU endpoint.** On the only real-voice "You" measurement Nova-3 had 32% WER vs Flux 54% and local 58%. To be confirmed by T1.3. Non-English sessions use Nova-3 multi on both.
2. **Answer on EndOfTurn with cancel/re-ask.** The Claude voice ended a turn early in 14 of 26 questions, so expect +30–50% Claude requests. That exceeds the ~$20/month Claude limit at 240 call-hours. Raise the limit, or use `eot_threshold` 0.8 (fewer early ends, slower)?
3. **The email rule:** two emails per call (A9) and an hourly cron. Plus a one-time "Send email" by hand for this session's four waiting calls.
4. **Privacy:** `mip_opt_out=true` (confirm any price change with Deepgram) and the new privacy text (C10). This needs a new ADR reversing "audio never leaves the device".
5. **Recording Standard → 960×540 at 10 fps.** Or keep 720p15 and rely on Deepgram freeing the CPU.
6. **The US vs EU Deepgram endpoint** (C3/D5 measurements).
7. **Desktop 1.6.3** for the Drive pause fix and the finaliser priority. Everything else is web-only.
