/**
 * File: apps/web/src/core/transcript/transcript.ts
 * Purpose: The live transcript of a call, in memory and without React: final lines for "You"
 *          and "Them" in time order, plus each speaker's current partial (grey, still changing)
 *          line. "You" lines that only echo "Them" through the laptop's speakers are marked and
 *          hidden (echo.ts), with a count, so the UI can say so. For display only, a new "You"
 *          line that arrives while "Them" is speaking is held back for DISPLAY_HOLD_MS, so an
 *          echo is not shown for a moment before its "Them" original reveals it. The UI renders
 *          displayLines() (Stage 4); answers use lines()/window(), which are never held (Day 4).
 * Used by: the live page (Day 2 Stage 4: LivePage, TranscriptStrip); core/answer (Day 4)
 * Depends on: src/core/transcript/merge.ts, src/core/transcript/echo.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 2–3, §7.1, §7.4 (utterances)
 *
 * Text stays in this page's memory only; it is never logged. Day 3: final lines are also saved
 * to IndexedDB (utterances store, §7.4) when the session's "save transcript" setting is on
 * (echo lines are not saved).
 */
import { ECHO_WINDOW_AFTER_MS, ECHO_WINDOW_BEFORE_MS, isEcho } from './echo';
import { mergeLines, shouldMerge } from './merge';

/**
 * How long a new "You" line is held back from displayLines() when "Them" is speaking, in ms.
 * On Day 2 a "Them" line was on screen 0.6–1.1 s after its speech ended, and both copies of an
 * echo arrive with about the same lag; 1.5 s covers that with a little margin and is short
 * enough not to feel slow. When "Them" is quiet there is no hold at all.
 */
export const DISPLAY_HOLD_MS = 1_500;

/** "Them" counts as speaking while its partial line exists or for this long after a final line. */
export const THEM_ACTIVE_MS = 2_000;

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
  /**
   * True for a "You" line that only echoes "Them" through the speakers (echo.ts). Echo lines
   * are left out of lines() and window(). Never set on "Them" lines.
   */
  echo?: boolean;
  /**
   * Display only: until when (Unix ms, the transcript's clock) displayLines() holds this "You"
   * line back, because "Them" was speaking when it arrived. lines() and window() ignore it.
   */
  heldUntil?: number;
}

/** Options for createTranscript(). */
export interface TranscriptOptions {
  /**
   * Runs a callback after a delay and returns a function that cancels it (default setTimeout).
   * Used to show a held line when its hold ends.
   */
  schedule?: (callback: () => void, ms: number) => () => void;
}

/** How many echo lines were hidden, and the latest one. */
export interface EchoStats {
  /** Hidden final "You" lines so far. */
  count: number;
  /** When the latest one ended (Unix ms), or null when there was none. */
  lastAt: number | null;
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
   * Adds a finished line and removes that speaker's partial line. A "You" line is checked for
   * echo first; a "Them" line also re-checks the "You" lines of the last few seconds (the echo
   * can arrive before the original is final). Close lines merge (merge.ts), ignoring echoes.
   *
   * @returns The line as stored (new or merged).
   */
  addFinal(line: { speaker: Speaker; text: string; tStart: number; tEnd: number }): Utterance;
  /**
   * v1.0.1 (ADR-0034): replaces the words one utterance added to a final line with the accurate
   * engine's text. A line can hold several merged utterances, so only the last place where the
   * heard words appear is replaced, never the whole line.
   *
   * @param id      The final line's id (as addFinal returned it).
   * @param heard   The words the live engine heard for that utterance.
   * @param refined The accurate engine's text for the same audio.
   * @returns True when the line was changed; false when it is gone or no longer holds the words.
   */
  refineFinal(id: string, heard: string, refined: string): boolean;
  /** Visible lines (no echoes), finals and partials, in time order. Same array until a change. */
  lines(): readonly Utterance[];
  /**
   * What the transcript strip shows: lines() minus "You" lines still held back (heldUntil).
   * Listeners are told again when a hold ends. Same array until a change.
   */
  displayLines(): readonly Utterance[];
  /** Every final line, echoes included (marked), in time order. */
  allLines(): readonly Utterance[];
  /**
   * The visible lines that ended in the last `minutes` minutes (for answers, Day 4).
   *
   * @param minutes How far back.
   * @param now     Unix ms (default Date.now()).
   */
  window(minutes: number, now?: number): Utterance[];
  /** How many echo lines were hidden. */
  echoStats(): EchoStats;
  /** Removes every line (and the echo count). */
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
 * @param clock   Returns Unix ms (default Date.now; tests pass a fixed clock).
 * @param options Timer for the display hold (tests pass a fake one).
 * @returns The transcript.
 * Called from: the live page (Stage 4)
 */
export function createTranscript(
  clock: () => number = Date.now,
  options: TranscriptOptions = {},
): Transcript {
  const schedule =
    options.schedule ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
  /** Final lines (echoes included, marked), sorted by tStart. */
  let finals: Utterance[] = [];
  /** Each speaker's current partial line. */
  const partials = new Map<Speaker, Utterance>();
  /** Cached result of lines(), rebuilt after each change (a stable reference for React). */
  let snapshot: readonly Utterance[] = [];
  /** Cached result of displayLines() (lines() minus held lines). */
  let displaySnapshot: readonly Utterance[] = [];
  let nextId = 1;
  let echoes: EchoStats = { count: 0, lastAt: null };
  /** When the latest "Them" final line arrived (clock time), or null. */
  let lastThemFinalAt: number | null = null;
  /** Cancels the timer that ends the next hold. */
  let cancelHoldTimer: (() => void) | null = null;
  const listeners = new Set<() => void>();

  /** Rebuilds both snapshots, schedules the next hold's end, and tells the listeners. */
  const changed = () => {
    const visible = finals.filter((line) => !line.echo);
    for (const partial of partials.values()) {
      if (!partial.echo) visible.splice(insertionIndex(visible, partial.tStart), 0, partial);
    }
    snapshot = visible;
    const now = clock();
    const held = visible.filter((line) => line.heldUntil !== undefined && line.heldUntil > now);
    displaySnapshot = held.length === 0 ? visible : visible.filter((line) => !held.includes(line));
    cancelHoldTimer?.();
    cancelHoldTimer = null;
    if (held.length > 0) {
      const nextEnd = Math.min(...held.map((line) => line.heldUntil!));
      cancelHoldTimer = schedule(changed, Math.max(0, nextEnd - now));
    }
    for (const listener of [...listeners]) listener();
  };

  /**
   * Hold for a new "You" line: until now + DISPLAY_HOLD_MS when "Them" is speaking, otherwise
   * none. A line that continues an earlier one keeps that one's hold (so a line already on
   * screen never disappears again).
   *
   * @param speaker   Who spoke.
   * @param inherited The hold of the line it continues (partial → final, or a merge), if any.
   * @param continues True when it continues an earlier line.
   * @returns The heldUntil value, or undefined for no hold.
   */
  const holdFor = (
    speaker: Speaker,
    inherited: number | undefined,
    continues: boolean,
  ): number | undefined => {
    if (speaker !== 'you') return undefined;
    if (continues) return inherited;
    const now = clock();
    const themSpeaking =
      partials.has('them') || (lastThemFinalAt !== null && now - lastThemFinalAt <= THEM_ACTIVE_MS);
    return themSpeaking ? now + DISPLAY_HOLD_MS : undefined;
  };

  /**
   * What "Them" said around a time span (finals and the current partial), in time order.
   *
   * @param tStart Start of the "You" line.
   * @param tEnd   End of the "You" line.
   * @returns The text, joined with spaces.
   */
  const themTextAround = (tStart: number, tEnd: number): string => {
    const from = tStart - ECHO_WINDOW_BEFORE_MS;
    const to = tEnd + ECHO_WINDOW_AFTER_MS;
    const them = finals.filter(
      (line) => line.speaker === 'them' && line.tEnd >= from && line.tStart <= to,
    );
    const partial = partials.get('them');
    if (partial && partial.tEnd >= from) them.push(partial);
    return them
      .sort((a, b) => a.tStart - b.tStart)
      .map((line) => line.text)
      .join(' ');
  };

  /**
   * Marks a final "You" line as an echo and counts it for the "Hiding echo" notice.
   *
   * @param line The final "You" line.
   * @returns A copy of the line with echo: true (the original is not changed).
   */
  const markEcho = (line: Utterance): Utterance => {
    echoes = { count: echoes.count + 1, lastAt: Math.max(echoes.lastAt ?? 0, line.tEnd) };
    return { ...line, echo: true };
  };

  return {
    addPartial(speaker, text, tStart) {
      if (text === '') {
        if (partials.delete(speaker)) changed();
        return;
      }
      const now = clock();
      const existing = partials.get(speaker);
      const start = tStart ?? existing?.tStart ?? now;
      partials.set(speaker, {
        id: `partial-${speaker}`,
        speaker,
        text,
        tStart: start,
        tEnd: now,
        final: false,
        // A grey "You" line that is only the speakers' echo is hidden too (not counted: it is
        // counted once, when it becomes final).
        echo: speaker === 'you' && isEcho(text, themTextAround(start, now)),
        heldUntil: holdFor(speaker, existing?.heldUntil, existing !== undefined),
      });
      changed();
    },

    addFinal(line) {
      const partial = partials.get(line.speaker);
      partials.delete(line.speaker);
      if (line.speaker === 'them') lastThemFinalAt = clock();
      const echo =
        line.speaker === 'you' && isEcho(line.text, themTextAround(line.tStart, line.tEnd));
      const index = insertionIndex(finals, line.tStart);
      let stored: Utterance;

      // Merge only with the previous VISIBLE line (echo lines in between count as not there,
      // and stay where they are). The merged line keeps the earlier start, so its place holds.
      let previousIndex = index - 1;
      while (previousIndex >= 0 && finals[previousIndex]!.echo) previousIndex -= 1;
      const previous = finals[previousIndex];
      if (!echo && shouldMerge(previous, line)) {
        stored = mergeLines(previous!, line);
        finals = [...finals.slice(0, previousIndex), stored, ...finals.slice(previousIndex + 1)];
      } else {
        const heldUntil = holdFor(line.speaker, partial?.heldUntil, partial !== undefined);
        const created: Utterance = {
          id: `u${nextId++}`,
          ...line,
          final: true,
          ...(heldUntil !== undefined ? { heldUntil } : {}),
        };
        stored = echo ? markEcho(created) : created;
        finals = [...finals.slice(0, index), stored, ...finals.slice(index)];
      }

      // A "Them" line may reveal that a recent "You" line was its echo (the echo can be final
      // first, because both channels are decoded at the same time).
      if (line.speaker === 'them') {
        finals = finals.map((candidate) =>
          candidate.speaker === 'you' &&
          !candidate.echo &&
          candidate.tStart >= line.tStart - ECHO_WINDOW_BEFORE_MS &&
          candidate.tStart <= line.tEnd + ECHO_WINDOW_AFTER_MS &&
          isEcho(candidate.text, themTextAround(candidate.tStart, candidate.tEnd))
            ? markEcho(candidate)
            : candidate,
        );
      }
      changed();
      return stored;
    },

    refineFinal(id, heard, refined) {
      const index = finals.findIndex((line) => line.id === id);
      const line = finals[index];
      const text = refined.trim();
      if (!line || heard === '' || text === '') return false;
      const at = line.text.lastIndexOf(heard);
      if (at === -1) return false;
      const next = {
        ...line,
        text: line.text.slice(0, at) + text + line.text.slice(at + heard.length),
      };
      finals = [...finals.slice(0, index), next, ...finals.slice(index + 1)];
      changed();
      return true;
    },

    lines() {
      return snapshot;
    },

    displayLines() {
      return displaySnapshot;
    },

    allLines() {
      return finals;
    },

    window(minutes, now = clock()) {
      const since = now - minutes * 60_000;
      return snapshot.filter((line) => line.tEnd >= since);
    },

    echoStats() {
      return echoes;
    },

    clear() {
      finals = [];
      partials.clear();
      lastThemFinalAt = null;
      echoes = { count: 0, lastAt: null };
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
