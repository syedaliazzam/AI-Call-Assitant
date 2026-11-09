/**
 * File: apps/web/src/core/transcript/saver.ts
 * Purpose: Keeps a session's saved transcript in step with the live transcript, for sessions
 *          with "save transcript" on: new final lines are saved, a line that grew (merged with
 *          the next one) is saved again under the same id, and a saved line that is later
 *          recognised as an echo is deleted. Echo lines and partial (grey) lines are never saved.
 * Used by: src/features/live/LivePage.tsx (only when the session's saveTranscript is on)
 * Depends on: src/core/transcript/transcript.ts, src/core/storage/utterances.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (save-transcript toggle);
 *               day-03-sessions.md Stage 4
 *
 * Why it watches the transcript instead of saving each final line once: lines change after they
 * become final (merging), and a "You" line can be marked as an echo only when the matching
 * "Them" line arrives. Writes run one at a time, in order, so a later change is never
 * overwritten by an earlier one. Transcript text is never logged.
 */
import { deleteUtterance, saveUtterance } from '../storage/utterances';
import type { StoredUtterance } from '../storage/types';
import type { Transcript, Utterance } from './transcript';

/** Where the saver writes (the storage functions; replaceable in tests). */
export interface SaverStore {
  /** Saves a line, or replaces the line with the same id. */
  save: (utterance: StoredUtterance) => Promise<void>;
  /** Deletes a saved line. */
  remove: (id: string) => Promise<void>;
}

/** Options for startTranscriptSaver(). */
export interface SaverOptions {
  /** Where to write (default: core/storage/utterances). */
  store?: SaverStore;
  /**
   * Id of this call (default: a new random id). Transcript line ids restart at 'u1' on every
   * page load, so the stored id combines session, call and line to stay unique.
   */
  callId?: string;
  /** Called when a write fails (the user is told; the next change tries again). */
  onError?: () => void;
}

/** A running saver. */
export interface TranscriptSaver {
  /**
   * v1.4 (ADR-0066): the stored id of a transcript line (session, call and line), so a line saved
   * during the call can be saved again after it (core/transcript/afterCall.ts).
   *
   * @param lineId The transcript line's id.
   * @returns Its stored id.
   */
  storedId(lineId: string): string;
  /** Stops watching the transcript (writes already queued still finish). */
  stop(): void;
  /**
   * Resolves when every queued write has finished.
   *
   * @returns A promise that settles when the queue is empty.
   */
  flush(): Promise<void>;
}

/**
 * Starts saving a transcript's final lines for a session.
 *
 * @param transcript The live transcript.
 * @param sessionId  The session the lines belong to.
 * @param options    Store, call id and error callback.
 * @returns The saver (stop it when the call ends).
 * Called from: LivePage.tsx, when a call connects and the session saves transcripts; tests
 */
export function startTranscriptSaver(
  transcript: Transcript,
  sessionId: string,
  options: SaverOptions = {},
): TranscriptSaver {
  const store = options.store ?? { save: saveUtterance, remove: deleteUtterance };
  const callId = options.callId ?? crypto.randomUUID();
  /** What is stored, by transcript line id: the version last written (text and times). */
  const saved = new Map<string, Utterance>();
  /**
   * The stored id of a line.
   *
   * @param lineId The transcript line's id.
   * @returns The id it is stored under.
   */
  const storedIdOf = (lineId: string) => `${sessionId}:${callId}:${lineId}`;
  /** The write queue: each write starts after the previous one finished. */
  let queue: Promise<void> = Promise.resolve();

  /**
   * Adds a write to the queue; a failure is reported and does not stop later writes.
   *
   * @param write The write to run.
   */
  const enqueue = (write: () => Promise<void>) => {
    queue = queue.then(write).catch(() => options.onError?.());
  };

  /** Compares the transcript with what is stored and queues the differences. */
  const sync = () => {
    for (const line of transcript.allLines()) {
      const storedId = storedIdOf(line.id);
      const previous = saved.get(line.id);
      if (line.echo) {
        // Recognised as an echo after it was saved: remove it (echo lines are never kept).
        if (previous) {
          saved.delete(line.id);
          enqueue(() => store.remove(storedId));
        }
        continue;
      }
      if (
        previous &&
        previous.text === line.text &&
        previous.tStart === line.tStart &&
        previous.tEnd === line.tEnd
      ) {
        continue;
      }
      saved.set(line.id, line);
      const utterance: StoredUtterance = {
        id: storedId,
        sessionId,
        speaker: line.speaker,
        text: line.text,
        tStart: line.tStart,
        tEnd: line.tEnd,
      };
      enqueue(() => store.save(utterance));
    }
  };

  const unsubscribe = transcript.subscribe(sync);
  // Lines that are already final when saving starts (for example after a reconnect).
  sync();
  return {
    storedId: storedIdOf,
    stop: unsubscribe,
    flush: () => queue,
  };
}
