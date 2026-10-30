/**
 * File: apps/web/src/core/transcript/endCall.ts
 * Purpose: Ends a call in the order that keeps the last line: stop capturing (which detaches
 *          both channels, so the worker turns the line still being spoken into a final line),
 *          wait until that final line has reached the transcript, let the saver write it, and
 *          only then stop the saver and clear the transcript.
 * Used by: src/features/live/LivePage.tsx (the End button)
 * Depends on: src/core/stt/sttEngine.ts (drain), src/core/transcript/saver.ts,
 *             src/core/transcript/transcript.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §7.4;
 *               day-04-answers.md (Stage 0, the End fix found by the Day 3 end-to-end suite)
 *
 * Why the order matters (Day 3 finding): the old End stopped the saver and cleared the
 * transcript at once, so the flushed last line arrived after both and was never saved.
 */
import type { SttEngine } from '../stt/sttEngine';
import type { TranscriptSaver } from './saver';
import type { Transcript } from './transcript';

/** The parts of a running call that endCall() stops. */
export interface CallParts {
  /** Stops both capture channels (detaching them from the engine), or does nothing. */
  stopCapture: () => void;
  /** The speech-to-text engine (null when it is not running). */
  engine: Pick<SttEngine, 'drain'> | null;
  /** The transcript saver (null when "Save transcript" is off). */
  saver: TranscriptSaver | null;
  /** The live transcript, cleared at the end (with saving off this discards it, §7.4). */
  transcript: Pick<Transcript, 'clear'>;
}

/**
 * Ends a call without losing the line that was still being spoken.
 *
 * @param parts The call's capture, engine, saver and transcript.
 * @returns Resolves when every line is saved (when saving is on) and the transcript is clear.
 *          Never rejects: a failed write is reported by the saver's own onError.
 * Called from: end() in LivePage.tsx; tests
 */
export async function endCall(parts: CallParts): Promise<void> {
  parts.stopCapture();
  // The worker handles messages in order: once drain() resolves, the final lines flushed by the
  // detaches above have been added to the transcript, and the saver has queued them.
  await parts.engine?.drain();
  parts.saver?.stop();
  await parts.saver?.flush().catch(() => undefined);
  parts.transcript.clear();
}
