# ADR-0038: Voice for Ask Kite — talk to Kite; read aloud only outside calls

- **Status:** Accepted (developer, 3 Nov 2026)
- **Date:** 2026-11-03
- **Architecture reference:** `docs/architecture/kite-architecture-v3.1.md` §5 (Ask Kite, live session), §7.1 (core/stt, core/audio)
- **Supersedes / superseded by:** extends ADR-0030 (Ask Kite). Nothing superseded.

## Context

v1.0.2 item 8 asks for a voice mode: talk to Kite instead of typing, have replies read aloud, and a hands-free loop that listens again after each reply. Kite already runs an on-device speech-to-text engine for calls (the "You" and "Them" channels; `core/stt/sttEngine.ts`). Two risks shape the design:

1. **Loopback and echo.** In the desktop app the other side ("Them") is the computer's own sound (system audio capture), and in a browser it is the shared tab's sound. Anything the computer plays during a call — such as Kite reading a reply aloud through the speakers — is captured as "Them" and becomes a transcript line, a question Kite may answer, and part of later prompts. Without headphones the microphone can also pick it up and send it into the meeting.
2. **Words meant for Kite are not part of the call.** If the user dictates a private question during a call, the call's "You" channel hears it. If it became a normal "You" line it would be saved, sent in every later prompt, and could look to auto-answer like the user's turn in the conversation.

## Decision

1. **Ask Kite page (outside calls): full voice.** A microphone button turns speech into the message and sends it when the user pauses (`SEND_PAUSE_MS`, 1.2 s, the same pause auto-answer uses). "Read replies aloud" reads each finished reply with the browser's own speech synthesis (no new dependency, nothing sent anywhere), with a Stop button. "Hands-free" listens again after each reply (after reading ends, when reading is on). Both switches are per device (localStorage, off by default). Leaving the live page ends a call, so this page is never open during one.
   - The microphone and the speech engine are the call's own pieces: the platform's microphone with the call's constraints, and `createSttEngine` attached as the "you" channel (`core/voice/micSession.ts`). The model loads on the first press and stays loaded while the page is open; the microphone is open only while listening.
   - Only the readable words are spoken: code blocks become "The code is on screen.", Markdown marks, links and any hidden line are removed, and at most 1,500 characters are read (cut at a sentence end) in pieces of at most 220 characters (Chrome stops one long utterance after about 15 s).
2. **During a call: speech to text only.** Nothing is read aloud and there is no hands-free loop (risk 1). The microphone button in the call's message box, overlay and script bar turns speech into a question, using the call's existing "You" channel — no second capture or engine (`features/live/useCallDictation.ts`).
3. **The diversion rule (risk 2).** While listening with the chat mode "Auto" or "Ask Kite", the "You" channel's words are diverted: they never become a transcript line, are not saved and are not sent in later prompts (`shouldDivert()` in `core/voice/dictation.ts`; the live page's engine callbacks skip `transcript.addFinal`). With "For the call" the user is answering out loud, so the words stay a normal "You" line and are also used as the question.
4. **Listening never stays on by accident.** Dictation stops after sending, and stops without sending if nothing is heard for 15 s (`IDLE_STOP_MS`) or the call disconnects. Filler alone ("um", "uh") is not sent.

## Consequences

- Users can talk to Kite on the Ask Kite page, hands-free if they want, with no new dependency and no audio leaving the device.
- During calls, read-aloud is not offered at all — a deliberate limit, not a missing feature.
- While dictating to Kite in a call, the user's own words in that moment are not in the transcript or the saved call. That is the point, but if the user forgets the mode and speaks to the other person, those words are missing; the 15 s idle stop and the stop-after-send keep the window short.
- The speech engine is English-only (as for calls), so dictation is English-only. On the Ask Kite page the first press may wait for the model to load (cached after the first call; a first-ever download takes longer).
- Browser speech synthesis voices differ by system; where a browser has none, the "Read replies aloud" switch is not shown.

## Alternatives considered

- **Read aloud during calls with echo suppression:** rejected. The existing echo check (`core/transcript/echo.ts`) matches the microphone against the other side, not the other side against Kite's own speech, and nothing can stop the sound reaching the meeting through an open microphone.
- **A second microphone capture and engine for dictation in a call:** rejected — twice the CPU for the same microphone, and the call's "You" channel would still hear the same words.
- **A cloud speech service:** rejected — the architecture keeps audio on the device.

## Validation

- Unit tests: `tests/unit/core/voice/dictation.test.ts` (pause, filler, idle stop, diversion rule), `speak.test.ts` (readable text, pieces, end and stop), `micSession.test.ts` (engine reuse, microphone closed on stop, errors), `tests/unit/core/storage/voicePrefs.test.ts`.
- Human checks (end-of-day list): on the Ask Kite page, talk a question and hear the reply read; hands-free answers two questions in a row; during a call, dictate an "Ask Kite" question and confirm no "You" line appears and the saved transcript does not contain it; dictate "For the call" and confirm the line does appear.
