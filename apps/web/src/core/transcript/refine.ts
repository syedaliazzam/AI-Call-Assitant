/**
 * File: apps/web/src/core/transcript/refine.ts
 * Purpose: Accurate transcription's second pass (v1.0.1, ADR-0034): sends one finished line's audio
 *          to the desktop app's accurate engine and, when it answers, replaces the words the live
 *          engine heard with its text, with the session's key terms put back (v1.1.0, keyTermFix.ts).
 *          Whenever the engine is not ready, refuses the audio or fails, the live line simply stays:
 *          it is the fallback. Logs only whether it worked and how long it took, never text or audio.
 * Used by: src/features/live/LivePage.tsx (onFinal); tests
 * Depends on: src/platform/types.ts (AccurateEngine), src/core/transcript/transcript.ts,
 *             src/core/transcript/keyTermFix.ts
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
import type { AccurateEngine } from '@/platform/types';
import { correctTerms } from './keyTermFix';
import type { Transcript } from './transcript';

/**
 * Transcribes a final line's audio again and puts the result in the line.
 *
 * @param engine     The accurate engine (platform.accurate).
 * @param transcript The call's transcript.
 * @param lineId     The final line's id (from addFinal).
 * @param heard      The live engine's words for this utterance.
 * @param audio      The utterance's audio (mono 16 kHz).
 * @param terms      The session's key terms and company, as the user wrote them.
 * @returns True when the line was refined; false when the live text stays.
 * Called from: LivePage.tsx (onFinal); tests
 */
export async function refineLine(
  engine: Pick<AccurateEngine, 'transcribe'>,
  transcript: Pick<Transcript, 'refineFinal'>,
  lineId: string,
  heard: string,
  audio: Float32Array,
  terms: readonly string[] = [],
): Promise<boolean> {
  const result = await engine.transcribe(audio).catch(() => null);
  if (!result?.ok) {
    console.info('stt: accurate pass skipped', { code: result?.code ?? 'engine' });
    return false;
  }
  const changed = transcript.refineFinal(lineId, heard, correctTerms(result.text, terms));
  console.info('stt: accurate pass', { ms: result.ms, changed });
  return changed;
}
