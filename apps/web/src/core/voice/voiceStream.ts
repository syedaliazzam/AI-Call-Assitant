/**
 * File: apps/web/src/core/voice/voiceStream.ts
 * Purpose: ADR-0101: turns an event of the microphone's Flux voice stream into what a voice question's
 *          dictation understands: the turn's words (partial), the turn's final words (final, then a definite
 *          end), Flux EagerEndOfTurn (an early end), EndOfTurn (a definite end) and TurnResumed (the speaker
 *          went on). Also says when the newest word ended, for the timing trace.
 * Used by: src/features/live/useCallDictation.ts
 * Depends on: src/core/voice/dictation.ts (Dictation), src/core/stt/deepgram.ts (CloudEvent)
 * Architecture: docs/decisions/ADR-0101-fast-voice-questions-for-everyone.md
 *
 * No React; no text is logged.
 */
import type { CloudEvent } from '../stt/deepgram';
import type { Dictation } from './dictation';

/**
 * Feeds one voice-stream event to a dictation.
 *
 * @param dictation The question's dictation.
 * @param event     The event.
 * @returns When the newest word ended (Unix ms) when the event carried words, else null.
 * Called from: useCallDictation.ts; tests
 */
export function feedVoiceEvent(
  dictation: Pick<Dictation, 'partial' | 'final' | 'signal' | 'resumed'>,
  event: CloudEvent,
): number | null {
  if (event.type === 'partial') {
    dictation.partial(event.text);
    return event.text.trim() ? event.tEnd : null;
  }
  if (event.type === 'final') {
    dictation.final(event.text);
    if (event.endOfTurn) dictation.signal('end');
    return event.text.trim() ? event.tEnd : null;
  }
  if (event.type === 'turn') {
    if (event.event === 'eager') dictation.signal('eager');
    else if (event.event === 'end') dictation.signal('end');
    else if (event.event === 'resumed') dictation.resumed();
  }
  return null;
}
