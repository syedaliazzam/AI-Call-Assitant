# ADR-0068: Meeting recording, kept on the computer that made it

- **Status:** Accepted (developer, 10 Nov 2026: investigation report approved with decisions) · Desktop 1.5.0 and web.
- **Date:** 2026-11-10
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §3.3, §5, §7.3, §7.4, §8.1
- **Supersedes / superseded by:** none. Extends ADR-0042 (Private), ADR-0049 (call data in the account), ADR-0052 (desktop links).

## Context

The team wants to record calls as a full-screen video with both sides' sound, like a Zoom or Meet recording, keep the files on the laptop, and see them in the browser's dashboard. Audio has never been stored (§8.1), and video of meetings is a new kind of data. The investigation and the Phase 0 spike (benchmark-results.md, "Meeting recording") measured the options on the i5-8350U laptop:

- Hardware H.264 costs about 0.15 of a core in the page's process at 720p15 or 1080p30; VP8 1.2 cores and VP9 3.1 cores at 1080p30.
- During a synthetic call with the live engine and Accurate, recording added +0.24 core at 720p15 and +0.53 at 1080p30; WER did not change; auto-answer's send delay p50 went 2,397 → 2,539 ms (720p15) and 2,856 ms (1080p30), one run each.
- Matroska/WebM written in 1 s pieces survives a crash (killed at 14 s, 13.5 s played); Chromium's MP4 keeps its data until Stop.
- A window with `setContentProtection(true)` is absent from the recording (0 of 152,100 of its pixels), with what is behind it shown.
- A 20-minute recording: memory flat, 261 MB/h video + 29 MB/h stereo; Mediabunny finalised it (length and seek index, no re-encoding) in 1.2 s and remuxed it to MP4 in 0.9 s.

## Decision

1. **Where and what.** Desktop app only (1.5.0). Recordings go to **Documents › Paramount AI › Recordings** on that computer. They are never uploaded; the files are not encrypted by Paramount AI (the help recommends BitLocker or FileVault). No cloud copy, no folder choice.
2. **Format.** Hardware H.264 in Matroska (`.mkv`), Opus sound, 1 s pieces. **Standard** (default) 1280×720 at 15 fps, 1.5 Mbps cap; **High** 1920×1080 at 30 fps, 4 Mbps (Settings → Recording). Without a hardware H.264 encoder (WebCodecs `prefer-hardware`), VP8 in WebM at Standard and High is hidden. **Audio only** is Opus in WebM. A separate **stereo** file (You left, Them right, Opus 64 kbps) is kept for later re-transcription, only when the session saves its transcript.
3. **Capture.** The live page records the call's own "You" and "Them" streams (mixed with Web Audio for the main file; split into the stereo file) and a **video-only** `getDisplayMedia` that the shell grants with the display picked for recordings (the main one by default; a picker when there are several), never with a picker of the system's.
4. **Writing and finalising.** The shell (`apps/desktop/src/recordings/`) opens the files under names it makes ("Paramount AI 2026-11-10 14-30-05.mkv", " part 2", never call details), appends each piece in order, records the recording in its index (`recordings.json` in the app's data folder) as `recording` before the first piece, and on Stop finalises the files in a utility process with **Mediabunny** (1.62.1, MPL-2.0; length and seek index, no re-encoding). A recording left `recording` by a crash, a quit or a closed page is finalised at once (page gone) or at the next start (app gone) and marked `recovered`.
5. **Disk.** No start below about 2 GB free; "Space is running low" below 1 GB; a clean stop at 300 MB.
6. **Controls and consent.**
   - Connect card: **Record** Off / Audio only / Screen + audio, **Off every time**; when on, the required tick **"Everyone on the call has agreed to be recorded"** (every call, no separate pop-up).
   - Bar 1 (and the full call window's top bar): a **Rec** pill after Transcript, in the same style, key-cap Ctrl Alt R. Grey "○ Rec" when off: a click asks "Everyone has agreed to be recorded?" with **Start recording** (the type from the Connect card or the ⋮ menu; default Screen + audio). Red pulsing "● Rec m:ss" while recording: a click asks "Stop recording?". Starting again in the call makes a new **part** of the same meeting.
   - **Ctrl+Alt+R** (global during a call; Settings → Hotkeys checks it): the same questions; consent is always a click, never the key alone.
   - ⋮: **Recording type** (Screen + audio / Audio only), remembered on the device.
   - **Private comes on** when a screen recording starts, with a short notice; the person can turn it off.
   - **Save transcript off:** the video is kept, the stereo file is not, and the question says so.
   - **End** stops the recording; the small window then shows "Recording saved · Open in Meetings".
7. **The account.** One small record per part, kind `recording` (`SYNC_KINDS`), a session child (deleted with its session): ids, part, kind, quality, start, length, size, file name, whether a stereo file exists, the computer's id and name, status. Encrypted like all call data (ADR-0049). The video and sound never sync. No migration (the `kind` column is text); Dexie version 10 adds the `recordings` store.
8. **Meetings and the player.** A **Meetings** sidebar page lists the meetings (date, session, length, size, parts, "Saved on <computer>"). In a browser, **Open in desktop app** opens `paramountai://recording/<id>`; after 6 s it says to update the app or open it on the computer that saved the recording (a 1.4.0 app reads the link as invalid and only comes forward). In the desktop app, **Play** is offered for this computer's recordings and the computer can be renamed (default: its own name). The **player window** (`/player/<id>`) plays the file from the private `kite-recording://file/<id>` scheme (byte ranges, files in the index only, readable by the Kite origin only) with the session's saved transcript beside it (click a line to jump there), the meeting's parts, **Save as…** (the file, or an MP4 copy made by the finaliser), **Open folder** and **Delete** (to the Recycle Bin; the record leaves Meetings on every device).

## Consequences

- Recordings never leave the computer; the account knows only that they exist, so Meetings lists them everywhere and plays them only where they are.
- About 0.3 GB an hour at Standard (0.9 GB at High). A call that records costs a quarter to half a core more on this laptop; answers are unaffected by the page's main thread (2 ms p95 delay), Accurate decodes a little slower.
- Deleting a session removes its recording records; the files stay in the Recordings folder until deleted (the help says so).
- A browser-only call cannot record yet (Phase 2: OPFS). macOS and a second monitor were not checked on hardware.
- Private on by default while recording also hides Paramount AI from the person's own meeting screen share, which is what Private is for.
- Opus inside the MP4 copy plays in Chromium, VLC and Windows 11; older QuickTime may not play its sound.
- The other side's sound is the computer's whole sound (Electron loopback), as for the transcript.

## Alternatives considered

- **MP4 while recording:** not crash-safe in Chromium (measured). MP4 only as a Save as… copy.
- **VP9 or 1080p30 by default:** VP9 took 3.1 cores at 1080p30; 1080p30 costs twice the space and slows Accurate decodes. Kept as High.
- **Native ffmpeg** (80–100 MB, LGPL/GPL) or **ffmpeg.wasm** (GPL build, slow, a 2–4 GB memory ceiling): Mediabunny finalises a 20-minute file in about a second, in pure TypeScript.
- **Keeping the call's own screen track running** for recordings started later: a live video track costs CPU for every call; a video-only request when recording starts needs no gesture in the desktop app (measured).
- **A cover window inside the app for tests:** Private protects every app window, so it would vanish from the capture and expose the real screen; the test cover is a separate process.
- **Encrypting the files:** they would not play outside the app, and Save as would have to decrypt; disk encryption covers a lost laptop.
- **A cloud copy:** cheap to store (R2 about $0.015/GB-month), but upload size, a new data class needing approval, and Vercel's 4.5 MB request limit. Not now.

## Validation

- **Unit tests:** web `tests/unit/core/recording/*` (format, recorder with fake Web Audio and MediaRecorder, handoff, reconcile, meetings), `core/storage/recordings`, `recordingPrefs`, `platform/recording`, `core/live/liveChannel` (commands), `shared/protocol` (the link), `features/settings/HotkeyList` (Ctrl+Alt+R); desktop `recordings.test.ts` (manager on real files), `recordingsHost.test.ts` (IPC, byte ranges, Save as / MP4, displays, device name), `media.test.ts` (display pick), `preload.test.ts` (bridge).
- **Real shell, real call page** (`apps/desktop/tests/manual/recording.spec.ts`, the rig, a synthetic cover in its own process; the real screen is never recorded): two parts (Rec pill, Ctrl+Alt+R), Private on by itself, two finalised parts with stereo files, the overlay's painted area 0% in the video with Private on and 100% with it off, Meetings (two parts, rename, Play), the player (length, parts, transcript, buttons); a crash during a recording recovered at the next start and playable.
- **Phase 0 and the investigation:** benchmark-results.md, "Meeting recording".
