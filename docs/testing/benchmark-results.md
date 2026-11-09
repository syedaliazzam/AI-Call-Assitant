# Benchmark results (measured only)

Record **real measurements** here, never targets. The targets are in `docs/architecture/kite-architecture-v3.1.md` §6.2.

| Date | Stage / day | Machine + OS | Browser or desktop | Metric | Value | Notes |
|---|---|---|---|---|---|---|
| 2026-10-26 | Day 1 Stage 3 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200 | Chrome 155.0.8059.86 | Time to first word, browser (`/dev/claude-test`, mode `hello`, `claude-haiku-5-5`) | 4171, 2371, 1293, 2155, 2311 ms (median of runs 2–5: 2233 ms) | Local dev server, Pakistan; database (Neon) and Claude API in US East. Run 1 is cold: it includes the Next.js dev compile of the route and the prompt-cache write. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Total reply time, browser | 4401, 2612, 1532, 2366, 2529 ms (median of runs 2–5: 2448 ms) | Local dev server, Pakistan. One-sentence reply. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Time to first word, server (request received → first text sent) | 2405, 2159, 1268, 2115, 2287 ms (median of runs 2–5: 2137 ms) | Local dev server, Pakistan. Measured before the server timing was split into auth / reaching Claude / Claude's first token; the split is recorded from Stage 4 on. |
| 2026-10-26 | Day 1 Stage 3 | same | Chrome 155.0.8059.86 | Tokens per request | input 28, output 27; cache write 1289 (run 1); cache read 1289 (runs 2–5) | Local dev server, Pakistan. Confirms prompt caching works: the 1289-token system block is written once and read on the following requests within 5 minutes. |
| 2026-10-27 | Day 1 Stage 4 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200 | Chrome 155.0.8059.86 | Time to first word, browser (`/dev/claude-test`, mode `hello`, `claude-haiku-5-5`) | 1498, 1232, 876, 821, 888 ms (median 888 ms) | Production (Vercel iad1), Pakistan: https://kite-call-assistant.vercel.app. Cache already warm from the preview test, so every run is a cache read. 5 runs only, not a p50/p95 measurement. |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Total reply time, browser | 1749, 1429, 1093, 1031, 1086 ms (median 1093 ms) | Production (Vercel iad1), Pakistan. One-sentence reply. |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Time to first word, server (request received → first text sent) | 752, 699, 548, 468, 507 ms (median 548 ms) | Production (Vercel iad1), Pakistan. Browser minus server, per run: 746, 533, 328, 353, 381 ms. The gap (about 350 ms once warm, runs 3–5) is the Pakistan ↔ iad1 network. |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Server split (a): auth / session check | 134, 138, 12, 12, 27 ms (median 27 ms) | Production (Vercel iad1), Pakistan. Runs 1–2 are higher because the Neon database was waking from idle. |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Server split (b): request start → Claude stream opened (includes auth) | 750, 696, 547, 468, 505 ms (median 547 ms) | Production (Vercel iad1), Pakistan. Claude's response headers arrive together with the first token, so this is effectively Claude's time to first token, including the iad1 → Claude API network (plus auth). |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Server split (c): Claude stream opened → first text | 3, 2, 0, 1, 2 ms (median 2 ms) | Production (Vercel iad1), Pakistan. About 0 because the headers and the first token arrive together (see split (b)). |
| 2026-10-27 | Day 1 Stage 4 | same | Chrome 155.0.8059.86 | Tokens per request | input 28, output 27; cache write 0; cache read 1289 (all runs) | Production (Vercel iad1), Pakistan. |
| 2026-10-27 | Day 1 Stage 6 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200 | Chrome (localhost dev server) | Speech-to-text, model A `streaming-zipformer-en-2023-06-26` (87.4 MB): real-time factor / lag / cached load | RTF 0.19; lag speech → first partial ~845 ms (median); cached load 3.4 s | First test, developer's voice. sherpa-onnx v1.13.7 WebAssembly (single-threaded SIMD), greedy search, no hotwords. Power state not recorded. |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, model A: word error rate | Sentence 2 ≈24%, sentence 3 ≈80% (sentence 1 not counted) | First test. Hand-counted (sentence boxes not clicked). Names and ordinary words wrong in sentence 3. **Model A rejected for accuracy** (ADR-0020). |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, official v1.13.7 bundle (model `2023-06-21`, 204.1 MB): RTF / network load / WER | RTF 0.24; network load 3.6 s; sentence 2 ≈24%, sentence 3 ≈27% | First test, greedy search, no hotwords, hand-counted. No final lines appeared (one growing partial), so lag was not measured; the end-of-utterance fix is in the next rows. |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, model `2023-06-21` (separate files, 204.1 MB) + hotwords: real-time factor | 0.239 | Retest, plugged in. modified_beam_search, 4 paths; hotwords BLUEFIN ROUTE :2, NORTHWIND LOGISTICS :2. Single-threaded, so also ≈24% of one CPU core for one channel. |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, model `2023-06-21` + hotwords: lag speech → first partial | 501 ms (median) | Retest, plugged in. Utterances were ended by the model's own endpoint rule. |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, model `2023-06-21` + hotwords: cached load | 2144, 2094, 2204 ms | Retest, plugged in. Loaded from Cache Storage (3 loads). |
| 2026-10-27 | Day 1 Stage 6 | same | Chrome (localhost dev server) | Speech-to-text, model `2023-06-21` + hotwords: word error rate (3 test sentences) | Sentence 1: 5% (renew→review); sentence 2: 24% (professional→fresh not, costs→caused, seat→seed); sentence 3: 53% ("bluefin rode sounds delicted with the report to north end wind logistics"). Overall 13/51 ≈ 25% | Retest, plugged in, developer's voice. Above the 20% bar, so ADR-0020 stays Proposed; two-pass re-check to evaluate on Day 2. |
| 2026-10-27 | Day 1 Stage 6 | same | Desktop app v0.1.0 (Windows, Electron 44.9.3), localhost dev server | Speech-to-text, model `2023-06-21` + hotwords: network load | 3,727 ms = download 1,853 + runtime 106 + model 1,769; 204.1 MB | Retest, plugged in. Download from the local dev server, so not representative of a real network. |
| 2026-10-27 | Day 1 Stage 6 | same | Desktop app v0.1.0 (Windows, Electron 44.9.3), localhost dev server | Speech-to-text, model `2023-06-21` + hotwords: real-time factor / chunk time | RTF 0.241; chunk avg 24.1 ms, max 145.3 ms (per 100 ms of audio) | Retest, plugged in. Same engine as Chrome. |
| 2026-10-27 | Day 1 Stage 6 | same | Desktop app v0.1.0 (Windows, Electron 44.9.3), localhost dev server | Speech-to-text, model `2023-06-21` + hotwords: lag / end of utterance / WER | Lag 1,231 ms (one utterance only, not a median); ended by the pause rule (model rule 0, pause rule 1); sentence 1 WER 0% | Retest, plugged in. Sentences 2 and 3 not read on desktop. |
| 2026-10-27 | Day 1 Stage 6 | same, **on battery** (Windows Balanced plan, CPU held at ~1.7 GHz) | Automated harness: Electron 44.9.3 (Chromium), real-time-paced audio | Speech-to-text, model `2023-06-21`: real-time factor on battery | Greedy search 0.634, 0.687; modified_beam_search + hotwords 0.674, 0.699 (runs back to back) | Measured by the test harness with synthetic Windows text-to-speech recordings of the 3 sentences, not the developer's voice. **Known risk:** above the 0.5 limit on battery (ADR-0020). Beam search + hotwords cost about 2–6% more than greedy search. |
| 2026-10-27 | Day 2 Stage 1 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200, plugged in | Chrome (localhost dev server, model source `local`; version not recorded) | Speech-to-text engine (`2023-06-21` + hotwords, two-channel engine): load time and memory | First load 4,864 ms; cached loads 2,104–2,421 ms; 204.5 MB; WebAssembly memory 536.9 MB with one or two channels | Progress bar reached 100%, then "Ready". Task Manager footprint not captured; the WebAssembly figure is the worker's main memory use. |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Chrome (localhost dev server) | Run A, one channel ("Them" = official LibriSpeech test recordings, looped): real-time factor / lag | RTF 0.232; lag 787 ms; all lines correct; 5/5 utterances ended by the pause rule | Health "ok". With the energy gate. |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Chrome (localhost dev server) | Run B, two channels ("Them" recordings, "You" = microphone, developer silent): real-time factor | Combined 0.430 (Them 0.220, You 0.210); Them lag 773 ms | "You" produced 11 short lines ("YEAH", "UM" ×6, "YOU CAN'T", "TAKES IT", "IMMEDIATELY", "IN THE", "I HAVE NO", "REALLY"): someone was talking at a distance in the room. **Known behaviour:** the microphone picks up nearby speech; the Connect view's headphones / quiet-room tip covers it. That speech also kept the "You" gate open (RTF 0.210). |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Chrome (localhost dev server) | Run C, two channels (developer reading on "You", recordings on "Them"): real-time factor / lag | Combined 0.344 (Them 0.219, You 0.126); Them lag 564 ms; You lag 1,013 ms | The "You" lag was measured before the lag fix below: the old code kept the FIRST onset after a pause, so background speech that produced no text could start the clock early. Re-measure with the fix. |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Chrome (localhost dev server) | Run C: word error rate ("You") | Sentence 1: 16% under the Day 1 scoring, **5%** under the Day 2 scoring (1 error: renew→review); sentence 2: 18% (costs→cost, seat→se, per→for); sentence 3 not read | Day 2 scoring counts a word heard split or joined ("TO DAY" for "today") as correct (`wer.ts`). |
| 2026-10-27 | Day 2 Stage 1 | same | Chrome DevTools on https://kite-call-assistant.vercel.app (production) | Hugging Face CORS from the production origin | **Passed**: tokens.txt status 200 (redirected), 5,048 bytes, SHA-256 correct; encoder range request status 206 (redirected), `bytes 0-0/187823992` | Confirms that production can load the model files from the pinned Hugging Face URLs (ADR-0020). |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Automated harness: Electron 44.9.3 (Chromium), real-time-paced audio | Two channels without and with the energy gate: combined real-time factor | Without gate: speech on both 0.504, speech on "Them" + digital silence on "You" 0.51 (16 phantom "AND" lines). With gate: 0.42–0.435 and 0.236 (no phantom lines) | Synthetic inputs ("You" = Windows text-to-speech of the 3 sentences via Chromium's fake microphone; "Them" = LibriSpeech recordings), not a person's voice. |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Automated harness (as above) | Energy gate: delay added to the lag | 0 ms on 6/6 utterances (You lags 503–743 ms, Them 549–934 ms). Offline check with the real gate on 59 utterances (noise RMS 0–0.01, voice at 100/50/25% volume): median 0 ms, worst 100 ms; 98.6–99.8% of speech audio passed | The gate does not explain the 1.0 s "You" lag in Run C (see the lag-fix note above). |
| 2026-10-27 | Day 2 Stage 1 | same, plugged in | Automated harness (as above), model source `remote` | First load from the pinned Hugging Face URLs / cached load | 28.8 s (204.5 MB, SHA-256 checked in the browser) / 3.0 s | From Pakistan. Second load from Cache Storage, no network. |
| 2026-10-27 | Day 2 Stage 1 | same | `pnpm --filter web stt:runtime` (Node 24) | Build step: fetch and unpack the runtime from the pinned release | 1 min 16 s from scratch (175 MB archive); skipped when present and verified | Vercel builds run the same step (build image has tar + bzip2). |
| 2026-10-27 | Day 2 Stage 2 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200, in a slow power state (see notes) | Desktop app v0.1.0 (Windows, Electron 44.9.3), localhost dev server | "Them" = system-audio loopback (YouTube TED talk), "You" = microphone: capture and accuracy | No picker; "Them = this computer's sound"; talk transcribed accurately on "Them"; developer's speech only on "You"; You lag 785 ms (gate adds 0 ms) | Confirms the Stage 1 lag fix. **Known behaviour:** with the video on speakers, "You" picked up short fragments ("ABOUT ONE ISLAND", "YOU MAY", "AND WE EXHIBIT"): speaker sound leaking into the microphone. The Connect view's headphones tip covers it. |
| 2026-10-27 | Day 2 Stage 2 | same, slow power state | Desktop app v0.1.0 (as above) | Real-time factor and first load | RTF 0.57 per channel; first load 13.0 s (model start 5.96 s) | **Not a valid desktop speed measurement**: the laptop was in a slow power state (model start is normally ~1.8–2.0 s). Recorded as a power-risk data point: a CPU slowdown can push one channel above 0.5. Health stayed "ok" because its threshold is 0.8. Desktop speed is re-measured during the Stage 7 real call. |
| 2026-10-27 | Day 2 Stage 2 | same, slow power state | Chrome (localhost dev server) | "Them" = shared YouTube tab with tab audio: first run | RTF 0.650; model start 5.45 s | Same slow power state; not a valid speed measurement. Power-risk data point, as above. |
| 2026-10-27 | Day 2 Stage 2 | same, plugged in, normal power state | Chrome (localhost dev server) | "Them" = shared YouTube tab with tab audio, "You" = microphone: final run | Model start 1.9 s; Them RTF 0.268, You RTF 0.175, combined **0.443**; You lag 347 ms (gate adds 0 ms); "Them" transcribed accurately | Picker opened on the "Chrome Tab" pane. Share with "Also share tab audio" off → "Kite can't hear the meeting: the share has no sound…". Cancelled picker → "Sharing was cancelled. Click Connect again and pick the meeting tab." |
| 2026-10-28 | Day 2 Stage 4 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 | Desktop app v0.1.0 (Windows, Electron 44.9.3), localhost dev server | `/live/demo` with a YouTube TED talk on the laptop speakers (no headphones): echo filter | 5 echo "You" lines hidden ("Hiding echo from your speakers (5 lines so far)"); the developer's own line "YES THANKS FOR JOINING THE CALL TODAY" kept; long "Them" lines split for display | Before the filter, whole "Them" sentences reappeared as "You" (speaker → microphone). Remaining issue at that point: echo lines flashed briefly before being hidden; fixed afterwards with a 1.5 s display hold while "Them" speaks (not re-measured). |
| 2026-10-28 | Day 2 Stage 5 | Intel Core i5-8350U (4 cores / 8 threads), 24 GB RAM, Windows 11 Pro 10.0.26200 (same laptop, confirmed), plugged in | Chrome 155 (from the user agent in the results), `crossOriginIsolated` true, same microphone | **Baseline**: `2023-06-21` streaming + hotwords, no second pass: word error rate / latency / RTF / memory | Overall WER **27.5%** (sentence 1 0%, sentence 2 29%, sentence 3 60%); end of speech → final line p50 1,673 / p95 1,871 ms; RTF 0.303; Them lag 773 ms; WebAssembly memory 536.9 MB | Measured with the provisional COOP/COEP headers on (removed afterwards; they do not affect the single-threaded runtime). WER scoring spells out digits before comparing. |
| 2026-10-28 | Day 2 Stage 5 | same, plugged in | Chrome 155 (as above) | **Config 1**: model A `2023-06-26` streaming + Zipformer GigaSpeech non-streaming second pass (v1.13.2 vad-asr threads runtime, Silero VAD, hotwords; 175.4 MB) | Overall WER first pass 52.9% → refined **25.5%** (sentence 1 5%, sentence 2 18%, sentence 3 60%); end of speech → refined text p50 2,438 / p95 3,875 ms; RTF both workers 0.374; WebAssembly memory 1,073.7 MB (both workers) | **Rejected** (ADR-0020): not clearly under 20%, about the same as the baseline, twice the memory, about 0.7 s later. Chrome Task Manager footprint not reported. |
| 2026-10-28 | Day 2 Stage 5 | same, plugged in | Chrome 155 (as above) | **Config 2**: `2023-06-21` streaming + Moonshine v2 tiny second pass (v1.13.2 vad-asr, Silero VAD; 262.4 MB) | Overall WER first pass 68.6% → refined **88.2%**; end of speech → refined text p50 2,334 ms; WebAssembly memory 1,073.7 MB (both workers) | **Rejected** (ADR-0020): the second pass made the text worse on the same audio (e.g. "This year, the end cost is $2 per c, but one hundred and fifty two cents."). Sentence 1 was not captured (only "UM" heard), so it is invalid for this run. RTF not reported. |
| 2026-10-28 | Day 2 Stage 5 | same | Chrome 155 with COOP `same-origin` + COEP `credentialless` on every route | Cross-origin isolation: app checks | **Passed**: sign-in, `/dev/claude-test` streaming, `/live/demo`, `crossOriginIsolated` = true | The headers were needed only by the second pass and were removed with it. |
| 2026-10-28 | Day 2 Stage 6 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), power state not recorded | Automated: Playwright 1.64.1 Chromium (headless), fake microphone playing the fixture WAV, `pnpm --filter web test:stt` | Speech-to-text integration test (`2023-06-21`, no hotwords, one channel): WER / RTF / end of speech → final line | `0.wav` (6.6 s): WER 0/18 = 0%, RTF 0.225, 1,632 ms. `1.wav` (16.7 s): WER 1/48 = 2.1%, RTF 0.402, 1,622 ms. Model start 4.6 s (first run 7.3 s) | Official LibriSpeech recordings from the model repository (Apache-2.0), not a person's voice. The one 1.wav "error" is spelling only (DISHONOURED in the reference, DISHONORED from the model). Input reached the worker at 16,000 Hz. Test threshold: WER ≤ 10% per recording (justified in `stt.spec.ts`). |
| 2026-10-28 | Day 2 Stage 7 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), **on battery**, power mode not recorded | Chrome, `/dev/stt-test` (localhost dev server) | Battery run, two channels ("Them" = official recordings looped, "You" = microphone), 78.8 s: real-time factor / lag / latency / health | Combined RTF **0.860** (Them 0.454, You 0.407); lag Them 848 ms, You 973 ms; end of speech → final line p50 1,508 / p95 2,265 ms; health "slow" shown (the "Plug in your laptop" hint), "falling behind" not shown; cached load 3,768 ms | On battery, two channels use about 86% of one CPU core but still keep up (RTF below 1.0; lags close to plugged-in values). The 0.860 is the average over the run; "falling behind" needs the per-second RTF above 0.8 for 5 s in a row (`health.ts`), which did not happen. Planned 2 minutes; 78.8 s measured. |
| 2026-10-28 | Day 2 Stage 7 | Vercel build (iad1, Amazon Linux) | `vercel deploy --prod` | Build step `stt:runtime` on Vercel's Linux (GNU tar) | **Passed**: deployment Ready | First production build with the runtime fetch (the earlier production build ran `next build` only). Confirms the GNU tar fix (`f3424b1`). Build-log timings not recorded. |
| 2026-10-28 | Day 2 Stage 7 | same laptop (power state not recorded) | Chrome, https://kite-call-assistant.vercel.app/live/demo (production) | Production `/live/demo`: model load from Hugging Face, tab share, transcription | Model loaded from the pinned Hugging Face URLs with the progress bar (first load time not recorded); reload from cache quick (not timed); tab share with audio works; "Them" (a YouTube talk) transcribed accurately; "You" transcribed | Line splitting was uneven on the talk because it has almost no pauses; recheck in the real call. Desktop app against production not yet checked. |
| 2026-10-28 | Day 2 Stage 6 | GitHub Actions `ubuntu-latest` | Playwright 1.64.1 Chromium (headless), CI job `stt-integration` | Speech-to-text integration test on Linux (`0.wav`, `1.wav`) | **Passed** (both recordings, WER ≤ 10%); per-file numbers not copied | First green run after the GNU tar fix (`f3424b1`). Model files fetched from the pinned sources with SHA-256 checks. |
| 2026-10-28 | Day 2 Stage 7 | same laptop | Desktop app v0.1.0 (Windows), `pnpm --filter desktop start` → production | Production in the desktop app: capture and echo filter | **Passed**: no picker; both channels transcribed; echo filter hid 7 lines | Model loaded from Hugging Face in the desktop app; load times not recorded. |
| 2026-10-28 | Day 2 Stage 7 | same laptop | Desktop app v0.1.0 (Windows), real call with a colleague (meeting app not recorded) | Real call: labels, line breaks, accuracy | Labels "You" / "Them" correct; lines broke at natural pauses; **names and technical terms often wrong** (the company name heard as one invented word; "chatbots and AI agents" heard as unrelated words); short echoes ("GONE", "OKAY SO") shown on speakers | **Main known limitation** (ADR-0020 "Real-call result"). Short echoes are the known rule: only lines of 4+ words are judged as echo. Partial lag and final latency not measured during the call. Levers: session hotwords (Day 3), prompt note that the transcript is imperfect (Day 4), desktop native engine spike after Day 4. |
| 2026-10-28 | Day 2 Stage 7 | — | Chrome, Meet in a tab | Real call in the browser | **Skipped** (same engine as the desktop app; tab-audio capture checked in production with a shared tab) | macOS desktop: **deferred to Day 6/7** (no Mac available). |
| 2026-10-29 | Day 3 Stage 4 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in, same microphone | Chrome 155, `/dev/stt-test` (localhost dev server) | **Run A, session hotwords** (session "Northwind Logistics · Account review"; 4 hotwords: BLUEFIN ROUTE :2, NORTHWIND LOGISTICS :2, PROFESSIONAL PLAN :2, ACCOUNT REVIEW :1.5): WER / RTF / latency | Overall WER **19.6%** (10/51): sentence 1 5% (renew→redeem), sentence 2 18% (inserted "so", cost, seat→se), sentence 3 40% ("your fin drove sense their … northman logistics"); RTF 0.206; lag median 1,084 ms; end of speech → final line p50 1,206 / p95 1,837 ms (n=4) | One channel ("You"). The key-term names were **not** recognised despite boost 2: "Bluefin Route" → "your fin drove", "Northwind" → "Northman". "professional plan" was right in both runs. |
| 2026-10-29 | Day 3 Stage 4 | same, plugged in, same microphone | Chrome 155, `/dev/stt-test` (localhost dev server) | **Run B, no hotwords**: WER / RTF / latency | Overall WER **13.7%** (7/51): sentence 1 0%, sentence 2 12% (cost, seat→se), sentence 3 33% ("your friend road sense the … northland logistics"); RTF 0.198; lag median 834 ms; end of speech → final line p50 1,401 / p95 1,701 ms (n=3) | Same session, hotwords off. **Run A was 3 words worse than run B** (stop rule, day-03-sessions.md): reported to the developer before any tuning; a repeat pair (A2, B2) follows. Single runs: of the 3 extra errors in A, 2 ("redeem", the inserted "so") are not near any hotword. |
| 2026-10-29 | Day 3 Stage 4 | same, plugged in, same microphone | Chrome 155, `/dev/stt-test` (localhost dev server) | **Run A2, session hotwords** (same session and 4 hotwords as run A): WER / RTF / lag | Overall WER **13.7%** (7/51): sentence 1 5% ("tanks"), sentence 2 24%, sentence 3 13% ("Bluefin Route sends the weakly livy report to Northwind Logistics every Monday at nine thirty": **both names exactly right**); RTF 0.156; lag 859 ms | Repeat pair, one channel ("You"). |
| 2026-10-29 | Day 3 Stage 4 | same, plugged in, same microphone | Chrome 155, `/dev/stt-test` (localhost dev server) | **Run B2, no hotwords**: WER / RTF / lag | Overall WER **19.6%** (10/51): sentence 1 5% ("car"), sentence 2 12%, sentence 3 47% ("bluffin roads and the weekly delivery report to now turn to artistics every Monday at nine thirty"); RTF 0.144; lag 847 ms | Repeat pair. **All four runs:** overall WER with hotwords 19.6 / 13.7 (avg 16.7%), without 13.7 / 19.6 (avg 16.7%): **no overall difference**. Sentence 3 (names) avg 26.5% with hotwords vs 40% without; only a hotword run got both names exactly right. 4-run average ≈17% on the test sentences, with large run-to-run variance (13.7–19.6%). Decision: session hotwords stay **on** (ADR-0020). |
| 2026-10-29 | Day 3 Stage 5 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), Node 24.21.0 | `pnpm --filter web verify:warm` (real server code: buildPrompt + warmCache; no browser) | Session prompt cache: warm-up (`max_tokens: 0`, non-streaming) twice for an invented session with an invented 2,000-word document, `claude-haiku-5-5` | Call 1: cache write **4,508**, read 0, output 0, 838 ms. Call 2: cache write 0, read **4,508**, output 0, 722 ms. **PASS** | Times are from this laptop to the Claude API (no Vercel, no sign-in). Earlier run with a 2,500-word document: write 5,468 / read 5,468, 972 / 755 ms. |
| 2026-10-29 | Day 3 Stage 5 | Vercel production build (`dpl_49Dv9641sbXZa8bLe7Q35EQ84VQn`, commit `7ddbe15`), checked with curl from the same laptop, not signed in | — | Production deploy and HTTP checks | Build: "Speech-to-text runtime: 3/3 files present and verified", compiled, build 42 s, deployment completed. `/` → 307 to `/login`; `/login` 200; `POST /api/answer` → 401 `{"code":"unauthorized"}` (JSON); `/stt-runtime/v1.13.7/` loader `.js` 200 (82,688 B), `.wasm` 200 (13,150,239 B, `application/wasm`), API `.js` 200 (53,867 B); no COOP/COEP header on `/`, `/login`, `/live/x` or the `.wasm` | Signed-in checks (warm-up in production, live call, desktop app) are the developer's end-of-day list. |
| 2026-10-30 | Day 3 wrap-up | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in | Playwright 1.64.1: Chromium (new headless, fake microphone + fake shared tab) and the desktop app (Electron 44.9.3, fresh profile), both on production, test account `kite-e2e@example.com` | Production end-to-end suites (`pnpm --filter web test:e2e-prod`), 11 steps | **11/11 passed.** Chrome: key terms 3; warm-up 1 cache write **1,587** / read 0 / output 0; warm-up 2 (reload) write 0 / read **1,587** / output 0; speech model ready after 61 s (fresh profile, download from Hugging Face); 1 final line live; saved transcript 1 line before and after reload; session deleted. Desktop: dashboard empty (0 sessions); session survives a reload (added and rerun: desktop 4/4 passed, model ready after 63 s); Open with 0 dialogs; model ready after 51 s; Connect with no picker; 1 final line; Delete all local data deleted 1 session, dashboard empty | With fake media the "You" channel also carries the fake "Them" audio (meters measured moving together, e.g. 75/77, then a steady 21/21 to 23), so "You" lines repeat "Them" and are hidden by the echo filter: final lines were all "Them". Real microphones were checked by the developer on Days 2–3. |
| 2026-10-30 | Day 4 Stage 3 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), Node 24.21.0 | `pnpm --filter web verify:answer-cache` (real server code: buildPrompt + warmCache + streamReply; no browser) | Append-only conversation cache: warm-up, then 3 streamed answers (`max_tokens` 400) on an invented session (2,000-word document) and an invented call whose conversation grows by one chunk per answer, `claude-haiku-5-5` | Warm-up: write **4,833**, read 0, 1,383 ms. Answer 1: write 121, read **4,833**, uncached 65, output 109, first text 1,228 ms. Answer 2: write 266, read **4,954** (= 4,833 + 121), uncached 68, output 95, first text 917 ms. Answer 3: write 244, read **5,220** (= 4,954 + 266), uncached 65, output 137, first text 971 ms. **PASS** | Each read equals everything the previous request cached, and each write is only the new chunk (plus the previous answer's question line): the chunked conversation reads at the previous breakpoint as designed (ADR-0025). Times are from this laptop straight to the Claude API (no Vercel, no sign-in); first-text times here are not the Stage 11 latency measurement. |
| 2026-10-30 | Day 4 Stage 11 | Vercel production build (`dpl_BduGkcSVbGmhr2kBr4P2zjS7Bz7v`, commit `0953df6`), checked with curl from the same laptop, not signed in | — | Production deploy and HTTP checks | Build: "Speech-to-text runtime: 3/3 files present and verified", compiled in 23.4 s, build 55 s, deployment completed. `/` → 307 to `/login`; `/login` 200; `/dev/latency` → 307 to `/login`; `POST /api/answer` → 401 `{"code":"unauthorized"}`; runtime `.js` 200 (82,688 B), `.wasm` 200 (13,150,239 B, `application/wasm`), API `.js` 200 (53,867 B); no COOP/COEP header | Same results as Day 3. |
| 2026-10-30 | Day 4 Stage 11 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in | Playwright 1.64.1: Chromium (new headless, fake microphone + fake shared tab) and the desktop app (Electron 44.9.3 built from this branch, fresh profile), both on production, test account `kite-e2e@example.com` | Production end-to-end suites with answers (`pnpm --filter web test:e2e-prod chrome.spec.ts desktop.spec.ts`) | **Chrome 8/8 passed:** key terms 3; warm-up 1 write **1,845** / read 0; warm-up 2 write 0 / read **1,845**; model ready after 44 s; 1 final line ("Them"); **Answer (Ctrl+Enter):** headline streamed (35 words), 2 bullets, first word 1,350 ms (one answer), cache read **1,845**, write 85; rated 👍; saved transcript 1 line before and after reload (saved ≥ live: yes); session deleted. **Desktop 4/4 passed** (after a test-only fix, below): dashboard empty; session survives reload; 0 dialogs; model ready after 34 s; no picker; 1 final line; **Chat answer:** headline streamed (34 words), 2 bullets, first word 870 ms, cache read 900, write 0; rated 👍; End; Delete all deleted 1 session | The first desktop run failed at End only: the test's `getByRole('button', { name: 'End' })` also matched the chat box's "Send" button; fixed with `exact: true` (test code only) and rerun. The headlines were longer than 15 words: both questions could not be answered from the session (the fake tab plays an unrelated recording; the desktop session has no document), the case the evaluation also scores lowest on headline length (answer-eval.md, scenario 08). |
| 2026-10-30 | Day 4 Stage 11 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop, Pakistan), plugged in; Vercel function `iad1` (requests enter Vercel at the `bom1` edge, from the `x-vercel-id` header) | Playwright 1.64.1: Chromium (new headless) and the desktop app (Electron 44.9.3 built from this branch, fresh profile), both on production, admin test account `kite-e2e-admin@example.com` (disabled again straight after) | `/dev/latency`: warm-up, then 20 answers one after another on an invented session (2,000-word document) and a growing invented call, through the live client path (`pnpm --filter web test:e2e-prod latency.spec.ts`) | **Run 1 (`dpl_BduGkcSV…`):** Chrome: request sent p50 0 / p95 0 ms; **first word p50 1,076 / p95 1,388**; headline p50 1,446 / p95 1,641; done p50 1,480 / p95 1,757; cache read 20/20. Desktop: sent 0 / 1; **first word 1,155 / 1,722**; headline 1,454 / 2,173; done 1,511 / 2,173; cache read 20/20. **Run 2, with server timings (`dpl_5UtVdtVV…`):** Chrome: first word p50 1,131 / p95 1,934; headline 1,401 / 2,174; **server (request received → first text) p50 615 / p95 1,159**. Desktop: first word 1,109 / 1,327; headline 1,379 / 1,924; server 643 / 801. Cache 20/20 both | Above the 1.0 s first-word target. Levers (architecture §6.2), in order. (1) **Cache hits:** confirmed, 20/20 in every run. (2) **Shorten the tail:** not applicable; every fixture line is stable, so the tail is empty. (3) **Lower `max_tokens`** 400 → 250 (`dpl_6YLSeYUf…`): Chrome first word 1,131 → 1,092 (server 615 → 560), desktop 1,109 → 1,075 (server 643 → 569); within run-to-run noise (output length does not change time to first token), so it was reverted to 400. (4) **Region:** already `iad1`, next to Anthropic. About 500 ms of each first word is this laptop ↔ US network: `curl` to the site shows TCP 60 ms (to the `bom1` edge), TLS done at about 200 ms, first byte of `/login` 490–640 ms. Moving the function to `bom1` would put the sign-in check (Neon, US) and Claude (US) a round trip away instead, so it is not expected to help. Server-side time to first text (p50 560–643 ms) is within the target. |
| 2026-10-30 | Day 4 Stage 11 (final build) | Same laptop; Vercel production `dpl_HbySG84WzN6iSgf4s68Gefk6A8V9` (round-3 prompt, `max_tokens` 400) | Playwright 1.64.1, Chromium and the desktop app as on the earlier row, test account `kite-e2e@example.com` | Production end-to-end suites on the final Day 4 build | `/` 307, `/login` 200, `POST /api/answer` 401. **Chrome 8/8:** warm-up 1 write **1,081** / read **836**; warm-up 2 write 0 / read **1,917** (= 1,081 + 836); model ready after 29 s; 1 final line; Answer (Ctrl+Enter) headline **10 words**, 4 bullets, first word 920 ms, cache read 1,917, write 85, rated 👍; saved transcript 1 line before and after reload; session deleted. **Desktop 4/4:** dashboard empty; reload; 0 dialogs; model ready after 36 s; no picker; 1 final line; Chat answer headline **13 words**, 3 bullets, first word 760 ms, cache read 968, rated 👍; End; Delete all deleted 1 session | With the Day 4 rules the system block is about 836 tokens, above the 512-token minimum, so it is now cached by itself and shared by every session: a new session's first warm-up reads it (836) and writes only its own session block. The suite's warm-up check was updated for this (test code only; the first run of this build failed on the old "read = 0" check). Headlines are now within 15 words (they were 34–37 before tuning round 3). |
| 2026-10-31 | Day 5 Stage 5 | Same laptop, Node 24.21.0 | `pnpm --filter web verify:notes` (real server code: server/notes.ts; no browser) | Call notes with `claude-sonnet-5-5` on a generated, invented **60-minute** call: 455 lines (19,437 characters), three questions, two agreed next steps with owners, a garbled stretch at 1,500–1,680 s, and three answers (one thumbs down with a note) | **PASS.** 8,542 ms; input 17,514 tokens, output 637, cache write 1,545. Notes: 6 summary bullets, 3 questions, 2 next steps (both with owners), **1 unclear part at 1,500–1,676 s** (the garbled stretch, listed instead of guessed), 2 proposed lessons; question ratings taken from the request (up, none, down) | The notes evaluation (3 scenarios) could not run: the Anthropic API key reached its usage limit during it ("You will regain access on 2026-11-01 at 00:00 UTC"). |
| 2026-10-31 | Day 5 Stage 3 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (build 26200, same laptop), one monitor 1920 × 1080 | Desktop smoke test (`pnpm --filter desktop test`, Electron 44.9.3, local test page) | Compact window and screen-share protection, captured with Electron's own `desktopCapturer` | Compact window: opened at `/compact/[id]`, **always on top, not focused** (shown with showInactive), content-protected; a bad id is refused; closed on request. **Protection on: 0 of 19,234** sampled pixels inside the window's area were the window's own colour (pure magenta); **off: 19,234 of 19,234**. Smoke test 13/13 | `setContentProtection(true)` = `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` on Windows 10 2004+; the window stayed in the taskbar and Alt+Tab. The check waits 800 ms after each change (Electron docs: it takes effect with the next desktop composition). |
| 2026-10-31 | Day 5 Stage 3 | Same laptop | Manual check `pnpm --filter desktop test:manual` (`tests/manual/protection-chrome.spec.ts`): **Google Chrome 155.0.8059.86** (installed, visible window) sharing the **entire screen** with `getDisplayMedia` at 1920 × 1080, the path Google Meet uses in Chrome | Screen-share protection seen through a browser's screen share | **Protection on: 0 of 75,816** sampled pixels of the compact window's area in Chrome's shared frame were its colour; **off: 75,816 of 75,816** | Not a real meeting: no Teams or Zoom is installed here, and a real Meet call needs a Google account and a second participant. Those are the developer's end-of-day check. macOS not verified (no Mac); apps built on ScreenCaptureKit may capture protected windows anyway (Electron docs): Day 6 macOS checks. |
| 2026-10-31 | Day 5 Stage 2 | Same laptop, Node 24.21.0 | `pnpm --filter web verify:screenshot` (real server code; no browser) | Screenshot answer against the real API: warm-up of an invented session (about 900 words) and call, then a screenshot answer with an invented 1,280 × 720 slide (48,165 bytes JPEG), `claude-haiku-5-5` | Warm-up: write 2,429, read 836. Screenshot answer: cache read **3,266** (everything cached before it), write **0**, uncached input 1,299 (the image and the tail), output 139, first text 1,009 ms, total 1,630 ms. **PASS** | The screenshot is in the uncached part, so it never invalidates the conversation cache. |
| 2026-10-31 | Day 5 Stage 2 | Same laptop | `pnpm --filter web eval:answers` (18 scenarios × 2 runs; screenshot scenarios 16–18 new) | Answer evaluation, with the Day 5 gate rule (existing scenarios: 3-run mean ≥ previous baseline − 0.15; new scenarios gated separately) | Runs 1–3: Day 4 scenarios 9.50, 9.20, 9.27 (**3-run mean 9.32**, gate ≥ 9.28: pass); screenshot scenarios 8.33, 8.67, 8.83, and 8.83 again after the final fix (gate ≥ 8: pass); all 18: 9.31, 9.11, 9.19 | Byte-identical prompts for the Day 4 scenarios varied by about ±0.15 between runs, which is why the gate uses a 3-run mean. Details in `docs/testing/answer-eval.md`. |
| 2026-10-31 | Day 5 Stage 0 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop, Pakistan); Vercel production `dpl_HLCfvLik6P11ud1bCWUcCT8Dxq4B` | Playwright 1.64.1, Chromium (new headless), test account `kite-e2e@example.com` | Session cookie cache (60 s): Chat answers sent from the signed-in page (`pnpm --filter web test:e2e-prod auth-cache.spec.ts`), then the Chrome suite | **Server sign-in time (`serverMs.auth`):** answer 1 **26 ms** (cache set at sign-in), answer 2 **2 ms**, answer 3 after a 65 s wait **100 ms** (cache expired: database read) and the response sent a fresh `session_data` cookie back, answer 4 **5 ms** (cached again). All four 200. **Chrome suite 8/8:** warm-up 1 write 1,080 / read 836; warm-up 2 read 1,916; Answer headline 13 words, 3 bullets, first word 1,970 ms (one answer), cache read 1,916, rated; saved transcript 1/1 after reload; session deleted | The refreshed cookie is forwarded, so answers after the first minute go back to the cache instead of reading the database every time. Before the cache, every answer's sign-in check was a database read (Day 4 server time to first text p50 560–643 ms included it). The single first-word time in the suite is one sample, not a latency measurement (`/dev/latency` is the measurement). |
| 2026-10-30 | Day 5 Stage 5 | Same laptop, Node 24.21.0 | `pnpm --filter web eval:notes` (3 scenarios × 3 runs) | Notes evaluation | **Not run**: the first request returned HTTP 400 "You have reached your specified API usage limits" (access back 2026-11-01 00:00 UTC) | Queued. The same limit stopped every Claude feature in production. Led to the `claude_unavailable` message and the one-key, one-limit, cost-first rules (ADR-0026). |
| 2026-10-31 | Day 5 (API check) | Same laptop, Node 24.21.0 | One `messages.create` with `claude-haiku-5-5`, `max_tokens` 5, prompt "ok" | Is the API back? | HTTP 400, usage-limit error, "regain access on 2026-11-01 at 00:00 UTC" | One request, asked for by the developer. A free models-list request with the same key still worked (HTTP 200) under the limit. |
| 2026-10-31 | Day 5 Stage 6 | Same laptop | Playwright 1.64.1 Chromium (headless), `pnpm --filter web test:review` (no Claude call; mocked `/api/notes`) | Review page harness | **5 of 5 passed** (notes, answers, transcript; usage-limit message; Regenerate; "Save transcript" off → "Written from answers only"; Delete in an in-app dialog → dashboard, everything removed) | Fixtures are invented sessions in the browser's IndexedDB; the page uses the app's compiled stylesheet. |
| 2026-10-31 | Day 5 Stage 7 | Same laptop | Playwright 1.64.1 Chromium (headless), `pnpm --filter web test:review` | Review and lessons harness | **7 of 7 passed**, adding: Edit + Approve for all calls, Reject (only decisions stored); Regenerate with reworded proposals keeps both decisions (2 stored, no duplicates); Settings "What Kite has learned": edit, Clear all lessons (in-app dialog) | Unit tests: 529 web, 64 desktop. The rules block without lessons hashes to the Day 4 block (SHA-256 `bd8781f8…`, 2,890 characters). |
| 2026-11-01 | Day 5 (API check) | Same laptop, Node 24.21.0 | One `messages.create` with `claude-haiku-5-5`, `max_tokens` 5 | Is the API back? | **HTTP 200**: 13 input, 5 output tokens | One request, asked for by the developer, after the limit reset at 00:00 UTC. |
| 2026-11-01 | Day 5 Stage 5 | Same laptop, Node 24.21.0 | `pnpm --filter web eval:notes --only=notes` (3 scenarios × 3 runs, 18 requests) | Notes evaluation, `claude-sonnet-5-5` notes and grader | **9.33 / 10, PASS** (gate ≥ 8): n1 9.3, n2 10.0, n3 8.7 | Faithfulness 3.3 / 4.0 / 3.0 of 4. Details in `docs/testing/answer-eval.md`. |
| 2026-11-01 | Day 5 Stage 7 | Same laptop, Node 24.21.0 | `pnpm --filter web eval:answers --only=lessons`, then with `--without-lessons` (16 requests) | Answers with an approved lesson, `claude-haiku-5-5`, Sonnet grader | **With lessons 9.00, without 8.50, PASS** (gate: ≥ 8 and higher than without) | Scenario 19's headline went over 15 words with its lesson (both runs). |
| 2026-11-01 | Day 4 follow-up | Same laptop, Node 24.21.0 | `pnpm --filter web eval:answers --only=04-follow-up-refers-back --runs=1` (2 requests) | A follow-up that refers back to an earlier answer | **9.0 / 10, PASS**: facts 3/3, consistent 2/2 | Headline over 15 words in this run (0/1). |
| 2026-11-01 | Day 6 Stage 4a | Same laptop, Node 24.21.0 | `pnpm --filter web eval:answers --only=lessons`, 2 rounds (16 requests) | Headline ≤ 15 words with an approved lesson (new `LESSONS_HEADING` ending) | Round 1: 9.25 (scenario 19 headline 0.5). **Round 2 (kept): 10.00**, headline 1.0 in every run. **PASS** | Rules block without lessons unchanged (hash test), so the `answers` group was not re-run. |
| 2026-11-01 | Day 6 Stage 4b | Same laptop, Node 24.21.0 | `pnpm --filter web eval:notes --only=notes` (18 requests) | Notes: ratings linked by answer id; silence not unclear | **9.89 / 10, PASS** (n1 10.0, n2 10.0, n3 9.7; was 9.33). n3 faithful 3.7 (was 3.0), unclear 1.0 (was 0.7) | |
| 2026-11-02 | Day 6 Stage 3 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop) | electron-builder 26.17.0, NSIS one-click per-user, Electron 44.9.3, Kite 0.1.0 | Windows installer: build, silent install, smoke test against the installed app, silent uninstall | Installer `Kite-Setup-0.1.0.exe` **120,534,949 bytes (115.0 MiB)**; installed size **368.4 MB** in `%LOCALAPPDATA%\Programs\kite` (no admin prompt); Start-menu shortcut "Kite". Desktop smoke test against the installed `Kite.exe`: **14/14** (window icon 48×48, the company mark). Silent uninstall: no program folder, data folder (`%APPDATA%\kite`), shortcut or registry entry left. **PASS** | Unsigned: SmartScreen warns on first run until the lead decides on a code-signing certificate. The keep-data answer (Yes) is a human check (final test plan §9.4). Update test waits for the update-host decision. |
| 2026-11-02 | Day 6 Stage 3 | Same laptop (Windows 11 Pro, Smart App Control on) | electron-updater 6.8.10, GitHub provider, public releases-only repo `Zainpak123/kite-releases` | Update test: installed 1.0.0-beta.1 updates itself to 1.0.0-beta.2 (published as a pre-release, then deleted) | **PASS**: beta.1 found, downloaded and installed beta.2 (`[kite] update 1.0.0-beta.2 downloaded (running 1.0.0-beta.1)`); Windows reports 1.0.0-beta.2 **285 s** after start (mostly the 115 MB download), and the app restarted into it. Smoke test against the updated install: 13–14/14 (the screen-capture protection check passed in 1 of 3 runs while the display was locked; 14/14 on the 0.1.0 install with the screen on). Silent uninstall: nothing left, including the updater cache | First try found a real bug: a default import of electron-updater was undefined once bundled (fixed: named import). Smart App Control blocked the build when the uninstaller deleted `%LOCALAPPDATA%\kite-updater` recursively; deleting the one cached file and the empty folder builds. |
| 2026-11-02 | Day 6 Stage 6 | GitHub Actions `macos-latest` runner (1024×768 screen), run 41379334693 | electron-builder 26.17.0, Electron 44.9.3, Kite 1.0.0-beta.2 | macOS readiness: desktop smoke test and unsigned `.dmg` build | Smoke test **PASS** (after the window-size check allowed a 3 px shortfall when the window must shrink: 674 for a 677 px work area). Unsigned `.dmg` for arm64 and x64 built; artifact `kite-macos-dmg` **265,241,841 bytes** (both), kept until 2026-11-16 | No Mac to run it on: `docs/testing/macos-checklist.md` is for a Mac tester. Not signed or notarised (an Apple Developer account is a lead decision). |
| 2026-11-02 | Day 6 Stage 3 (re-check) | Same laptop, display on and unlocked; Smart App Control **on** | Desktop smoke test, 3 runs | Screen-capture protection with the screen on | **Installed 1.0.0-beta.2 (latest build): could not run.** Windows Code Integrity blocked `Kite.exe` from starting (events 3033/3077, "did not meet the Enterprise signing level requirements"); all 3 runs failed at launch. **Same code, development build (Electron's signed binary): 3/3 runs 14/14**, protection check and window-icon check passing each time | The earlier protection failures on the installed beta.2 were with the display locked (window-icon check skipped). The block is Smart App Control on an unsigned build: code signing is likely required (ADR-0028); Day 7 checks a teammate's laptop first. |
| 2026-11-02 | Day 6 (Store investigation) | GitHub Actions `windows-latest`, run 41381874364 (no Smart App Control; admin) | electron-builder 26.17.0 appx target, Windows SDK 10.0.26100 signtool, throwaway test certificate | Microsoft Store package (MSIX/AppX): build, install, start by app id, smoke test | **PASS.** `Kite-1.0.0-beta.2.appx` **163,956,872 bytes**; installed as `ParamountIntelligence.Kite_1.0.0.0_x64`; started by its app id (package identity): 4 Kite processes from the package. Smoke test against the packaged `Kite.exe`: **13 passed, 1 skipped** (window icon: no window list on the runner). Screen-share protection hidden 0/8,424, shown 8,424/8,424; screenshot capture 1024×768 | Local install not possible here (Developer Mode off, no admin; a test certificate must be trusted machine-wide). The smoke test ran the packaged binaries directly (without package identity); microphone, system audio, hotkeys and protection inside the running Store app are human checks (final test plan §9b). electron-builder's bundled signtool could not sign with the test key; the SDK's signtool could. |
| 2026-11-02 | Day 6 Stage 3 (re-check, Smart App Control off) | Same laptop, display on and unlocked, Smart App Control **off** | Desktop smoke test against the **installed** `Kite-Setup-1.0.0-beta.2.exe` (120,630,236 bytes, fresh build), 3 runs | Screen-capture protection, installed app | **3/3 PASS**: hidden 0 of 19,234 sampled pixels, shown 19,234 of 19,234, every run. Runs 1 and 3: 14/14; run 2: 13 passed, window-icon check skipped (Windows listed no window source) | Developer decision: desktop users turn Smart App Control off for now (user guide); Microsoft Store route post-v1. |
| 2026-11-02 | Parity Phase 1 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in | Evaluation script, Haiku answers graded by Sonnet | Answer quality after the first-person format and changed rubric (ADR-0029) | `answers` 9.17, 9.07, 9.30, **mean 9.18** (accepted as the **new baseline**; next gate at least 9.03); `screenshots` 8.00; `lessons` 9.00 | Missed the old gate of 9.28 by 0.10; accepted by the developer because the format was requested and the rubric changed, so the scores are not strictly comparable. `screenshots` fell from 8.83 to 8.00, at its limit: a Day 7 evaluation check, not tuned. |
| 2026-11-02 | Parity Phase 2 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in | Evaluation script, Haiku answers graded by Sonnet | Answer quality with the format and language rules moved to the session block | `answers` 9.30, 9.23, 9.40, **mean 9.31** (gate 9.03); `preferences` 8.67 (gate 8) | Round 1, with the rules in the shared block, scored 8.97 and was reverted. The shared rules are the same as Phase 1's (9.18), so about 0.13 can be noise. |
| 2026-11-02 | Parity Phase 2 | Same laptop | `pnpm --filter web verify:setup`, real API | Job link on a real public job page; Answer preview; private addresses | Job link: company, role and a 4,406-character description found from 16,126 characters of page text. Preview written. 5 of 5 private addresses refused | One page only; other job sites may refuse automatic reading (human check 1b.3). |
| 2026-11-03 | Parity Phase 4 | Intel Core i5-8350U, Windows 11 Pro 10.0.26200 (same laptop), plugged in | Playwright: Chromium with a looped fake microphone, the real speech model, on production | Mock Interview, whole flow (`tests/e2e-prod/mock.spec.ts`) | Passed in 2.1 minutes, including the model download: questions written; words heard; feedback; the microphone reconnected for the second question; summary; saved as an ended Mock session, on the dashboard | No voice in headless Chromium, so reading aloud ended by its time limit. A real voice is human check 5c.1. |
| 2026-11-03 | Parity Phase 4 | Same laptop | Playwright, on production | Routes on Vercel (`tests/e2e-prod/routes.spec.ts`) | 6 private or local addresses refused; job link read a real public page; preview written; Ask AI answered from the call; Question Bank 4 groups, 12 questions | |
| 2026-11-03 | Parity Phase 4 | Same laptop | Production suites | Chrome and desktop | 8 of 8, and 5 of 5 | |
| 2026-11-03 | Parity Phase 4 | Same laptop | Installed `Kite-Setup-1.0.0-rc.3.exe` (120,631,528 bytes) | Desktop smoke test | 15 of 15 | Not published. Earlier data on this laptop was not re-checked by this run: human check 1b.1. |

## Day 6 Stage 1 — speech engine trial (ADR-0027)

Measure only, no product change. `pnpm --filter web stt:trial --engine=<id> [--terms=none|list|pack]`, one process per run, on the names set (42 recorded sentences, levelled to a 0.5 peak) and the two read recordings. The control is the app's real `stt.worker.ts` (sherpa-onnx WebAssembly) in Chromium, fed at real-time speed; the candidates run native through sherpa-onnx-node (Parakeet) and whisper-server (Whisper). Transcript text is never printed; the per-clip hypotheses stay in a local results file. Hardware: Intel Core i5-8350U, Windows 11 Pro 10.0.26200.

**Plugged in (2026-11-02/03).** "Name accuracy" is the share of all listed terms written exactly right; the rule compares a candidate (no session terms, unless its decoder takes them) against the control **without** session terms (name accuracy 15.3%, WER 43.3%).

| Engine | Terms | Name acc (all) | WER overall | Final p50 / p95 | RTF | Peak mem | Cold start | Extra download |
|---|---|---|---|---|---|---|---|---|
| control | none | 15.3% | 43.3% | 1 / 70 ms | 0.27 | 648 MB | 6.8 s | 0 |
| control | list | 25.9% | 40.9% | 2 / 73 ms | 0.30 | 746 MB | 4.3 s | 0 |
| control | pack | 15.3% | 43.1% | 1 / 76 ms | 0.26 | 750 MB | 7.8 s | 0 |
| **parakeet** | none | **52.9%** | **17.3%** | **830 / 1356 ms** | 0.19 | 1056 MB | 4.1 s | 506 MB |
| whisper-small | none | 42.4% | 22.8% | 9223 / 10882 ms | 1.86 | 711 MB | 1.9 s | 496 MB |
| whisper-small | list | 77.6% | 10.7% | 11844 / 15312 ms | 2.47 | 748 MB | 2.1 s | 496 MB |
| whisper-turbo | list | 65.9% | 11.4% | 53313 / 68973 ms | 11.07 | 839 MB | 2.2 s | 582 MB |

**Reading against the rule (criteria 1, 2, 4; criterion 3 needs paid Claude requests and is deferred until credit):**
- **Accuracy (criterion 1):** parakeet passes clearly — name accuracy 52.9% vs the control's 15.3% is **+37.6 pp** (rule: ≥ 15 pp), and WER 17.3% vs 43.3% is a **60% relative** drop (rule: ≥ 25%). Whisper is even more accurate but see speed. Hotwords: the published Parakeet archive has no tokenizer to encode session terms, so it runs without; Whisper takes them as an initial prompt (the `list` rows).
- **Speed (criterion 2, p50 ≤ 0.8 s and p95 ≤ 1.5 s):** parakeet's p95 (1356 ms) passes but its **p50 (830 ms) is 30 ms over** the 0.8 s bar, plugged in. Both Whisper variants are 9–53 s per utterance (RTF 1.9–11.1) — far over; unusable for a per-utterance final pass on this CPU.
- **Download (criterion 4, ≤ 700 MB):** parakeet 506 MB passes; Whisper 496–582 MB pass.

**On battery (2026-11-03, BatteryStatus discharging, 98%).** The decisive pair — the control and the only accuracy/download pass, parakeet — both without session terms. Whisper was not re-run on battery: it misses the speed bar by 10–65× plugged in, which battery can only worsen.

| Engine | Terms | Name acc (all) | WER overall | Final p50 / p95 | RTF | Peak mem |
|---|---|---|---|---|---|---|
| control | none | 15.3% | 43.3% | 4 / 173 ms | 0.58 | 688 MB |
| **parakeet** | none | **52.9%** | **17.3%** | **1195 / 1730 ms** | 0.26 | 1056 MB |

Accuracy is power-independent (identical to the plugged-in run), as expected for the same model and audio. Only speed changes: on battery parakeet's final-text **p50 is 1195 ms and p95 is 1730 ms**, so it now fails **both** of criterion 2's bounds (p50 ≤ 0.8 s, p95 ≤ 1.5 s).

**Decision (ADR-0027): adopt nothing.** No candidate meets the on-battery speed criterion. Parakeet — the only one passing accuracy (+37.6 pp name accuracy, −60% WER) and download (506 MB) — misses p50 and p95 on battery; both Whisper variants miss by 10–65×. The desktop keeps the current streaming engine; Stage 2 (integration) is skipped. Criterion 3 (answer latency during decoding) was never reached, so no paid Claude requests were spent on the trial.

## v1.0.0 release: production checks (3 Nov 2026)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200), Chrome (Playwright) and the desktop app (Electron 44.9.3).

| Date | Run | Target | Result | Notes |
|---|---|---|---|---|
| 2026-11-03 | `test:e2e-prod` (incl. latency) + `test:ui-shots` | Production `dpl_CgEEN7ZzJboS6pKatKkewnPKADFP` (merge `a85a103`) | e2e-prod **16 of 18**; ui-shots passed | **Failed:** Chrome step 6 and desktop step 3. The answer request was sent and aborted by the browser within 37 ms (`net::ERR_ABORTED`), and the card stayed on "…". Cause: `LivePage` passed a new session object to the answers on every render (the live-ui-split language picker); `useLiveAnswers` took each one for a new call and cancelled the answer in flight. Production rolled back to `dpl_F8pKo6VfbGTtSwxRuvTp2cV1Agug` the same hour. The IndexedDB schema had gone from v5 to v6; Dexie 4.4.6 opens a newer database at its installed version, and a test opening a v6 database with the v5 build's exact `db.ts` passed, so no browser needed recovery. |
| 2026-11-03 | Chrome + desktop production suites (`KITE_E2E_URL`) | Local production build (`next build` + `next start`) of the fix | **13 of 13** | Fix: the session object is memoised (above the Connect view's early return), the call lifecycle is keyed on session id and call start, and a cancelled answer with no words says so instead of "…". A preview deployment was not used: previews sit behind Vercel's SSO protection. |
| 2026-11-03 | Real answer streams, recorded through the route's pipeline | 3 eval scenarios, `claude-haiku-5-5` | `meta` → `delta` ×19–21 → `done` | The harness mock sent no `meta` event for ordinary answers; it now does. The recordings are fixtures for `tests/unit/core/answer/recorded-stream.test.ts`. |
| 2026-11-03 | v1.0.2 real answer streams in the new format (`pnpm --filter web record:streams`), through the route's pipeline, this laptop (Windows 11) direct to the API | 3 eval scenarios (01–03), `claude-haiku-5-5`, current rules with the hidden last line | `meta` → `delta` → `question` → `done` in **3 of 3**; first word **1,624 ms**, **871 ms**, **940 ms**; $0.0010 | The first request wrote the new rules cache (the rules changed), so it was slower. Not measured through Vercel. The question line comes after the words, so it cannot delay the first word. Fixtures: `tests/fixtures/answers/real-stream-v102-*.sse` (ADR-0037). |
| 2026-11-04 | v1.0.3 answer shape (`pnpm --filter web check:answer-shape`), this laptop (Windows 11), direct to the API | 3 questions: a list-type interview question and eval scenarios 03 and 01, `claude-haiku-5-5`, current rules | One answer line each (13, 12, 12–14 words by plain count), 3–4 bullets, Tip in 1 of 3, no meta opener, no CV mention; first word **895–1,143 ms**; $0.0010 (a first run at the 15-word rule gave 16 and 26 words, $0.0010) | Not an evaluation: 3 answers only (ADR-0039). |
| 2026-11-04 | v1.0.3 visual and microphone checks, dev desktop shell against the overlay rig, this laptop (Windows 11, Conexant microphone and speakers) | Real overlay window over a real Wikipedia page; real microphone with Windows speech through the speakers | See-through at 70% and 40%, solid at 100%; ⛶ 640×480 → 960×672 → back (button and Esc); 560 px fits every key hint and End; Ask Kite voice: heard and sent the spoken question; in-call message box microphone: the spoken question became the answer card's question, kept out of the transcript; no page errors | Captures in `docs/testing/v1.0.3-screenshots/` (ADR-0039). |
| 2026-11-04 | v1.0.4 on-screen checks of a simulated call (ADR-0040), dev desktop shell 1.0.4 against the rig, this laptop (Windows 11, 1920×1080 at 150%); browser view in Microsoft Edge | Real overlay and call windows over a real Wikipedia page; scripted Them and You lines; mocked `/api/answer` | **41 of 41** desktop checks; **8 of 8** browser checks, including the picture-in-picture round trip. Call window at 1280×713: page 657 px high in a 657 px viewport, message box and big buttons in view. Captures: `docs/testing/v1.0.4-screenshots/` | Every capture was looked at. Found only on screen, and fixed: the question cut to "Have you built?" in the middle of a line, the message box below the fold, "Answer this" doing nothing on a grey question. |
| 2026-11-04 | v1.0.4 production check (`tests/e2e-prod/call-window.spec.ts`), real desktop shell 1.0.4 against the deployed app, this laptop (Windows 11), test account | 2 real answers on `claude-haiku-5-5`, plus warm-ups | **7 of 7 steps**: the call starts in the overlay; a real answer on the card with its cleaned question; asking again adds no entry; ⛶ brings the call window forward and takes focus, with one card on a solid window; Back to compact; End closes the overlay | Answer line 16 words by a plain count including the "Answer:" label (one sample; the rules did not change in this release). Packaged build: smoke suite 15 of 15. |

## v1.1.0 release (4 Nov 2026)

Same laptop (Intel Core i5-8350U, 8 logical cores, Windows 11 Pro 10.0.26200), on mains power. Chrome through Playwright; desktop app on Electron 44.9.3. Production is `dpl_2Ec9KChPafWVNnrsqpM4MWrkrL1t`, built from merge `d269ad6`. Only counts and times were printed, never words or audio.

### Latency

| Date | Run | Target | Result | Notes |
|---|---|---|---|---|
| 2026-11-04 | First word, before (`tests/e2e-prod/latency.spec.ts`, 20 answers each) | Production v1.0.4; the kept 1.0.4 app | Chrome p50 **1271 ms**, p95 1455 ms. Desktop p50 **1254 ms**, p95 1617 ms | The baseline for the gate. |
| 2026-11-04 | First word, after (same test) | Production v1.1.0; the installed 1.1.0 app | Chrome p50 **1098 ms**, p95 1380 ms. Desktop p50 **1174 ms**, p95 1530 ms | The gate is the baseline plus 100 ms (1371 and 1354 ms): **passed**. All 40 answers used the prompt cache. |
| 2026-11-04 | Final line, accurate engine off (`stt:trial --engine=control`) | The app's real speech worker in Chromium at real-time speed, on the names set and the two read recordings | p50 **1 ms**, p95 **65 ms**. WER 43.3%, name accuracy 15.3%, peak 790 MB | Mains only. Same accuracy as Day 6. |
| 2026-11-04 | Final line, accurate engine on (`stt:trial --engine=parakeet`) | Parakeet through sherpa-onnx-node, same set | p50 **779 ms**, p95 **1126 ms**. WER 17.3%, name accuracy 52.9%, peak 1057 MB | Mains only. The engine alone in its own process, with no call running. |
| 2026-11-04 | Offline punctuation (`tests/integration/punctuation.spec.ts`) | The real worker, runtime and model in Chromium, one thread | Load 594 ms; one line p50 **23 ms**, p95 **47 ms**; 21.7 MB to fetch once (ADR-0044) | The gate is 100 ms: passed. |

### CPU and memory during a simulated call

`apps/desktop/tests/visual/call-load.ts`: dev shell 1.1.0, temporary profile, the rig's real call page, a test recording on a loop as the microphone. CPU is CPU seconds per second, so 100% is one whole core and 800% is this whole computer. Private memory leaves out pages that processes share; working sets count them more than once.

| Date | Run | CPU mean / peak | Private memory, start → end (peak) | Working sets, start → end (peak) | Notes |
|---|---|---|---|---|---|
| 2026-11-04 | 10 minutes, accurate engine not running (run A) | **86%** / 115% (about 11% of this computer) | 1285 → **1433 MB** (1496) | 1426 → 1691 MB (1752) | Private memory grew 148 MB. See the known gaps. |
| 2026-11-04 | 10 minutes, accurate engine not running (run B) | 86% / 107% | 1360 → 1335 MB (1523) | 1512 → 1585 MB (1779) | This run asked for the accurate engine, but the scratch model folder had no checked markers, so the app reported it as not downloaded and the engine never ran. Kept as a second reading with the engine not running. |
| 2026-11-04 | 2 minutes, accurate engine not running | 191% / 196% | 1457 → 1567 MB (1569) | 1694 → 1809 MB (1809) | Far above the 10-minute mean, and not explained. See the known gaps. |
| 2026-11-04 | 2-minute check, accurate engine running | 282% / 340% | 2148 → 2589 MB (2589) | 2365 → 2708 MB (2708) | **A check, not a load measurement.** Model ready; engine process seen, peak 1217 MB; 15 lines sent, **15 changed**, 0 skipped; median **3738 ms** a line. Non-stop speech. |

### Installer, compatibility and production

| Date | Run | Target | Result | Notes |
|---|---|---|---|---|
| 2026-11-04 | Install over 1.0.4 (`Kite-Setup-1.1.0.exe /S`) | This laptop | Exit 0, version 1.1.0.0 | 126,296,433 bytes. The three JS files in the installed app are byte-identical to a build of the release source, and `latest.yml`'s hash and size match the installer. |
| 2026-11-04 | Installed smoke test (`apps/desktop/tests/smoke.spec.ts`, `KITE_INSTALLED_EXE`) | Installed 1.1.0, temporary profile | **19 of 19** | Private on the panel, main, overlay and side windows: none of the window's test colour in a real screen capture with it on, all of it with it off. The image is never kept. |
| 2026-11-04 | Auto-update, local feed (`apps/desktop/tests/update-check.ts`) | A kept 1.0.4 and a temporary profile | Found 1.1.0, downloaded it and verified it | Stops before installing. |
| 2026-11-04 | Auto-update, real feed (`apps/desktop/tests/update-check.ts`, no folder) | A kept 1.0.4, a temporary profile and a cache folder of its own holding 1.0.4's real installer, as on a teammate's laptop, against the published `Zainpak123/kite-releases` v1.1.0 | Found 1.1.0, fetched it and verified it, in 8 s | Stops before installing, so the update's own install step did not run; the silent install over 1.0.4 is the row above. A first run used the real update cache, which already held the 1.1.0 installer from this laptop's install, so it proved little and left a download there. That download was removed and the tool now keeps its own cache. The installer served by the release has the SHA-256 of the one tested here. |
| 2026-11-04 | Database upgrade (`tests/integration/db-upgrade.spec.ts`) | The real v1.0.4 code from git, then v1.1.0 | Schema 7 → 8; sessions, lessons, libraries and Ask Kite chats all survive | |
| 2026-11-04 | Older shell (`apps/desktop/tests/manual/old-shell.spec.ts`) | The kept 1.0.4 app against the new web app | Passed | |
| 2026-11-04 | Local production build (`KITE_E2E_URL`) | `next build` + `next start` | Chrome 8 of 8, desktop 4 of 4, UI and keyboard 5 of 5 | |
| 2026-11-04 | Production suites (`test:e2e-prod`) | `dpl_2Ec9KChPafWVNnrsqpM4MWrkrL1t` | Chrome and desktop **12 of 12**, offline punctuation included | Admin test account disabled afterwards, and confirmed after publishing: a sign-in attempt on production gets 403 `BANNED_USER` and no session. |

### Not measured in this release

The developer chose to skip these on 4 Nov 2026. The numbers above do not cover them.

- **Final-line latency on battery, with either engine.** The only battery readings are Day 6's, on older code (3 Nov): 4 / 173 ms off and 1195 / 1730 ms on.
- **A 10-minute call with the accurate engine on.** CPU and memory with the engine running through a whole call are unknown. The 2-minute check shows only that it starts and refines lines.

### Known gaps, for v1.1.1

- **Memory growth with the accurate engine off:** about 150 MB in 10 minutes (run A). Run B ended flat, so two readings do not show whether this is a steady leak. Measure a longer call, process by process.
- **How long an accurate pass takes in a call:** a median of 3.7 s in the 2-minute check, against 779 ms for the engine alone. The audio differs and the speech was non-stop, so these are not directly comparable, but it needs measuring on a real call.
- **CPU early in a call:** 191% in one 2-minute run, against a mean of 86% over 10 minutes. `call-load.ts` now prints each minute, so the next run can show whether the start of a call costs more.
- **`cv-embellishment` is below its gate:** 6.75 at 2 runs and 6.58 at 6 runs, against 7.10 and the absolute target. No regression against the 6.72 average of 3 Nov; released by the developer's decision (`docs/testing/answer-eval.md`).
- **Raw answer lines:** 36% are within 12 words as the model writes them. The card's cut brings it to 98% as shown, which is the gate (ADR-0043).
- **Visual:** `browser-split-1.png` and `browser-split-2.png` were never compared (`docs/testing/v1.1.0-visual-check.md`). The browser view's off-centre language picker was fixed by the later browser call layout change.
- **macOS was not run** (`docs/testing/macos-checklist.md`).
- **Two manual tools still target v1.0.4's UI:** `apps/desktop/tests/visual/call-window-shots.ts` and `apps/web/tests/visual/browser-shots.ts`.

## v1.2.0 release (5 Nov 2026)

Deployment `dpl_FYmPL16gQcjTQ24pQGYoU6rVmBCr`, Vercel function `iad1`. Machine: the same laptop as v1.1.0 (Intel Core i5-8350U, Windows 11 Pro 10.0.26200). Browser: Playwright's Chromium, headless. Desktop: the shell built from this branch, on a temporary profile.

### Production suites

| Suite | Result | Notes |
|---|---|---|
| Sign-in cache, routes | 5 of 5 | First run. |
| Chrome and desktop | 12 of 12 | Second run. The first stopped at step 2: the suite looked for the company in the card's heading, and a Regular session's heading is now its topic. |
| Mock interview | 1 of 1 | Third attempt. The suite was updated for Review's Answers tab and the session type tabs. It also counted question bubbles exactly, but a written question with a sentence after it shows as two bubbles, so the exact count is now on saved answers. |
| Latency | 2 of 2 | Admin test account enabled for this run only and disabled straight after. A sign-in attempt on production then got 403 `BANNED_USER` and no session. |

### Latency (20 answers each, ms)

| Client | First word p50 / p95 | Headline p50 / p95 | Done p50 / p95 | Server first text p50 / p95 | Cache hits |
|---|---|---|---|---|---|
| Chrome | 1120 / 1327 | 1125 / 1372 | 1370 / 1619 | 586 / 785 | 20 of 20 |
| Desktop app | 1096 / 1278 | 1126 / 1402 | 1311 / 1455 | 586 / 721 | 20 of 20 |

### Evaluations, v1.2.0

1.2.0 shipped with two evaluation groups only: preferences (8.88) and ask-kite (9.75), 40 requests, $0.0747. The developer chose to skip the full suite: this was a UI release, the live-call prompts were left alone, and those two groups cover the prompts it did touch. The hidden-line fix made afterwards changes how the reply's first line is read, not the prompt, and was checked by unit tests and the answers and Ask AI harnesses, not on a new real reply. `eval:answers` was also started by accident at release and stopped after a few minutes; it saved no results, so none are recorded here.

### Installer and update, v1.2.0

| Check | Setup | Result | Notes |
|---|---|---|---|
| Installer (`dist:win`) | Built from `56df9a0` | `Paramount-AI-Setup-1.2.0.exe`, 126,299,008 bytes | Packaged shell holds four files of its own. |
| Smoke test on the built program (`KITE_INSTALLED_EXE`) | `win-unpacked`, temporary profile | **19 of 19** | Not installed on this machine. |
| Auto-update, real feed (`apps/desktop/tests/update-check.ts`, no folder) | The real 1.1.0 program, a temporary profile and a cache folder of its own holding 1.1.0's installer | Found 1.2.0, downloaded it and verified it | Stops before installing. |

The Windows install step and the data folder staying in place were left to the developer's manual install on their laptop, done before publishing.

## Custom domain (5 Nov 2026)

`call.paramountintelligence.co` went live beside `kite-call-assistant.vercel.app` (ADR-0046). Machine: the same laptop as v1.1.0. Browser: Playwright's Chromium, headless.

| Check | Deployment | Result | Notes |
|---|---|---|---|
| Vercel's view of the domain | Project | Verified, `misconfigured: false` (CNAME); no redirect on either address | Let's Encrypt certificate on the new domain. |
| Sign-in form, local run with production's settings | `next dev` | Unknown site 403; both addresses accepted | Previews sit behind Vercel's login, so this ran locally. |
| Sign-in form on live production before the change | `dpl_FYmPL16gQcjTQ24pQGYoU6rVmBCr` | New domain 403 | Shows the setting was needed. |
| A call in Chrome on the new address (`chrome.spec.ts`) | `dpl_4HQpJGp6Lfvk9YgH4z7FFzrziEEs` | 8 of 8 | |
| Ask AI on the new address (`routes.spec.ts`) | `dpl_4HQpJGp6Lfvk9YgH4z7FFzrziEEs` | 1 of 1 | |
| Built 1.2.0 program on the old address, with its own built-in address (`desktop.spec.ts`) | `dpl_4HQpJGp6Lfvk9YgH4z7FFzrziEEs` | 4 of 4 | Temporary profile, update check off. |
| Admin page on the new address (`domain.spec.ts`) | `dpl_4HQpJGp6Lfvk9YgH4z7FFzrziEEs` | 1 of 1 | Admin test account on for this run only. Afterwards a sign-in attempt on both addresses got 403 `BANNED_USER` and no session. |
| Both addresses: no redirect, sign-in, cookie on that address only, guide, log out, other sites refused (`domain.spec.ts`) | `dpl_8ViAdqLzrGD9jYHoSCTbQ7evizxb` | 6 of 6 | This deployment adds only the guide's text to the one above. |

Not run: the latency suite, and a 1.1.0 program on the old address. The real 1.1.0 program would look for updates against the live feed and could install one when it closes, so it was left out. It loads the same address as 1.2.0.

## Account sync, Phase 3 (8 Nov 2026, ADR-0049)

Latency before and after the account-sync client (approved paid run: 20 answers each on `claude-haiku-5-5`, about $0.005 per run). Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200, Pakistan), plugged in; production; Playwright 1.64.1 Chromium; `/dev/latency` as the admin test account (`latency.spec.ts -g Chrome`), enabled for the run and disabled straight after.

| Run | Production | First word p50 / p95 | Headline p50 / p95 | Done p50 / p95 | Server first text p50 / p95 | Cache hits |
|---|---|---|---|---|---|---|
| Before (Phase 2 deployed, no client sync) | 8 Nov 2026 | 1,145 / 1,344 ms | 1,145 / 1,344 ms | 1,369 / 1,496 ms | 603 / 825 ms | 20 of 20 |
| After (Phase 3 deployed) | 8 Nov 2026 | 1,150 / 1,332 ms | 1,150 / 1,332 ms | 1,371 / 1,565 ms | 607 / 844 ms | 20 of 20 |

No change beyond run-to-run noise. The admin test account is not in `KITE_SYNC_USERS`, so this compares the answer path with the new sync hold in place (`answerClient.ts`) but no sync traffic; the answer route never touches the database, and pushes wait while an answer streams.

Production sync checks after the Phase 3 deploy, test account only: `sync-api.spec.ts` 5 of 5 (switch on, encrypted round trip, pull, conflict and Save-transcript-off refusal, session delete cascade) and `sync-devices.spec.ts` 3 of 3 (two Chrome profiles and the desktop shell built from this checkout, the same shell code as 1.2.0, temporary profile: create → appears on the others; delete while offline → waits → reaches the others once back online).

## Account sync Phases 4–6 and desktop 1.3.0 draft (8 Nov 2026, ADR-0049 to ADR-0052)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200); production; Playwright 1.64.1 (Chromium, and Electron from this checkout with temporary profiles); test account only (the admin test account for the unflagged check, enabled for that run and disabled after). No Claude request.

| Check | Result | Notes |
|---|---|---|
| `legacy-upload.spec.ts`, both web addresses | 2 of 2 | The first run found the dashboard showed uploaded sessions only after a reload (PR #21 fixed it); asked, added, shown without a reload, not asked again. |
| `launcher.spec.ts` (this checkout's shell) | 3 of 3 | Ready list, last call, no search or create; links checked by address with `window.open` replaced in the panel; Start shows the start card. |
| `desktop-link.spec.ts` (1.3.0 shell from this checkout) | 2 of 2 | A code signs a fresh browser in once; reuse, another session and a 61 s wait refused; a link with a code opens the start card signed in, and the code is not in the page address. |
| `sync-devices.spec.ts`, `sync-api.spec.ts` with 1.3.0 | 4 of 4, 5 of 5 | As after Phase 3. |
| `unflagged.spec.ts` (admin test account, not in `KITE_SYNC_USERS`) | 1 of 1 | Sync status off, sync routes and link codes 404, no upload question, no account-data help, "Delete all local data" unchanged. |
| Upgrade 1.2.0 → 1.3.0 (`upgrade.spec.ts`, `KITE_OLD_VERSION=1.2.0 KITE_NEW_VERSION=1.3.0`) | 1 of 1 | The released 1.2.0 program extracted from its installer (never run as an installer here), then `release/win-unpacked` 1.3.0, one temporary profile: sessions, settings, sign-in and the protection setting kept. |
| `Paramount-AI-Setup-1.3.0.exe` | 126,298,807 bytes | Uploaded as a draft to `Zainpak123/kite-releases` with its blockmap, `latest.yml` and `SHA256SUMS.txt`; not published. The Windows install step itself and a real link from Chrome to the installed app are on the developer's regression checklist. |

## Desktop flow matches the reference, desktop 1.3.0 draft rebuilt (9 Nov 2026, ADR-0055)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200, 150% scaling); Playwright 1.64.1; Electron 44.9.3 from this checkout or the released 1.2.0 program extracted from its installer, always on temporary profiles; production for the `e2e-prod` checks, test account only. No Claude requests.

| Check | Result | Notes |
|---|---|---|
| `click-through.spec.ts` (real shell, overlay rig, real Windows input) | 1 of 1 (4 of 5 runs before the fix to the test's pointer moves; then 3 of 3) | A click in a transparent gap reached the test's own window behind, and typing went there; a click on bar 1's Transcript pill switched it and did not reach the window behind. The one failure was the first run after a cold rebuild: a single short burst of moves; the test now moves onto the gap twice. `SetCursorPos` alone is not forwarded to a click-through window; `mouse_event` moves are. |
| `protection-chrome.spec.ts` (Chrome 156.0.8078.81, entire-screen share) | 2 of 2 | The protected compact window: 0 of 75,816 sampled pixels in the share; unprotected: 75,816. A plain window created after Private was turned on (nothing protecting it by hand): 0 of 75,816; with its protection off: 75,816. |
| Desktop smoke test (`pnpm --filter @kite/desktop test`) | 19 of 19 (1 skipped, the icon, as before) | Knows the three new 1.3.0 bridge methods. |
| `launcher.spec.ts`, this checkout's 1.3.0 shell | 3 of 3 | After the fix in PR #27: the panel's sign-in lands on /home. Your sessions (both sessions, Ended shown), Call ended, no search or create, links by address, Start card (Team, Buy credits only a toast), Connect card (3 tips), Back. |
| `launcher.spec.ts`, the released **1.2.0** program (`KITE_SHELL_EXE`) | 3 of 3 | The same checks in the old shell, at its 400 px panel. |
| `desktop-link.spec.ts` (1.3.0 shell) | 2 of 2 | The link's session first, "From your browser"; its Start card says Signed in as. |
| `unflagged.spec.ts` | not run to the end | The admin test account is **disabled** ("This account is disabled"), so sign-in failed; not changed here. |
| Upgrade 1.2.0 → 1.3.0 (`upgrade.spec.ts`) | 1 of 1 | The released 1.2.0 program, then this build's `release/win-unpacked`, on one temporary profile. |
| Harness suites | launcher 4 of 4, live UI 24 of 24, sim-calls chat bar 1 of 1, shell 6 of 6 | Light and dark captures for the visual pairs (git-ignored `docs/testing/v1.2-visual/`). |
| `Paramount-AI-Setup-1.3.0.exe` | 126,444,439 bytes | Replaced the draft's installer, blockmap, `latest.yml` and `SHA256SUMS.txt` on `Zainpak123/kite-releases`; still a draft, not published. The Windows install step itself is not run on this computer. |

## Release 1.3.0 go live (9 Nov 2026, ADR-0049 to ADR-0057)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200, 150% scaling); Playwright 1.64.1; Electron 44.9.3 from this checkout or the released 1.2.0 program extracted from its installer, always on temporary profiles; the end-to-end test account only (the admin test account only for `unflagged.spec.ts`, enabled for that run and disabled again).

| Check | Result | Notes |
|---|---|---|
| Lint, typecheck, unit tests | web 1,597 of 1,597; desktop 185 of 185 | Six positions (taskbar on each side, two monitors at any offset, 125/150/175 % work areas), hotkeys, Settings rows, the login form as the server renders it. |
| Harness suites (`tests/integration`, all) | 159 of 159 | Then shell, screens, launcher, handoff, setup, ui-kit and live again in light and dark with screenshots for the visual pairs (phone width 390 found the dashboard search 14 px too wide; fixed). |
| Desktop smoke test | 20 of 20 | The six positions in the real shell: 16 DIPs from the real work area (±1), the bottom row growing upward, the overlay page told of each change. |
| `click-through.spec.ts`, `protection-chrome.spec.ts` | 1 of 1, 2 of 2 | Real Windows input; Chrome's entire-screen share. |
| Upgrade 1.2.0 → 1.3.0 | 1 of 1 | |
| `launcher.spec.ts` with this 1.3.0 shell / the released 1.2.0 program, against the new web app | 3 of 3 / 3 of 3 | The 1.3.0 run failed once on its first sign-in just after a deploy (see below), then passed. |
| `desktop-link.spec.ts`, `sync-api.spec.ts`, `sync-devices.spec.ts` | 2 of 2, 5 of 5, 3 of 3 | `sync-devices` first hung on Create session's Key terms, now under Advanced; the helper opens it. |
| `unflagged.spec.ts` (before the switch went to everyone) | 1 of 1 | Admin test account enabled for the run, disabled again. |
| Sign-in before hydration | fixed (PR #32) | The production desktop check's first sign-in after two deploys failed with an empty form: a press before React took over submitted the form natively as a GET with the email and password in the address. The form now posts and Sign in is disabled until hydrated. The user test account's password was rotated afterwards. |
| `Paramount-AI-Setup-1.3.0.exe` | 126,301,027 bytes | Published as Latest on `Zainpak123/kite-releases`; the public `latest.yml` says 1.3.0. |
| Real-feed update check (`update-check.ts`, kept 1.2.0 copy) | PASS | 1.2.0 found, downloaded and verified 1.3.0 from the real releases repository, into its own cache (removed after). |
| `KITE_SYNC_USERS=*` (Production) | set, redeployed | The value is a sensitive variable and cannot be read back; it was set by piping exactly `*`. |
| `desktop.spec.ts` (paid, rewritten for the 1.3.0 flow) | 4 of 4 tests, 12 of 12 steps | Speech model downloaded on the fresh profile; connected in 60 s; transcript lines; a real answer (answer line 11 words), rated; asking again added no entry; Private on 3 of 3 windows; Position grid to the bottom row and back; Exit closed the overlay, the panel showed Call ended and the call window closed itself. Two answers on the fast model, about $0.01 (estimated; the run prints no token counts). An earlier attempt stopped before any answer (the test did not wait for the speech-model dialog). |

## Call quality, Phase 1 (9 Nov 2026, ADR-0062)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200), plugged in. Only numbers were printed, never words.

| Run | Result | Notes |
|---|---|---|
| Re-score of the Day 6 trial result files (42 names clips + 2 read clips, 457 words), by error type | Live engine: WER 43.3% = 34.4% wrong words + 4.2% missed + 4.8% extra; median clip 50%; 29 of 42 clips over 30%. Parakeet: 17.3% = 14.2% + 1.3% + 1.8%; median clip 14%; 10 of 42 over 30% | The live engine's errors are mostly wrong words (the model), not words cut at the ends of a line. |
| Loopback track settings, Electron 44.9.3 (`track.getSettings()`) | `getDisplayMedia({ audio: true })`: echoCancellation, noiseSuppression, autoGainControl all **true**. With the three set to false: all **false**; the microphone keeps all three true | The desktop app now asks for them off (`DESKTOP_DISPLAY_OPTIONS`). |
| Confidence calibration (the real `stt.worker.ts` in Chromium; 30 synthetic English lines from two Windows voices, 41 lines of the names set, 30 lines of romanised Urdu read by the same two voices) | Mean token log probability: synthetic English p50 −0.32 (min −0.44); names set p50 −0.72, p5 −1.13 (min −1.17); Urdu stand-in p50 −0.93 (max −0.76). Share of unsure pieces (< −1): 0.00 / 0.26 / 0.45 at p50 | Confidence alone cannot tell accented English from the stand-in. With "five words or more, mean < −0.75, over 30% unsure pieces, under 25% everyday English words": **0 of 30** synthetic English, **1 of 41** names-set lines and **21 of 30** stand-in lines marked as another language. |
| Checks | Unit 1,682 + desktop 200; integration 161 of 161 (including the simulated call (e) for each new rule) | |

## Call quality, synthetic calls (9 Nov 2026, ADR-0063)

Same laptop (Intel Core i5-8350U, Windows 11 Pro 10.0.26200), plugged in. `pnpm --filter web stt:calls`: the synthetic call of ADR-0063 (195 s, two Windows voices) through the real speech worker in Chromium at real time, then the transcript and auto-answer code on a simulated clock. **baseline** = main at 32e5e74 (before ADR-0062), measured with its own worker and rules; **after-p1** = ADR-0062 as deployed; **after-p2** = with the fixes the harness found (ADR-0063 "Fixes found by the harness"). Numbers only; no Claude request. The voices are much easier to recognise than real speech: word error rates here are not a real call's.

**headphones**

| Metric | baseline | after-p1 | after-p2 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 18.5% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 0.0 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 5/7 | 7/7 |
| Questions answered whole | 1/7 | 5/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 5 | 7 |
| Question end → answer sent p50 / p95 | 1506 / 1506 ms | 1819 / 1984 ms | 1810 / 1975 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**speakers**

| Metric | baseline | after-p1 | after-p2 |
|---|---|---|---|
| Words on the right channel (all) | 90.8% | 91.4% | 91.1% |
|   You / Them | 83.2% / 98.8% | 84.2% / 100.0% | 84.2% / 100.0% |
| Lines from the other side (You / Them) | 4 / 0 | 3 / 0 | 3 / 0 |
| WER as shown (You / Them) | 75.3% / 19.2% | 49.4% / 15.3% | 49.4% / 20.3% |
| One-word noise lines per 10 min | 3.1 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 2/7 | 6/7 | 5/7 |
| Questions answered whole | 2/7 | 6/7 | 5/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 3 | 6 | 5 |
| Question end → answer sent p50 / p95 | 1564 / 1768 ms | 1577 / 1964 ms | 1587 / 1974 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**reverse-echo**

| Metric | baseline | after-p1 | after-p2 |
|---|---|---|---|
| Words on the right channel (all) | 90.3% | 97.4% | 97.9% |
|   You / Them | 100.0% / 83.9% | 100.0% / 95.4% | 100.0% / 96.0% |
| Lines from the other side (You / Them) | 0 / 4 | 0 / 1 | 0 / 0 |
| WER as shown (You / Them) | 30.3% / 52.0% | 27.5% / 37.9% | 7.3% / 36.7% |
| One-word noise lines per 10 min | 9.2 | 9.2 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 5/7 | 7/7 |
| Questions answered whole | 1/7 | 5/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 1 | 1 |
| Cards in all | 2 | 6 | 8 |
| Question end → answer sent p50 / p95 | 1514 / 1514 ms | 1678 / 16302 ms | 1698 / 1879 ms |
| Other-language lines marked | 0/2 | 1/2 | 1/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**noisy**

| Metric | baseline | after-p1 | after-p2 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 19.1% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 3.1 | 3.1 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 6/7 | 7/7 |
| Questions answered whole | 1/7 | 6/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 6 | 7 |
| Question end → answer sent p50 / p95 | 1530 / 1530 ms | 1590 / 1966 ms | 1572 / 1948 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

## Call quality, Phase 3: the coupling gate (9 Nov 2026, ADR-0064)

Same laptop and harness as the section above. **after-p3** = with the coupling gate in the speech worker and the two blip rules (ADR-0064), measured with its own worker; baseline and after-p2 as above.

**headphones**

| Metric | baseline | after-p2 | after-p3 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 18.5% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 0.0 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 7 | 7 |
| Question end → answer sent p50 / p95 | 1506 / 1506 ms | 1810 / 1975 ms | 1588 / 1964 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**speakers**

| Metric | baseline | after-p2 | after-p3 |
|---|---|---|---|
| Words on the right channel (all) | 90.8% | 91.1% | 100.0% |
|   You / Them | 83.2% / 98.8% | 84.2% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 4 / 0 | 3 / 0 | 0 / 0 |
| WER as shown (You / Them) | 75.3% / 19.2% | 49.4% / 20.3% | 5.1% / 5.1% |
| One-word noise lines per 10 min | 3.1 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 2/7 | 5/7 | 7/7 |
| Questions answered whole | 2/7 | 5/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 3 | 5 | 7 |
| Question end → answer sent p50 / p95 | 1564 / 1768 ms | 1587 / 1974 ms | 1627 / 2014 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**reverse-echo**

| Metric | baseline | after-p2 | after-p3 |
|---|---|---|---|
| Words on the right channel (all) | 90.3% | 97.9% | 98.0% |
|   You / Them | 100.0% / 83.9% | 100.0% / 96.0% | 100.0% / 96.0% |
| Lines from the other side (You / Them) | 0 / 4 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 30.3% / 52.0% | 7.3% / 36.7% | 5.6% / 36.7% |
| One-word noise lines per 10 min | 9.2 | 3.1 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 1 | 1 |
| Cards in all | 2 | 8 | 8 |
| Question end → answer sent p50 / p95 | 1514 / 1514 ms | 1698 / 1879 ms | 1710 / 1891 ms |
| Other-language lines marked | 0/2 | 1/2 | 1/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**noisy**

| Metric | baseline | after-p2 | after-p3 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 19.1% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 3.1 | 3.1 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 7 | 7 |
| Question end → answer sent p50 / p95 | 1530 / 1530 ms | 1572 / 1948 ms | 1592 / 1968 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

## Call quality, Phase 4: the end-of-turn model (10 Nov 2026, ADR-0065)

Same laptop and harness. **after-p4** = Smart Turn v3.2 judging "Them" lines that look cut off, used only to shorten the 3 s wait. The four after-p4 runs were made in the evening, when the laptop was busier: lines reached the page about 0.2–0.5 s later than in the afternoon runs for every version (the Phase 3 code re-run at the same time on headphones: line lag p50 1,318 ms, answer sent p50 1,915 ms, against 1,297 and 1,845 ms for Phase 4), so the answer delays below are not comparable with the earlier columns; the same-time pair is.

| Measurement | Result |
|---|---|
| The model with Kite's features (Chromium, 30 synthetic sentences) | complete sentences median 0.96 (83% ≥ 0.5); cut at 55% median 0.08 (67% < 0.5) |
| One judgment (one WebAssembly thread, features + model) | about 0.3–0.5 s; asked at a 300 ms pause, ready when the line is final (p50 0 ms after it) |
| Judged at every pause | the speech worker fell up to 3.9 s behind on the reverse-echo call: judgments limited to lines that look cut off (1 per call here) |
| On the synthetic calls, following the model both ways | right on "…and" (0.01) and 6 of 7 question ends; 0.02 on one finished question and 0.01 on one complete clause; +0.35 s median delay, no gain in whole questions: used only to shorten |
| Same time, headphones: Phase 3 code vs Phase 4 | whole 7/7 vs 7/7; answer sent p50 1,915 vs 1,845 ms |

**headphones**

| Metric | baseline | after-p3 | after-p4 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 18.5% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 0.0 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 7 | 7 |
| Question end → answer sent p50 / p95 | 1506 / 1506 ms | 1588 / 1964 ms | 1845 / 2276 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**speakers**

| Metric | baseline | after-p3 | after-p4 |
|---|---|---|---|
| Words on the right channel (all) | 90.8% | 100.0% | 100.0% |
|   You / Them | 83.2% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 4 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 75.3% / 19.2% | 5.1% / 5.1% | 5.1% / 5.1% |
| One-word noise lines per 10 min | 3.1 | 0.0 | 0.0 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 2/7 | 7/7 | 7/7 |
| Questions answered whole | 2/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 3 | 7 | 7 |
| Question end → answer sent p50 / p95 | 1564 / 1768 ms | 1627 / 2014 ms | 2074 / 2313 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**reverse-echo**

| Metric | baseline | after-p3 | after-p4 |
|---|---|---|---|
| Words on the right channel (all) | 90.3% | 98.0% | 98.0% |
|   You / Them | 100.0% / 83.9% | 100.0% / 96.0% | 100.0% / 96.0% |
| Lines from the other side (You / Them) | 0 / 4 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 30.3% / 52.0% | 5.6% / 36.7% | 5.6% / 36.7% |
| One-word noise lines per 10 min | 9.2 | 3.1 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 0/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 1 | 1 |
| Cards in all | 2 | 8 | 8 |
| Question end → answer sent p50 / p95 | 1514 / 1514 ms | 1710 / 1891 ms | 1984 / 4512 ms |
| Other-language lines marked | 0/2 | 1/2 | 1/2 |
| English lines wrongly marked | 0 | 0 | 0 |

**noisy**

| Metric | baseline | after-p3 | after-p4 |
|---|---|---|---|
| Words on the right channel (all) | 99.4% | 100.0% | 100.0% |
|   You / Them | 100.0% / 98.8% | 100.0% / 100.0% | 100.0% / 100.0% |
| Lines from the other side (You / Them) | 0 / 0 | 0 / 0 | 0 / 0 |
| WER as shown (You / Them) | 19.1% / 19.2% | 7.3% / 5.1% | 7.3% / 5.1% |
| One-word noise lines per 10 min | 3.1 | 3.1 | 3.1 |
| Multi-line questions split (lines) | 3/3 | 2/3 | 2/3 |
| Multi-line questions split (turns) | 1/3 | 0/3 | 0/3 |
| Questions answered | 1/7 | 7/7 | 7/7 |
| Questions answered whole | 1/7 | 7/7 | 7/7 |
| Duplicate cards | 0 | 0 | 0 |
| Cards for non-questions | 1 | 0 | 0 |
| Cards in all | 2 | 7 | 7 |
| Question end → answer sent p50 / p95 | 1530 / 1530 ms | 1592 / 1968 ms | 1902 / 2453 ms |
| Other-language lines marked | 0/2 | 2/2 | 2/2 |
| English lines wrongly marked | 0 | 0 | 0 |

## Call quality, Phase 5a: Accurate on "Them" (10 Nov 2026, ADR-0066)

i5-8350U laptop, synthetic headphones call (`stt:calls --accurate=<threads>`): the desktop app's own Parakeet worker in a Node process, alongside the live engine in Chromium, in real time.

| | No Accurate | 4 threads (2 runs) | 2 threads (chosen) |
|---|---|---|---|
| WER as shown, You / Them | 7.3% / 5.1% | 0.6% / 4.0% | 0.6% / 4.0% |
| Questions answered whole, duplicates | 7/7, 0 | 7/7, 0 | 7/7, 0 |
| Question end → answer sent p50 / p95 | 2,182 / 2,569 ms | 3,132 / 4,371 and 2,712 / 3,281 ms | 3,273 / 3,438 ms |
| One "Them" line: decode p50 / p95 | — | 1,034 / 2,376 and 971 / 1,955 ms | 1,684 / 3,126 ms |
| Engine CPU during the call | — | 0.62 and 0.54 core | 0.40 core |
| 14 "You" lines after the call | — | 27.4 and 26.6 s | 33.5 s |
| Model load | — | 6–8 s | 12.5 s |

## Larger documents: 480k characters per session (10 Nov 2026, ADR-0067)

i5-8350U laptop, Node (no browser), `pnpm --filter web measure:large-docs`: the real server code against the Claude API, from the developer's connection. Invented test set of 480,000 characters (a CV of 1,952 characters and three documents of 200,000, 150,000 and 128,048) = **164,384 tokens** in the cached prefix (rules + session block). Prices from the official pricing page (Haiku 5.5 over 100,000 tokens: input $0.50, cache write $0.625, cache read $0.05, output $2.50 per MTok; Sonnet 5.5: $2 / $2.50 / $0.10 / $10). One run, so the times vary with the network and Claude's load.

| Request | Model | Input / cache write / cache read / output tokens | First text | Total | Cost |
|---|---|---|---|---|---|
| Answer 1, no warm-up (writes the cache) | Haiku 5.5 | 327 / 164,384 / 0 / 133 | 2,902 ms | 3,429 ms | $0.1032 |
| Answer 2 (reads it) | Haiku 5.5 | 324 / 209 / 164,384 / 111 | 1,371 ms | 1,833 ms | $0.0088 |
| Answer 3 (reads it) | Haiku 5.5 | 311 / 175 / 164,593 / 80 | 1,060 ms | 1,345 ms | $0.0087 |
| Documents summary (3 documents, 478,048 characters → 2,685 characters) | Haiku 5.5 | 159,346 / 517 / 0 / 949 | — | 7,291 ms | $0.0824 |
| Notes now (CV + summary + 3-answer call) | Sonnet 5.5 | 766 / 3,350 / 0 / 316 | — | 3,812 ms | $0.0131 |
| Notes before (every document; counted with the token-count endpoint, not run) | Sonnet 5.5 | about 161,669 input | — | — | about $0.41 |

- Answers 2 and 3 read the whole cached prefix (164,384 tokens): **cache hits confirmed** after the first answer.
- **Estimated 20-answer call:** 1 write + 19 reads = **$0.27**; each idle re-warm (4.5 min with no answer) adds about $0.008. For comparison, the old 150,000-character cap is about 51k tokens (under the 100k price line): about $0.02 for the same call.
- In the app the warm-up at session open writes the cache, so the first answer normally reads it (about 1.1–1.4 s to the first word here); 2.9 s is the case with no warm-up.
