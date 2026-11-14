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
import { isShortAnswer } from '../stt/noiseLine';
import { NON_ENGLISH_TEXT } from '../stt/language';
import { isBlip } from './blip';
import {
  ECHO_ORIGINAL_LEAD_MS,
  ECHO_SHORT_WINDOW_MS,
  ECHO_TINY_WINDOW_MS,
  ECHO_WINDOW_AFTER_MS,
  ECHO_WINDOW_BEFORE_MS,
  isEcho,
  isReverseEcho,
  REVERSE_ECHO_MAX_DELAY_MS,
  REVERSE_ECHO_MIN_DELAY_MS,
  type ThemAround,
} from './echo';
import { mergeLines, otherSpeakerBetween, shouldMerge } from './merge';

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

/** ADR-0076: what the transcript shows where a channel's audio was lost (rule 8). */
export const AUDIO_GAP_TEXT = '[audio gap]';

/**
 * ADR-0076 (E3 rule 3): one stretch of speech inside a line, with its own capture times. A line joined from
 * several finals keeps each one, so "the speech after the last answered moment" can be told apart even when
 * a new question joined an answered line.
 */
export interface Segment {
  /** Its words. Never logged. */
  text: string;
  /** Start (Unix ms, capture time). */
  tStart: number;
  /** End (Unix ms, capture time). */
  tEnd: number;
}

/** One line of the transcript. */
export interface Utterance {
  /**
   * Stable id ('u1', 'u2', …). 1.5.2 (ADR-0070): one id per spoken line from its first grey words to its
   * final line, so an answer to grey words is an answer to the line they become (before, every grey line
   * was 'partial-you' / 'partial-them', and an answered grey line made every later one look answered).
   */
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
   * True for a hidden line: a "You" line that only echoes "Them" through the speakers (echo.ts),
   * and since v1.4 also a "Them" line that is the user's own voice coming back, or a one-word "You"
   * noise while "Them" speaks (see hiddenAs). Hidden lines are left out of lines() and window(), and
   * never saved.
   */
  echo?: boolean;
  /** v1.4 (ADR-0062): why a line is hidden: speaker echo, the user's own echo on "Them", or noise. */
  hiddenAs?: 'echo' | 'you-echo' | 'noise';
  /** v1.4: speech in another language; its text is "[non-English speech]" (core/stt/language.ts). */
  nonEnglish?: boolean;
  /**
   * v1.4: true while the desktop's accurate engine is still rewriting this line (refine.ts), so
   * auto-answer can wait a moment for the better words.
   */
  refining?: boolean;
  /**
   * v1.4 (ADR-0065): how likely the speaker had finished when this line ended, from the end-of-turn
   * model (0…1), or 'pending' while it is being judged. Absent when there is no judgment.
   */
  turnEnd?: number | 'pending';
  /**
   * 1.5.2 (ADR-0070): on a grey line, the pause the speech worker heard while its words showed: when the
   * voice stopped, the end-of-turn model's judgment ('pending' while it runs), and the words at that
   * moment. It lasts until the voice comes back (clearPause): the model often writes the last word or two
   * a moment after the pause, from audio before it (measured on the real call of 11 Nov 2026: 0.1–0.5 s).
   */
  pause?: {
    /**
     *
     */
    speechEnd: number; /**
     *
     */
    turnEnd: number | 'pending'; /**
     *
     */
    text: string;
  };
  /**
   * 1.5.2 (ADR-0070): the punctuation model's reading of these exact words (marks and capitals), made at a
   * pause or as the line became final, before the shown words get their own marks (the accurate engine
   * takes about 2 s). The question rules read it (readableLine), so "…fast enough could AI voice agents
   * help" is a question a second sooner. Dropped when the words change.
   */
  punctuated?: string;
  /**
   * ADR-0076 (E3 rule 3): the stretches this line was joined from, oldest first; absent for a line that
   * was never joined (its only segment is the line itself).
   */
  segments?: Segment[];
  /**
   * ADR-0076: the speech engine itself said the speaker finished here (Deepgram Flux EndOfTurn), so
   * auto-answer does not wait for a pause of its own.
   */
  engineTurnEnd?: boolean;
  /** ADR-0076 (E3 rule 8): this line marks lost audio (its text is AUDIO_GAP_TEXT); never a question. */
  gap?: boolean;
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
   * @param tEnd    ADR-0076 (one clock): when the words last changed (Unix ms, capture time); absent:
   *                the transcript's clock now (the on-device engine before ADR-0076).
   */
  addPartial(speaker: Speaker, text: string, tStart: number | null, tEnd?: number): void;
  /**
   * Adds a finished line and removes that speaker's partial line. A "You" line is checked for
   * echo first; a "Them" line also re-checks the "You" lines of the last few seconds (the echo
   * can arrive before the original is final). Close lines merge (merge.ts), ignoring echoes.
   *
   * @returns The line as stored (new or merged).
   */
  addFinal(line: {
    speaker: Speaker;
    text: string;
    tStart: number;
    tEnd: number;
    /** v1.4: the line is another language (core/stt/language.ts); it is stored as NON_ENGLISH_TEXT. */
    nonEnglish?: boolean;
    /** ADR-0076: the speech engine's own end of turn ended this line (Flux EndOfTurn). */
    endOfTurn?: boolean;
  }): Utterance;
  /**
   * ADR-0076 (E3 rule 8): a channel's audio was lost between two moments: a final line reading
   * AUDIO_GAP_TEXT marks it (never joined to other lines, never a question).
   *
   * @param speaker Whose audio.
   * @param tStart  Start of the loss (Unix ms, capture time).
   * @param tEnd    End of the loss.
   */
  noteGap(speaker: Speaker, tStart: number, tEnd: number): void;
  /**
   * v1.4: marks a final line as being rewritten by the accurate engine, or done (refine.ts).
   *
   * @param id The line's id.
   * @param on True while the rewrite runs.
   */
  setRefining(id: string, on: boolean): void;
  /**
   * v1.4 (ADR-0065): records the end-of-turn model's judgment of a final line ('pending' while it runs,
   * null to clear it when it failed).
   *
   * @param id    The line's id.
   * @param value The probability that the speaker finished, 'pending', or null.
   */
  setTurnEnd(id: string, value: number | 'pending' | null): void;
  /**
   * 1.5.2 (ADR-0070): the speech worker heard the speaker stop while their grey line shows: records the
   * pause on that line, judgment pending.
   *
   * @param speaker   Who paused.
   * @param speechEnd When the voice stopped (Unix ms, capture time).
   */
  notePause(speaker: Speaker, speechEnd: number): void;
  /**
   * 1.5.2: the end-of-turn model's judgment of a pause (notePause), when the grey line still shows the same
   * words; otherwise nothing changes.
   *
   * @param speaker   Who paused.
   * @param speechEnd The pause's end of speech, as passed to notePause.
   * @param value     The probability that the speaker finished, or null when it failed (then removed).
   */
  setPauseTurn(speaker: Speaker, speechEnd: number, value: number | null): void;
  /**
   * 1.5.2 (ADR-0070): records the punctuation model's reading of a line's words (a final line, or the
   * current grey line with this id), when the line still has exactly those words.
   *
   * @param id         The line's id.
   * @param words      The words that were punctuated.
   * @param punctuated The punctuated words.
   */
  setPunctuated(id: string, words: string, punctuated: string): void;
  /**
   * 1.5.2 (ADR-0070): the speaker's voice came back after a pause: the grey line is no longer paused.
   *
   * @param speaker Who went on.
   */
  clearPause(speaker: Speaker): void;
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
   * 1.5.2 (ADR-0070): the id a line has now. A grey line keeps its id when it becomes final, unless it
   * joined the line before it; then its id leads to that line.
   *
   * @param id Any id this transcript gave out.
   * @returns The id of the line holding those words now (the same id when it was not joined).
   */
  resolveId(id: string): string;
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
 * 1.5.2 (ADR-0070): a line as the question rules read it: with the punctuation model's marks when the shown
 * words do not have their own yet.
 *
 * @param line A line.
 * @returns The line, its text replaced by its punctuated reading when there is one.
 * Called from: core/answer/autoAnswer.ts, core/answer/pressQuestion.ts
 */
export function readableLine(line: Utterance): Utterance {
  if (!line.punctuated || line.punctuated === line.text) return line;
  return {
    ...line,
    text: line.punctuated,
    // Its pause, with the words as they read now.
    ...(line.pause ? { pause: { ...line.pause, text: line.punctuated } } : {}),
  };
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
  /** 1.5.2: grey lines' ids that joined an earlier line, to that line's id. */
  const aliases = new Map<string, string>();
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
   * @param before How far before the line to look (default ECHO_WINDOW_BEFORE_MS).
   * @param after  How far after the line to look (default ECHO_WINDOW_AFTER_MS).
   * @returns The text, joined with spaces.
   */
  const themTextAround = (
    tStart: number,
    tEnd: number,
    before = ECHO_WINDOW_BEFORE_MS,
    after = ECHO_WINDOW_AFTER_MS,
  ): string => {
    const from = tStart - before;
    const to = tEnd + after;
    // v1.4: a hidden "Them" line (the user's own echo) is never the original of a "You" line, nor is
    // one that began after the "You" line did (ECHO_ORIGINAL_LEAD_MS for timing): a speaker echo comes
    // after its original, and a "Them" line that starts later is rather the user's voice coming back
    // (measured on the synthetic reverse-echo call, ADR-0063).
    const latestStart = tStart + ECHO_ORIGINAL_LEAD_MS;
    const them = finals.filter(
      (line) =>
        line.speaker === 'them' &&
        !line.echo &&
        line.tEnd >= from &&
        line.tStart <= to &&
        line.tStart <= latestStart,
    );
    const partial = partials.get('them');
    if (partial && !partial.echo && partial.tEnd >= from && partial.tStart <= latestStart) {
      them.push(partial);
    }
    return them
      .sort((a, b) => a.tStart - b.tStart)
      .map((line) => line.text)
      .join(' ');
  };

  /**
   * Whether "Them" was speaking for the whole of a time span (a final or the open line covers it),
   * allowing 200 ms either side for the two channels' timing.
   *
   * @param tStart Start of the span.
   * @param tEnd   End of the span.
   * @returns True when the span lies inside "Them" speech.
   */
  const insideThem = (tStart: number, tEnd: number): boolean => {
    const them = finals.filter((line) => line.speaker === 'them' && !line.echo);
    const partial = partials.get('them');
    if (partial && !partial.echo) them.push(partial);
    return them.some((line) => line.tStart <= tStart + 200 && line.tEnd >= tEnd - 200);
  };

  /**
   * What "Them" said around a "You" line, at every distance the echo rules use (echo.ts).
   *
   * @param tStart Start of the "You" line.
   * @param tEnd   End of the "You" line.
   * @returns The texts, and whether the line lies inside "Them" speech.
   */
  const themAround = (tStart: number, tEnd: number): ThemAround => ({
    wide: themTextAround(tStart, tEnd),
    near: themTextAround(tStart, tEnd, ECHO_SHORT_WINDOW_MS, ECHO_SHORT_WINDOW_MS),
    tiny: themTextAround(tStart, tEnd, ECHO_TINY_WINDOW_MS, ECHO_TINY_WINDOW_MS),
    inside: insideThem(tStart, tEnd),
  });

  /**
   * Whether a "You" line is the speakers' echo of what "Them" said around it.
   *
   * @param text   The line's words.
   * @param tStart Its start.
   * @param tEnd   Its end.
   * @returns True for an echo.
   */
  const echoOfThem = (text: string, tStart: number, tEnd: number): boolean =>
    isEcho(text, themAround(tStart, tEnd));

  /**
   * v1.4: whether a "Them" line is the user's own voice coming back (echo.ts isReverseEcho): it repeats
   * what the user said just before it.
   *
   * @param text   The "Them" line's words.
   * @param tStart Its start.
   * @param tEnd   Its end (now, for a line still being heard).
   * @returns True when it is the user's echo.
   */
  const echoOfYou = (text: string, tStart: number, tEnd: number): boolean => {
    const you = finals.filter(
      (line) =>
        line.speaker === 'you' &&
        !line.echo &&
        line.tStart <= tStart - REVERSE_ECHO_MIN_DELAY_MS &&
        line.tEnd >= tStart - REVERSE_ECHO_MAX_DELAY_MS,
    );
    const partial = partials.get('you');
    if (partial && !partial.echo && partial.tStart <= tStart - REVERSE_ECHO_MIN_DELAY_MS) {
      you.push(partial);
    }
    const youText = you
      .sort((a, b) => a.tStart - b.tStart)
      .map((line) => line.text)
      .join(' ');
    // Overlapping the user's own speech, a weaker match is enough (echo.ts REVERSE_ECHO_INSIDE_SCORE).
    const inside = you.some((line) => line.tEnd >= tStart);
    // A network echo also ends after the user's words do; a line the speakers leaked onto the
    // microphone ends with its original (measured on the synthetic speakers call, ADR-0063).
    const youEnd = Math.max(...you.filter((line) => line.final).map((line) => line.tEnd));
    if (Number.isFinite(youEnd) && tEnd < youEnd + REVERSE_ECHO_MIN_DELAY_MS) return false;
    return isReverseEcho(text, youText, inside);
  };

  /**
   * v1.4: whether a one-word "Them" line is noise heard while the user speaks (the tail of the user's
   * own echo, a click on the line): not a real short answer, and inside "You" speech.
   *
   * @param text   The line's words.
   * @param tStart Its start.
   * @param tEnd   Its end.
   * @returns True to hide it as noise.
   */
  const noiseDuringYou = (text: string, tStart: number, tEnd: number): boolean => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 1 || isShortAnswer(words[0]!)) return false;
    const you = finals.filter((line) => line.speaker === 'you' && !line.echo);
    const partial = partials.get('you');
    if (partial && !partial.echo) you.push(partial);
    return you.some((line) => line.tStart <= tStart + 200 && line.tEnd >= tEnd - 200);
  };

  /**
   * v1.4: whether a one-word "You" line is noise heard while "Them" speaks: not a real short answer
   * ("yes", "okay"), and inside "Them" speech.
   *
   * @param text   The line's words.
   * @param tStart Its start.
   * @param tEnd   Its end.
   * @returns True to hide it as noise.
   */
  const noiseDuringThem = (text: string, tStart: number, tEnd: number): boolean => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    return words.length === 1 && !isShortAnswer(words[0]!) && insideThem(tStart, tEnd);
  };

  /**
   * Marks a final line as hidden, and counts speaker echoes for the "Hiding echo" notice.
   *
   * @param line The final line.
   * @param why  Why it is hidden (default: speaker echo).
   * @returns A copy of the line with echo: true (the original is not changed).
   */
  const markEcho = (
    line: Utterance,
    why: NonNullable<Utterance['hiddenAs']> = 'echo',
  ): Utterance => {
    if (why === 'echo') {
      echoes = { count: echoes.count + 1, lastAt: Math.max(echoes.lastAt ?? 0, line.tEnd) };
    }
    return { ...line, echo: true, hiddenAs: why };
  };

  /**
   * Why a new final line should be hidden, if it should.
   *
   * @param line The new line.
   * @returns The reason, or null to show it.
   */
  const hideReason = (line: {
    speaker: Speaker;
    text: string;
    tStart: number;
    tEnd: number;
  }): Utterance['hiddenAs'] | null => {
    if (line.speaker === 'you') {
      if (echoOfThem(line.text, line.tStart, line.tEnd)) return 'echo';
      if (noiseDuringThem(line.text, line.tStart, line.tEnd)) return 'noise';
      return null;
    }
    if (echoOfYou(line.text, line.tStart, line.tEnd)) return 'you-echo';
    return noiseDuringYou(line.text, line.tStart, line.tEnd) ? 'noise' : null;
  };

  /**
   * The same speaker's latest visible final before an index, looking past the other person's blips
   * ("okay", "um": blip.ts) and hidden lines, but not past anything the other person really said.
   *
   * @param index   Where the new line goes.
   * @param speaker Who said the new line.
   * @returns That line's index, or -1 when there is none to join.
   */
  const joinableIndex = (index: number, speaker: Speaker): number => {
    for (let at = index - 1; at >= 0; at -= 1) {
      const candidate = finals[at]!;
      if (candidate.echo) continue;
      if (candidate.speaker === speaker) return at;
      if (!isBlip(candidate.text)) return -1;
    }
    return -1;
  };

  return {
    addPartial(speaker, text, tStart, tEnd) {
      if (text === '') {
        if (partials.delete(speaker)) changed();
        return;
      }
      // ADR-0076 (one clock): the capture time of the words when the engine gives it.
      const now = tEnd ?? clock();
      const existing = partials.get(speaker);
      const start = tStart ?? existing?.tStart ?? now;
      partials.set(speaker, {
        // 1.5.2 (ADR-0070): a line's id is given with its first grey words and kept by its final line.
        id: existing?.id ?? `u${nextId++}`,
        speaker,
        text,
        tStart: start,
        tEnd: Math.max(start, now),
        final: false,
        // A grey "You" line that is only the speakers' echo is hidden too (not counted: it is
        // counted once, when it becomes final); v1.4: so is a grey "Them" line that is the
        // user's own voice coming back.
        echo: speaker === 'you' ? echoOfThem(text, start, now) : echoOfYou(text, start, now),
        heldUntil: holdFor(speaker, existing?.heldUntil, existing !== undefined),
        // 1.5.2: a pause holds until the voice comes back (clearPause), not when late words arrive.
        ...(existing?.pause ? { pause: existing.pause } : {}),
        ...(existing?.punctuated && existing.text === text
          ? { punctuated: existing.punctuated }
          : {}),
      });
      changed();
    },

    notePause(speaker, speechEnd) {
      const partial = partials.get(speaker);
      if (!partial) return;
      partials.set(speaker, {
        ...partial,
        pause: { speechEnd, turnEnd: 'pending', text: partial.text },
      });
      changed();
    },

    clearPause(speaker) {
      const partial = partials.get(speaker);
      if (!partial?.pause) return;
      const { pause: _gone, ...rest } = partial;
      void _gone;
      partials.set(speaker, rest);
      changed();
    },

    setPunctuated(id, words, punctuated) {
      const text = punctuated.trim();
      if (text === '') return;
      for (const [speaker, partial] of partials) {
        if (partial.id === id && partial.text === words) {
          partials.set(speaker, { ...partial, punctuated: text });
          changed();
          return;
        }
      }
      const index = finals.findIndex((line) => line.id === id);
      const line = finals[index];
      if (!line || line.text !== words) return;
      finals = [
        ...finals.slice(0, index),
        { ...line, punctuated: text },
        ...finals.slice(index + 1),
      ];
      changed();
    },

    setPauseTurn(speaker, speechEnd, value) {
      const partial = partials.get(speaker);
      if (!partial?.pause || partial.pause.speechEnd !== speechEnd) return;
      if (value === null) {
        const { pause: _dropped, ...rest } = partial;
        void _dropped;
        partials.set(speaker, rest);
      } else {
        partials.set(speaker, { ...partial, pause: { ...partial.pause, turnEnd: value } });
      }
      changed();
    },

    addFinal(input) {
      const partial = partials.get(input.speaker);
      partials.delete(input.speaker);
      if (input.speaker === 'them') lastThemFinalAt = clock();
      // v1.4: another language is stored as its mark, so the screen, the saved lines and Claude
      // all read "[non-English speech]" instead of English words the model made up.
      const line = {
        speaker: input.speaker,
        text: input.nonEnglish ? NON_ENGLISH_TEXT : input.text,
        tStart: input.tStart,
        tEnd: input.tEnd,
        ...(input.nonEnglish ? { nonEnglish: true } : {}),
        ...(input.endOfTurn ? { endOfTurn: true } : {}),
      };
      const hidden = input.nonEnglish ? null : hideReason(line);
      const index = insertionIndex(finals, line.tStart);
      let stored: Utterance;

      // Merge with the same speaker's previous visible line, looking past hidden lines and (v1.4)
      // the other person's blips; those stay where they are. The merged line keeps the earlier
      // start, so its place holds.
      const previousIndex = joinableIndex(index, line.speaker);
      const previous = previousIndex === -1 ? undefined : finals[previousIndex];
      // Batch D (P1-D): never across the other speaker's real line that ended between the two.
      if (!hidden && shouldMerge(previous, line) && !otherSpeakerBetween(finals, previous!, line)) {
        stored = mergeLines(previous!, line);
        finals = [...finals.slice(0, previousIndex), stored, ...finals.slice(previousIndex + 1)];
        // 1.5.2: the grey line's words are now in the earlier line.
        if (partial && partial.id !== stored.id) aliases.set(partial.id, stored.id);
      } else {
        const heldUntil = holdFor(line.speaker, partial?.heldUntil, partial !== undefined);
        const { endOfTurn, ...fields } = line;
        const created: Utterance = {
          // 1.5.2 (ADR-0070): the id its grey words had, so an answer to them is an answer to this line.
          id: partial?.id ?? `u${nextId++}`,
          ...fields,
          ...(endOfTurn ? { engineTurnEnd: true } : {}),
          final: true,
          ...(heldUntil !== undefined ? { heldUntil } : {}),
        };
        stored = hidden ? markEcho(created, hidden) : created;
        finals = [...finals.slice(0, index), stored, ...finals.slice(index)];
      }

      // A "Them" line may reveal that a recent "You" line was its echo (the echo can be final
      // first, because both channels are decoded at the same time), or that a one-word "You"
      // line was noise heard while it spoke.
      if (line.speaker === 'them') {
        finals = finals.map((candidate) => {
          if (
            candidate.speaker !== 'you' ||
            candidate.echo ||
            candidate.nonEnglish ||
            candidate.tStart < line.tStart - ECHO_WINDOW_BEFORE_MS ||
            candidate.tStart > line.tEnd + ECHO_WINDOW_AFTER_MS
          ) {
            return candidate;
          }
          // "Inside their speech" is judged on the stretch just heard, not on a line it joined: a
          // joined line spans the pause in which the user may have really replied.
          const inside = line.tStart <= candidate.tStart + 200 && line.tEnd >= candidate.tEnd - 200;
          const around = { ...themAround(candidate.tStart, candidate.tEnd), inside };
          if (isEcho(candidate.text, around)) return markEcho(candidate);
          const words = candidate.text.trim().split(/\s+/).filter(Boolean);
          return inside && words.length === 1 && !isShortAnswer(words[0]!)
            ? markEcho(candidate, 'noise')
            : candidate;
        });
      } else {
        // v1.4: a "You" line may reveal that a "Them" line just after it was the user's own echo, or
        // that a one-word "Them" line was noise heard while the user spoke.
        finals = finals.map((candidate) => {
          if (candidate.speaker !== 'them' || candidate.echo || candidate.nonEnglish)
            return candidate;
          if (
            candidate.tStart >= line.tStart + REVERSE_ECHO_MIN_DELAY_MS &&
            candidate.tStart <= line.tEnd + REVERSE_ECHO_MAX_DELAY_MS &&
            echoOfYou(candidate.text, candidate.tStart, candidate.tEnd)
          ) {
            return markEcho(candidate, 'you-echo');
          }
          return noiseDuringYou(candidate.text, candidate.tStart, candidate.tEnd)
            ? markEcho(candidate, 'noise')
            : candidate;
        });
      }
      changed();
      return stored;
    },

    noteGap(speaker, tStart, tEnd) {
      const gapLine: Utterance = {
        id: `u${nextId++}`,
        speaker,
        text: AUDIO_GAP_TEXT,
        tStart,
        tEnd: Math.max(tStart, tEnd),
        final: true,
        gap: true,
      };
      finals = [
        ...finals.slice(0, insertionIndex(finals, tStart)),
        gapLine,
        ...finals.slice(insertionIndex(finals, tStart)),
      ];
      changed();
    },

    setRefining(id, on) {
      const index = finals.findIndex((line) => line.id === id);
      const line = finals[index];
      if (!line || Boolean(line.refining) === on) return;
      const next: Utterance = { ...line };
      if (on) next.refining = true;
      else delete next.refining;
      finals = [...finals.slice(0, index), next, ...finals.slice(index + 1)];
      changed();
    },

    setTurnEnd(id, value) {
      const index = finals.findIndex((line) => line.id === id);
      const line = finals[index];
      if (!line) return;
      const next: Utterance = { ...line };
      if (value === null) delete next.turnEnd;
      else next.turnEnd = value;
      finals = [...finals.slice(0, index), next, ...finals.slice(index + 1)];
      changed();
    },

    refineFinal(id, heard, refined) {
      const index = finals.findIndex((line) => line.id === id);
      const line = finals[index];
      const text = refined.trim();
      // Another language keeps its mark: a second pass in English cannot write it either.
      if (!line || line.nonEnglish || heard === '' || text === '') return false;
      const at = line.text.lastIndexOf(heard);
      if (at === -1) return false;
      const next = {
        ...line,
        text: line.text.slice(0, at) + text + line.text.slice(at + heard.length),
      };
      // 1.5.2: the shown words now have their own marks.
      delete next.punctuated;
      finals = [...finals.slice(0, index), next, ...finals.slice(index + 1)];
      changed();
      return true;
    },

    lines() {
      return snapshot;
    },

    resolveId(id) {
      let current = id;
      // A chain is short (a grey line joins a line that may itself have joined one); the limit guards a loop.
      for (let hops = 0; hops < 20; hops += 1) {
        const next = aliases.get(current);
        if (next === undefined || next === current) return current;
        current = next;
      }
      return current;
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
      aliases.clear();
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
