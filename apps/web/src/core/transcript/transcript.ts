/**
 * File: apps/web/src/core/transcript/transcript.ts
 * Purpose: The live transcript of a call, in memory and without React: final lines for "You"
 *          and "Them" in time order, plus each speaker's current partial (grey, still changing)
 *          line. The UI renders it (Stage 4); answers use its last minutes (Day 4).
 * Used by: the live page (Day 2 Stage 4: LivePage, TranscriptStrip); core/answer (Day 4)
 * Depends on: src/core/transcript/merge.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 2–3, §7.1, §7.4 (utterances)
 *
 * Text stays in this page's memory only; it is never logged. Day 3: final lines are also saved
 * to IndexedDB (utterances store, §7.4) when the session's "save transcript" setting is on.
 */
import { mergeLines, shouldMerge } from './merge';

/** Who spoke: "you" = microphone, "them" = the other side of the call. */
export type Speaker = 'you' | 'them';

/** One line of the transcript. */
export interface Utterance {
  /** Stable id ('u1', 'u2', …; a partial line uses 'partial-you' / 'partial-them'). */
  id: string;
  /** Who spoke. */
  speaker: Speaker;
  /** What was said. Never logged. */
  text: string;
  /** Start (Unix ms, capture time). */
  tStart: number;
  /** End (Unix ms, capture time; for a partial line, when it last changed). */
  tEnd: number;
  /** True for a finished line; false for the current partial (grey) line. */
  final: boolean;
}

/** What createTranscript() returns. */
export interface Transcript {
  /**
   * Replaces a speaker's partial line ('' removes it).
   *
   * @param speaker Who is speaking.
   * @param text    Current text ('' when the engine cleared it).
   * @param tStart  Utterance start (Unix ms), or null when unknown (then: now).
   */
  addPartial(speaker: Speaker, text: string, tStart: number | null): void;
  /**
   * Adds a finished line (merging it into the previous line when merge.ts says so) and removes
   * that speaker's partial line.
   *
   * @returns The line as stored (new or merged).
   */
  addFinal(line: { speaker: Speaker; text: string; tStart: number; tEnd: number }): Utterance;
  /** All lines (finals and partials) in time order. The same array until something changes. */
  lines(): readonly Utterance[];
  /**
   * The lines that ended in the last `minutes` minutes (for answers, Day 4).
   *
   * @param minutes How far back.
   * @param now     Unix ms (default Date.now()).
   */
  window(minutes: number, now?: number): Utterance[];
  /** Removes every line. */
  clear(): void;
  /**
   * Calls `listener` after every change.
   *
   * @returns A function that removes the listener.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * Index at which a line with this start time belongs (after lines that start at the same time).
 *
 * @param list   Lines sorted by tStart.
 * @param tStart The new line's start.
 * @returns The insertion index.
 */
function insertionIndex(list: readonly Utterance[], tStart: number): number {
  let index = list.length;
  while (index > 0 && list[index - 1]!.tStart > tStart) index -= 1;
  return index;
}

/**
 * Creates an empty transcript.
 *
 * @param clock Returns Unix ms (default Date.now; tests pass a fixed clock).
 * @returns The transcript.
 * Called from: the live page (Stage 4)
 */
export function createTranscript(clock: () => number = Date.now): Transcript {
  /** Final lines, sorted by tStart. */
  let finals: Utterance[] = [];
  /** Each speaker's current partial line. */
  const partials = new Map<Speaker, Utterance>();
  /** Cached result of lines(), rebuilt after each change (a stable reference for React). */
  let snapshot: readonly Utterance[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();

  /** Rebuilds the snapshot and tells the listeners. */
  const changed = () => {
    const all = [...finals];
    for (const partial of partials.values())
      all.splice(insertionIndex(all, partial.tStart), 0, partial);
    snapshot = all;
    for (const listener of [...listeners]) listener();
  };

  return {
    addPartial(speaker, text, tStart) {
      if (text === '') {
        if (partials.delete(speaker)) changed();
        return;
      }
      const now = clock();
      const existing = partials.get(speaker);
      partials.set(speaker, {
        id: `partial-${speaker}`,
        speaker,
        text,
        tStart: tStart ?? existing?.tStart ?? now,
        tEnd: now,
        final: false,
      });
      changed();
    },

    addFinal(line) {
      partials.delete(line.speaker);
      const index = insertionIndex(finals, line.tStart);
      const previous = finals[index - 1];
      let stored: Utterance;
      if (shouldMerge(previous, line)) {
        stored = mergeLines(previous!, line);
        finals = [...finals.slice(0, index - 1), stored, ...finals.slice(index)];
      } else {
        stored = { id: `u${nextId++}`, ...line, final: true };
        finals = [...finals.slice(0, index), stored, ...finals.slice(index)];
      }
      changed();
      return stored;
    },

    lines() {
      return snapshot;
    },

    window(minutes, now = clock()) {
      const since = now - minutes * 60_000;
      return snapshot.filter((line) => line.tEnd >= since);
    },

    clear() {
      finals = [];
      partials.clear();
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
