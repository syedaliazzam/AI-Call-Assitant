# ADR-0095: Voice mode, Groq as a third answer model, and Ctrl+Shift+Arrows to move the overlay

- **Status:** Accepted
- **Date:** 2026-11-17
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5, §6, §7.2, §7.3, §8.1, §10.1 (version 4.35.0)
- **Supersedes / superseded by:** extends ADR-0038 and ADR-0082 (talking to the assistant during a call), ADR-0094 (the model during a call) and spec §6 (the admin's model switches); changes ADR-0056's jump keys.

## Context

The developer asked for three changes together:

1. **Hands-free talking to the assistant.** Ctrl+Shift+Space (ADR-0082) asks one spoken question; for a long stretch of questions the user wants to just keep talking, muted in the meeting, and have each question answered.
2. **Move keys.** Ctrl+Alt+Arrows jumped the overlay between its six positions (ADR-0056). The developer wants Ctrl+Shift+Arrows instead; the nudge stays on Ctrl+Alt+Shift+Arrows. ADR-0056 avoided Ctrl+Shift+Arrows because other apps use it to select text by word.
3. **A third answer model.** Groq serves `openai/gpt-oss-120b` with a much faster first token than Claude. The developer wants it as "Fastest (Groq)" beside "Fast (Claude Haiku)" and "Smart (Claude Sonnet)", with Claude as the safety net.

## Decision

### 1. Voice mode (web)

- **Where:** a **Voice** toggle on bar 1 (a waveform, "Voice", a dot), next to the model chip, and a **Voice** switch in the ⋮ menu after Auto answer. Tooltip: "Talk to Paramount AI hands-free". It sits in the part of bar 1 that gives way: it becomes its waveform at the same step as Auto and the model chip (ADR-0075), and never pushes Exit, ⋮ or the Transcript switch out. Off at the start of every call (its state lives in the call's dictation).
- **On:** the microphone is listened to continuously through the call's own "You" channel. Each pause of about 1.5 s (the dictation's `SEND_PAUSE_MS`) sends what was said as a question by the same path as Ctrl+Shift+Space (`chat()`, with the voice-question target), so the answer card shows; then it keeps listening. A quiet stretch does not stop it (no "didn't catch a question" notice). While it is on, none of the user's words become "You" lines or count as a reply.
- **Status bar:** "Talking to Paramount AI — your words aren't sent to the interviewer transcript" with **Turn off**; "Voice paused while they speak — …" while paused. It shows after the alerts (a silent microphone, the Answer key held elsewhere, a recording with Private off).
- **Safeguards:** it pauses while the other person is speaking (any "Them" partial or final with words), dropping what was collected, and resumes 2 s after their last words. **Esc** with a Paramount AI window in front, the toggle, the menu switch or the status bar's button turns it off. Escape is **not** held from other apps for it (unlike a one-off voice question, ADR-0082): Voice mode can stay on for a long time, and Escape belongs to the meeting app meanwhile. The first time it is turned on on a device, a tip shows under bar 1: "Mute yourself in the meeting first if others can hear you." (with Got it; it also hides after 8 s). Everything is drawn in the page, inside the protected window.
- **With it on:** Ctrl+Shift+Space has nothing to start; Ctrl+Alt+Enter takes the screenshot, and the next question spoken goes with it. Off, both work as before.
- **Code:** the rules are `core/voice/voiceMode.ts` (no React, timers injected); `useCallDictation` holds one per call; the live channel gains `voiceMode`, `voiceTip`, and the commands `voice-mode` and `voice-tip-seen`. The call's timing trace has a `voice-mode` event (on or off, nothing else).

### 2. Ctrl+Shift+Arrows (desktop 1.7.0)

- `overlay-spot-left/right` and `overlay-row-top/bottom` are now `CommandOrControl+Shift+Left/Right/Up/Down`; the nudge stays `CommandOrControl+Alt+Shift+Arrows`. Like every call shortcut they are registered only while a call runs and released at End (unchanged mechanism), so text selection by word works in other apps outside calls; during a call it does not (Settings → Hotkeys and the guide say so). The page's own keys ignore Shift with arrows, so Ctrl+Shift+Left is never taken as "previous answer".
- The keys are compiled into the desktop app from `packages/shared`, so the change ships as **desktop 1.7.0**. Settings → Hotkeys shows the keys the desktop app reports holding (`rowKeys()`), so a 1.3.0–1.6.5 app keeps showing Ctrl+Alt+Arrows until it updates. The overlay's "Drag to move" tooltip names the new keys.

### 3. Groq, "Fastest (Groq)" (web)

- **Choices everywhere they appear** (the session wizard's AI preferences, Settings → defaults, the review, the overlay's chip and ⋮ Model row): "Fast (Claude Haiku)" (default), "Smart (Claude Sonnet)", "Fastest (Groq)". Stored as `fast`, `smart`, `groq` (`AnswerModel` in `packages/shared`). The server's allow-list (`validate.ts`) accepts only these three.
- **Server:** `GROQ_API_KEY` (server only) and `GROQ_MODEL` (default `openai/gpt-oss-120b`, checked on Groq's models endpoint on 17 Nov 2026: active, 131,072-token context). `src/server/groq.ts` is the only place Kite talks to Groq: its OpenAI-compatible streaming chat completions, by plain `fetch` (no new dependency), `reasoning_effort: 'low'` and `include_reasoning: false` (Groq's docs: gpt-oss does not take `reasoning_format`), so the first word comes quickly and no reasoning reaches the answer.
- **Same prompt:** Groq gets the same system blocks (locked contract, global prompt, session, preferences) as one system message, and the same user turn including the end reminder (`toGroqMessages()`). The existing contract fallback (ADR-0089) shows a reply without the hidden lines cleanly.
- **Images stay on Claude:** screenshots and anything with an image, warm-ups and the hello test always use Claude; for a Groq session that is Claude Haiku. The user is shown nothing about it. The warm-up writes Haiku's cache, which the screenshots and the fallback read; switching between Fast and Fastest needs no new warm-up.
- **Fallback:** when Groq errors, or sends no first token within 4 s (`GROQ_FIRST_TOKEN_MS`), or ends with no text, the same answer is asked of Claude Haiku (`withFirstTokenFallback()`), logged (`answer: groq fallback to haiku`, with the reason and Groq's HTTP status only) and recorded: the `done` event says `model: 'fast'` and `fallback: 'timeout' | 'error' | 'empty'`. Once Groq's first words are out, a later error is an error (the words cannot be taken back).
- **Records:** the `done` event's `model` is the model that really answered (`groq`, or `fast` after a fallback or for an image). The answer card's record, the saved answer, the export, and the call's timing trace keep it (the trace also has the fallback, and a `groq-fallback-<reason>` flag in the card rows).
- **Admin:** Admin → Usage gets **Allow Groq (Fastest) in sessions** (`app_setting` `groq_model_enabled`, cached 60 s like the Smart switch). Groq is off when the switch is off or the server has no key; a Groq session then answers with Claude Haiku, and the overlay shows Fastest disabled with "Turned off by your admin". `GET /api/models` gains `groq`. The usage table gains "Groq today / 7 days": `usage_day.groq_requests` (migration 0009, additive, default 0), increased in the same statement as the daily count for each request sent to Groq (counted when Groq is asked, so a request that fell back still counts there). Groq requests count towards the daily limit like any other.
- **Unchanged:** Ask AI and AI notes keep their Claude models (a Groq request in Ask AI mode is answered by its default, Sonnet).

## Consequences

- One more control on bar 1. It gives way like the model chip; the fit rules are unchanged.
- Voice mode keeps the microphone's words out of the transcript for as long as it is on, by design; the status bar says so the whole time.
- A user whose meeting audio comes through speakers would otherwise feed the other person's words into Voice mode; the pause on "Them" speech covers that, with up to 2 s of their trailing words dropped.
- Ctrl+Shift+Arrows no longer selects text by word in other apps while a call runs in the desktop app.
- Groq is a new processor of call content for the sessions set to it (the same prompt Claude gets). Its key is server-only; Groq's error text is never logged or forwarded.
- An older live page (a cached tab) publishes no `voiceMode` and no `groqAllowed`: the overlay then shows no Voice toggle and Fastest disabled. An older server sends no `groq` in `/api/models`: Fastest shows disabled.

## Alternatives considered

- **Hold Escape globally while Voice mode is on:** it would take Escape from the meeting app for minutes at a time. Rejected; Esc works with a Paramount AI window in front, and the toggle and the status bar's button always work.
- **Groq's own SDK or the OpenAI SDK:** a dependency for one streaming call. Rejected for a small `fetch` reader.
- **Retry on Claude after Groq's first words:** it would repeat or contradict words already shown. Rejected.
- **Keep Ctrl+Alt+Arrows and add Ctrl+Shift+Arrows:** two sets of keys for one action, both held during calls. Rejected; the developer asked for a replacement.

## Validation

- Unit: `core/voice/voiceMode.ts` (on, after a question, a quiet stretch, pause and resume 2 s after their last words, off cancels a pending resume); the status line's Voice messages; the channel's commands; bar 1's Voice toggle (in the part that gives way, after the model chip) and the ⋮ menu's switch; `server/groq.ts` (message conversion, streaming, usage, HTTP and stream errors, the 4 s fallback, no fallback after the first words or after an abort); the answer route with Groq (Groq answers and says so, counted as Groq; a failure is answered by Haiku and recorded; screenshots, warm-ups and Ask AI never go to Groq; Groq off; allow-list); the model switches and usage counts; `GET /api/models`; the three model choices; the move keys in the shared map and the desktop's registration; Settings showing an older app's keys.
- Not run for this change (the developer's instruction): evaluations, paid checks, integration, end-to-end and smoke tests. Manual steps are in the stage summary.
