/**
 * File: apps/web/src/core/transcript/afterCall.ts
 * Purpose: The user's own lines, transcribed again after the call (v1.4, ADR-0066). During the call the
 *          desktop app's accurate engine works only on the other person's lines (they make the
 *          questions, and two passes at once would slow the live engine). The user's lines keep the live
 *          engine's words on screen; their audio is kept in memory, per line, and once the call has
 *          ended each saved line is transcribed again and saved again with the better words. Nothing is
 *          kept when the transcript is not saved, and the audio is dropped as soon as it is used.
 *          Logs only counts and times, never text or audio.
 * Used by: src/features/live/LivePage.tsx (onFinal, end); tests
 * Depends on: src/platform/types.ts (AccurateEngine), src/core/storage/types.ts (StoredUtterance),
 *             src/core/transcript/keyTermFix.ts
 * Architecture: docs/decisions/ADR-0066-accurate-on-them-by-default.md
 */
import { ACCURATE_MAX_SECONDS } from '@kite/shared';
import type { StoredUtterance } from '../storage/types';
import type { AccurateEngine } from '@/platform/types';
import { correctTerms } from './keyTermFix';

/** Most of the user's speech kept for after the call, in seconds (20 min: about 77 MB as 32-bit audio). */
export const AFTER_CALL_MAX_SECONDS = 20 * 60;

/** Samples per second of the kept audio. */
const RATE = 16_000;

/** The audio of the user's lines, collected during a call. */
export interface YouAudio {
  /**
   * Adds one final "You" utterance to its line (a line that grew by merging gets several).
   *
   * @param lineId The line it ended up in (addFinal's id).
   * @param audio  Its audio (mono 16 kHz), or null when there is none: the line is then left as heard.
   */
  add(lineId: string, audio: Float32Array | null): void;
  /**
   * Hands over what was collected and empties the store.
   *
   * @returns Each line's pieces in order; null for a line that cannot be done whole.
   */
  take(): Map<string, Float32Array[] | null>;
  /** Seconds of audio kept now. */
  seconds(): number;
}

/**
 * Creates the store for one call.
 *
 * @param maxSeconds The most audio kept (later lines are left as heard).
 * @returns The store.
 * Called from: LivePage.tsx (when a call connects); tests
 */
export function createYouAudio(maxSeconds = AFTER_CALL_MAX_SECONDS): YouAudio {
  let lines = new Map<string, Float32Array[] | null>();
  let samples = 0;
  return {
    add(lineId, audio) {
      const pieces = lines.get(lineId);
      // Once a piece is missing, the line cannot be rewritten whole: it keeps the live words.
      if (pieces === null) return;
      if (
        !audio ||
        audio.length === 0 ||
        audio.length > ACCURATE_MAX_SECONDS * RATE ||
        samples + audio.length > maxSeconds * RATE
      ) {
        if (pieces) samples -= pieces.reduce((sum, piece) => sum + piece.length, 0);
        lines.set(lineId, null);
        return;
      }
      samples += audio.length;
      lines.set(lineId, [...(pieces ?? []), audio]);
    },
    take() {
      const taken = lines;
      lines = new Map();
      samples = 0;
      return taken;
    },
    seconds: () => samples / RATE,
  };
}

/** One saved line to rewrite. */
export interface AfterCallLine {
  /** The line as saved (its id is the stored one); the text is replaced. */
  saved: StoredUtterance;
  /** Its audio, piece by piece, in order. */
  pieces: Float32Array[];
}

/** What the rewrite did. */
export interface AfterCallResult {
  /** Lines saved with new words. */
  rewritten: number;
  /** Lines left as heard (the engine refused or failed, or it gave no words). */
  kept: number;
  /** From start to end, ms. */
  ms: number;
}

/**
 * Transcribes the saved "You" lines again and saves the new words, one line at a time.
 *
 * @param engine  The accurate engine (platform.accurate).
 * @param lines   The lines and their audio.
 * @param save    Saves a line (replaces the stored one with the same id).
 * @param terms   The session's key terms and company, as the user wrote them (keyTermFix.ts).
 * @param stopped Returns true to stop early (the page is closing); the rest keep their words.
 * @returns How many lines were rewritten.
 * Called from: end() in LivePage.tsx; tests
 */
export async function rewriteAfterCall(
  engine: Pick<AccurateEngine, 'transcribe'>,
  lines: readonly AfterCallLine[],
  save: (utterance: StoredUtterance) => Promise<void>,
  terms: readonly string[] = [],
  stopped: () => boolean = () => false,
): Promise<AfterCallResult> {
  const started = performance.now();
  let rewritten = 0;
  let kept = 0;
  for (const line of lines) {
    if (stopped()) {
      kept += 1;
      continue;
    }
    const texts: string[] = [];
    for (const piece of line.pieces) {
      const result = await engine.transcribe(piece).catch(() => null);
      if (!result?.ok) break;
      texts.push(result.text.trim());
    }
    const text = correctTerms(texts.filter(Boolean).join(' '), terms).trim();
    if (texts.length !== line.pieces.length || text === '') {
      kept += 1;
      continue;
    }
    try {
      await save({ ...line.saved, text });
      rewritten += 1;
    } catch {
      kept += 1;
    }
  }
  const ms = Math.round(performance.now() - started);
  console.info('stt: after-call pass', { rewritten, kept, ms });
  return { rewritten, kept, ms };
}
