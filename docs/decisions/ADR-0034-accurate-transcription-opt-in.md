# ADR-0034: Accurate transcription as an opt-in second pass (Parakeet)

- **Status:** Accepted (developer, 3 Nov 2026, v1.0.1)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §6.1 (speech-to-text), §7.3 (desktop shell)
- **Supersedes / superseded by:** amends ADR-0027 (which adopted nothing); ADR-0027's measurements stand

## Context

ADR-0027 trialled engines for a desktop-only second pass and set four criteria that all had to pass for an engine to become part of every call. NVIDIA Parakeet TDT 0.6B v2 (int8, through sherpa-onnx) was the clear winner on accuracy — **+37.6 percentage points name accuracy and −60 % word error rate** against the live engine with session terms — and passed the download limit (506 MB as published; 661 MB as the four files Kite downloads), but **missed the battery speed bar**: final-text **p50 1,195 ms and p95 1,730 ms** on battery against bars of 0.8 s and 1.5 s (p50 830 ms even plugged in). By ADR-0027's rule, nothing was adopted.

A real test call then showed names and technical terms going wrong in the live transcript. The developer asked for Parakeet as an option the user can turn on, accepting its speed.

## Decision

- **Settings → Transcription → "Accurate transcription (beta)", off by default**, desktop app only (the browser keeps the standard engine; the setting explains why).
- **A second pass, not a replacement.** The live engine still writes every line as it does today, at the same speed. When a line is final and the setting is on, the speech worker hands that utterance's audio (at most 30 s) to the desktop app, which transcribes it again with Parakeet and replaces the line's words about a second later. When the engine is not downloaded, refuses the audio, fails, crashes or takes more than 15 s, **the live line stays** — the current engine is the fallback.
- **Why the speed miss is acceptable here:** ADR-0027's speed bar was for an engine every call depends on. As an opt-in second pass, a slower result delays only the improvement, never the line or an answer; the user chooses the trade-off, and the setting says it is slower on battery.
- **Engine:** sherpa-onnx-node **1.13.8** (the measured version; the newest release at least two weeks old; platform builds pinned by `pnpm-workspace.yaml` overrides), shipped inside the installer (≈ 23 MB, Windows x64 and macOS arm64), run in an Electron **utility process** with 4 threads (as measured), loaded on first use.
- **Model:** downloaded only when the user turns the setting on, to the app's data folder: four files from one fixed Hugging Face revision (`1ab93235…`), each checked against its **SHA-256** (Hugging Face's LFS hashes, which match the trial's files) before use; **resumable** with HTTP Range requests; a file that fails its check is deleted. Settings shows progress, a retry and "Delete the download".
- **Privacy:** audio crosses only from the page to the shell on the same computer, in memory; nothing is stored or logged except sizes, times and success.

## Consequences

- Installer about 23 MB larger for everyone; the 661 MB model only for users who turn the setting on.
- More processor time during calls when on (the live engine and Parakeet both run).
- Hotwords are not used by the second pass (the published archive has no tokenizer to encode them), as in the trial; it still beat the live engine with terms.
- Not measured inside the real app on a real call (v1.0.1 was a lean release with no paid or manual checks). The native path was checked locally: the bundled worker, in a real Electron utility process, loaded the model in 4.1 s and transcribed a 7.4 s utterance in 1.09 s.

## Alternatives considered

- **Make Parakeet the default engine:** rejected by ADR-0027's speed rule; not reopened.
- **Download the native runtime with the model:** rejected; downloading executable code at run time is a larger risk than shipping it signed with the app.
- **Use the published `.tar.bz2` archive:** rejected; it needs a decompressor and cannot resume per file. The four files are fetched directly.

## Validation

- Unit tests: `apps/desktop/tests/unit/accurate.test.ts` (download, resume from a Range, SHA-256 mismatch deleted, already-checked file not fetched, unavailable without a native build, audio type and length refused, Kite page only); `apps/web/tests/unit/core/transcript/refine.test.ts` (replacement and fallback), `core/stt/channel.test.ts` (audio attached only when asked), `core/storage/transcriptionPrefs.test.ts` (off by default), `platform/desktop.test.ts` (no engine in an older desktop app).
- Still to do by a person: one real call with the setting on, on battery, noting how long the improved lines take (`docs/testing/final-test-plan.md` §6).
