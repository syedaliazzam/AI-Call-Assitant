/**
 * File: apps/web/src/core/answer/newestQuestion.ts
 * Purpose: The question rules for calls with cloud transcription (ADR-0076, investigation E3 rules 1–9).
 *          A key press or an auto-answer answers the newest unanswered speech of the other person, by time:
 *          1. One clock: every line and segment carries capture times (transcript.ts, cloudStt.ts).
 *          2. Caught up first: the caller waits (at most CATCH_UP_CAP_MS) before calling chooseNewest().
 *          3. Newest by time: all "Them" speech that starts after the newest answered speech ended (and
 *             after the user's last real reply), kept per segment even when lines joined. Exactly those
 *             words are sent.
 *          4. No look-back: unanswered speech is sent even when it reads as a statement (Claude's "none"
 *             reply handles it); an earlier card is shown only when nothing new was said since.
 *          5. A reply is a finished "You" line of more than two words that did not start over the other
 *             person (question.ts lastReplyIndex, unchanged).
 *          6. Completeness: when the asked speech goes on within REASK_WINDOW_MS (any new word), it is asked
 *             again. Batch D (P0-B, ADR-0079): measured from the card's ORIGINAL answer (a re-ask never moves
 *             the anchor), at most MAX_REASKS times per card, never past a question of its own after a
 *             NEW_QUESTION_GAP_MS pause, and with auto-answer off only for a press on grey words (D1). P0-C:
 *             the decision says whether the added words only finish the same sentence (then the same card)
 *             or not (then a new card; useLiveAnswers.ts).
 *          7. Feedback: every press ends in a card, "Showing the earlier answer", "Already answering", or
 *             "Nothing new to answer" (useLiveAnswers.ts). Batch D (P1-G): the caller passes the end of the
 *             speech answered on cards of their own (re-asks excluded), so speech a re-ask took in is
 *             answered on its own card when pressed for.
 *          8. Gaps: Batch D (P1-G): lost audio never stops a press: the newest words are answered (around the
 *             gap when nothing came after it) and the card notes that part of their audio was lost. Only with
 *             no words of theirs at all does the press say so instead.
 *          9. Auto-answer uses the same window, at the engine's own end of turn (Flux EndOfTurn), and answers
 *             a question once (plus the rule-6 re-ask).
 * Used by: src/features/live/useLiveAnswers.ts, src/features/live/useAutoAnswer.ts
 * Depends on: src/core/answer/autoAnswer.ts (isAutoQuestion, the pause and age rules),
 *             src/core/transcript (question.ts lastReplyIndex, blip.ts, questionKind.ts, transcript.ts)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md E3; ADR-0076
 *
 * Pure: the caller passes the lines, what was answered and the time. Text is never logged.
 */
import {
  MAX_PRESS_WINDOW_ITEMS,
  MAX_PRESS_WINDOW_WORDS,
  PRESS_WINDOW_MS,
  type Speaker,
} from '@kite/shared';
import { isBlip } from '../transcript/blip';
import { looksUnfinished } from '../transcript/complete';
import { lastReplyIndex } from '../transcript/question';
import { lineKind } from '../transcript/questionKind';
import { readableLine, type Segment, type Utterance } from '../transcript/transcript';
import {
  AFTER_STREAM_GRACE_MS,
  AUTO_MAX_AGE_MS,
  AUTO_PAUSE_MS,
  isAutoQuestion,
  NEW_QUESTION_GAP_MS,
  STALE_PARTIAL_MS,
  UNFINISHED_PAUSE_MS,
  type AnsweredQuestion,
} from './autoAnswer';

/**
 * Rule 2: the longest a press waits for the other side to be transcribed up to the press, ms. ADR-0132: a
 * press no longer waits (it answers at once with the words there are, and is updated once when the other
 * person goes on); the constant stays for the cloud engine's catchUp() and the voice question.
 */
export const CATCH_UP_CAP_MS = 300;

/**
 * ADR-0132: the other person counts as still speaking at a press when their newest words ended less than
 * this long before it (speech recognition is about a second behind) or are still grey, ms.
 */
export const SPEAKING_GAP_MS = 2_000;

/**
 * ADR-0132: a press made while the other person was speaking is updated once when they went on: their new
 * words must start within this long after the press, ms (later words are the next question: press again).
 */
export const PRESS_UPDATE_START_MS = 2_000;

/** ADR-0132: the update must be due (their turn over) within this long after the press, or it is dropped, ms. */
export const PRESS_UPDATE_MAX_MS = 8_000;

/**
 * ADR-0133: a stretch that began before the window and goes on into it is included (its words from the
 * window's start, by time) only when at least this much of it is inside the window, ms.
 */
const STRADDLE_MIN_MS = 1_000;

/** Rule 7 / G2: "Finishing the question…" shows only when the wait lasts longer than this, ms. */
export const FINISHING_NOTICE_AFTER_MS = 150;

/** Rule 6: speech that goes on within this long after the asked speech ended is asked again, ms. */
export const REASK_WINDOW_MS = 2_000;

/** Rule 6: one new word is enough to ask again (it was two before ADR-0076). */
export const REASK_WORDS = 1;

/** At most this many words are sent (the newest), so a long monologue stays a reasonable request. */
export const MAX_NEWEST_WORDS = 200;

/**
 * Batch D (P0-B, ADR-0079): how many times one card's question is asked again. The 14 Nov call re-asked
 * one card ten times in two minutes (each re-ask moved the window forward); one is enough to complete a
 * question the engine ended early.
 */
export const MAX_REASKS = 1;

/**
 * Batch D (P1-G): with nothing new after lost audio, a press answers the other person's words that ended
 * at most this long before the gap started (the newest words around it), ms. Matches the 10 s ring buffer
 * the cloud engine keeps per channel.
 */
export const GAP_CONTEXT_MS = 10_000;

/** The speech one answer covered (capture clock, Unix ms). */
export interface AnsweredSpeech {
  /** Start of its first segment. */
  start: number;
  /** End of its last segment. */
  end: number;
}

/** A stretch of the other person's speech with the line it is in. */
export interface Candidate {
  /** The line's id. */
  lineId: string;
  /** Whether the line is still grey. */
  grey: boolean;
  /** The stretch. */
  segment: Segment;
}

/**
 * The lines that can hold a question or a reply: with words, English, not a mark of lost audio.
 *
 * @param lines The visible lines.
 * @returns Those lines.
 */
function spokenLines(lines: readonly Utterance[]): Utterance[] {
  return lines
    .map(readableLine)
    .filter((line) => line.text.trim() !== '' && !line.nonEnglish && !line.gap);
}

/**
 * A line's segments: its joined stretches, or the line itself (with its punctuated reading).
 *
 * @param line A readable line.
 * @returns The segments, oldest first.
 * Called from: this file's rules; ownQuestion.ts chooseOwnQuestion() (ADR-0123: the user's words after the last
 *              answered moment); tests
 */
export function segmentsOf(line: Utterance): Segment[] {
  return line.segments && line.segments.length > 1
    ? line.segments
    : [{ text: line.text, tStart: line.tStart, tEnd: line.tEnd }];
}

/**
 * Whether a stretch is only listening ("okay", "mm-hm") and not a short question ("Why Go?").
 *
 * @param text The stretch's words.
 * @returns True to leave it out.
 */
function onlyListening(text: string): boolean {
  return isBlip(text) && lineKind(text) !== 'question';
}

/**
 * Rule 5: when the user's last real reply started, or -Infinity when there is none.
 *
 * @param spoken The spoken lines (spokenLines()).
 * @returns The reply's start (capture clock).
 * Called from: unansweredSpeech(), chooseNewest()
 */
function replyStartOf(spoken: readonly Utterance[]): number {
  const reply = lastReplyIndex(spoken);
  return reply === -1 ? Number.NEGATIVE_INFINITY : spoken[reply]!.tStart;
}

/**
 * Rules 3 and 5: the other person's unanswered speech, by time.
 *
 * @param lines       The visible lines (noise left out by the caller).
 * @param answeredEnd The end of the newest answered speech, or null before any answer.
 * @returns The stretches after it (and after the user's last reply), oldest first.
 * Called from: chooseNewest(), autoNewestDue(); tests
 */
export function unansweredSpeech(
  lines: readonly Utterance[],
  answeredEnd: number | null,
): Candidate[] {
  const spoken = spokenLines(lines);
  const from = Math.max(answeredEnd ?? Number.NEGATIVE_INFINITY, replyStartOf(spoken));
  const result: Candidate[] = [];
  for (const line of spoken) {
    if (line.speaker !== 'them') continue;
    for (const segment of segmentsOf(line)) {
      // A stretch that began before the boundary was answered (or replied to); its later words are the
      // rule-6 re-ask's business, not a new question.
      if (segment.tStart < from || onlyListening(segment.text)) continue;
      result.push({ lineId: line.id, grey: !line.final, segment });
    }
  }
  return result;
}

/**
 * The newest words as one question.
 *
 * @param candidates Unanswered stretches, oldest first.
 * @returns Text (at most MAX_NEWEST_WORDS, the newest), line ids, span, grey flag and word count.
 */
function asQuestion(candidates: readonly Candidate[]): {
  text: string;
  lineIds: string[];
  span: AnsweredSpeech;
  grey: boolean;
  words: number;
} {
  const words = candidates
    .map((candidate) => candidate.segment.text.trim())
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.slice(-MAX_NEWEST_WORDS);
  return {
    text: kept.join(' '),
    lineIds: [...new Set(candidates.map((candidate) => candidate.lineId))],
    span: {
      start: Math.min(...candidates.map((candidate) => candidate.segment.tStart)),
      end: Math.max(...candidates.map((candidate) => candidate.segment.tEnd)),
    },
    grey: candidates.some((candidate) => candidate.grey),
    words: kept.length,
  };
}

/** ADR-0133: one stretch of a press's window, on the capture clock. */
export interface WindowStretch {
  /** Who spoke. */
  speaker: Speaker;
  /** The words. Never logged. */
  text: string;
  /** When it started (capture clock, Unix ms). */
  tStart: number;
  /** When it ended (capture clock, Unix ms). */
  tEnd: number;
  /** True when some of it was still grey. */
  live: boolean;
}

/** ADR-0133: what was said since the last answer, both sides, as a press sends it. */
export interface PressWindow {
  /** Where it starts (capture clock): the end of the newest answered speech, at most PRESS_WINDOW_MS back. */
  from: number;
  /** The stretches, oldest first, same-speaker neighbours joined, the newest MAX_PRESS_WINDOW_WORDS words. */
  stretches: WindowStretch[];
  /** The other side's words in it (the newest MAX_NEWEST_WORDS), for the card and the document search. */
  themText: string;
  /** How many words of the other side it holds. */
  themWords: number;
  /** The other side's lines it draws on, oldest first. */
  themLineIds: string[];
  /** The other side's speech in it, or null when they said nothing in it. */
  themSpan: AnsweredSpeech | null;
  /** True when some of the other side's words were still grey. */
  grey: boolean;
  /** ADR-0132: the other side was still speaking at the press. */
  speaking: boolean;
}

/**
 * The words of a stretch from a time on: all of them when it starts there, the later share (by time) when
 * it began earlier, none when too little of it is after that time (ADR-0133). A long turn the engine keeps
 * as one stretch (a Flux turn of three minutes) is cut where the window starts, so the words answered
 * before are not sent as new.
 *
 * @param segment The stretch.
 * @param from    The window's start (capture clock).
 * @returns Its words from then on ('' for none).
 */
function wordsFrom(segment: Segment, from: number): string {
  if (segment.tStart >= from) return segment.text.trim();
  if (segment.tEnd - from < STRADDLE_MIN_MS) return '';
  const words = segment.text.trim().split(/\s+/).filter(Boolean);
  const share = (from - segment.tStart) / Math.max(1, segment.tEnd - segment.tStart);
  return words.slice(Math.round(words.length * share)).join(' ');
}

/**
 * ADR-0133: the window a key press sends: everything both sides said since the newest answered speech
 * ended (at most PRESS_WINDOW_MS back), so the model can find every open question in it and see which ones
 * the user already answered out loud. Listening sounds ("mm-hm") and lost-audio marks are left out; words
 * still grey are included (ADR-0132: a press never waits for them).
 *
 * @param lines       The visible lines (noise left out by the caller), in order.
 * @param answeredEnd The end of the newest speech answered on a card of its own, or null.
 * @param now         The press time (capture clock, Unix ms).
 * @returns The window.
 * Called from: chooseNewest(), pressUpdateDue(); useLiveAnswers.ts (legacy rules); tests
 */
export function pressWindow(
  lines: readonly Utterance[],
  answeredEnd: number | null,
  now: number,
): PressWindow {
  const from = Math.max(answeredEnd ?? Number.NEGATIVE_INFINITY, now - PRESS_WINDOW_MS);
  const raw: (WindowStretch & { lineId: string })[] = [];
  for (const line of spokenLines(lines)) {
    for (const segment of segmentsOf(line)) {
      if (segment.tEnd <= from) continue;
      const text = wordsFrom(segment, from);
      if (text === '' || onlyListening(text)) continue;
      raw.push({
        lineId: line.id,
        speaker: line.speaker,
        text,
        tStart: Math.max(segment.tStart, from),
        tEnd: segment.tEnd,
        live: !line.final,
      });
    }
  }
  // Time order across both sides (a stable sort keeps a line's own order).
  raw.sort((a, b) => a.tStart - b.tStart);
  const themRaw = raw.filter((stretch) => stretch.speaker === 'them');
  // Same-speaker neighbours read as one turn.
  const joined: WindowStretch[] = [];
  for (const { lineId: _lineId, ...stretch } of raw) {
    const previous = joined.at(-1);
    if (previous && previous.speaker === stretch.speaker) {
      previous.text = `${previous.text} ${stretch.text}`;
      previous.tEnd = Math.max(previous.tEnd, stretch.tEnd);
      previous.live ||= stretch.live;
    } else joined.push({ ...stretch });
  }
  // The newest MAX_PRESS_WINDOW_WORDS words and MAX_PRESS_WINDOW_ITEMS stretches (the oldest words go first).
  let budget = MAX_PRESS_WINDOW_WORDS;
  const kept: WindowStretch[] = [];
  for (const stretch of [...joined].reverse()) {
    if (budget <= 0 || kept.length >= MAX_PRESS_WINDOW_ITEMS) break;
    const words = stretch.text.split(/\s+/).filter(Boolean);
    kept.unshift({ ...stretch, text: words.slice(-budget).join(' ') });
    budget -= words.length;
  }
  const themWordList = themRaw
    .map((stretch) => stretch.text)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const newestThem = spokenLines(lines).findLast((line) => line.speaker === 'them');
  return {
    from,
    stretches: kept,
    themText: themWordList.slice(-MAX_NEWEST_WORDS).join(' '),
    themWords: themWordList.length,
    themLineIds: [...new Set(themRaw.map((stretch) => stretch.lineId))],
    themSpan:
      themRaw.length > 0
        ? {
            start: Math.min(...themRaw.map((stretch) => stretch.tStart)),
            end: Math.max(...themRaw.map((stretch) => stretch.tEnd)),
          }
        : null,
    grey: themRaw.some((stretch) => stretch.live),
    speaking:
      newestThem !== undefined && (!newestThem.final || now - newestThem.tEnd < SPEAKING_GAP_MS),
  };
}

/** What a press does (rules 3, 4, 7, 8). */
export type NewestChoice =
  | {
      /** Answer the newest unanswered speech. */
      kind: 'answer';
      /** Exactly these words are sent (never re-picked). Never logged. */
      text: string;
      /** The lines they are in, oldest first. */
      lineIds: string[];
      /** The speech's span (capture clock). */
      span: AnsweredSpeech;
      /** True when some of it is still grey. */
      grey: boolean;
      /** How many words were sent. */
      words: number;
      /** How many separate stretches it joins (for the trace). */
      segments: number;
      /**
       * Batch D (P1-G): part of their audio was lost around these words (the card says so in a small line).
       * The span then reaches the end of the gap, so the next press does not answer the same gap again.
       */
      audioLost?: boolean;
      /** ADR-0132: the window the press is watched with (device only; never sent). */
      window: PressWindow;
    }
  | {
      /** Nothing new since the last card: show it ("Showing the earlier answer" / "Already answering"). */
      kind: 'show-existing';
      /** That card. */
      answerId: string;
    }
  | {
      /** Batch D (P1-G): lost audio and no words of theirs near it to answer: say so. */
      kind: 'gap';
    }
  | {
      /** Nothing to answer at all. */
      kind: 'none';
    };

/** What chooseNewest() needs. */
export interface NewestInput {
  /** The visible lines (finals and grey), noise left out, in order. */
  lines: readonly Utterance[];
  /**
   * The end of the newest answered speech (capture clock), or null before any answer. Batch D (P1-G): for a
   * press, the speech answered on cards of their own (presses, auto-answers, re-asks on a new card): speech
   * a re-ask took into an earlier card's question counts as unanswered, so a press answers it.
   */
  answeredEnd: number | null;
  /** The newest card for speech in this call, or null. */
  lastAnswerId: string | null;
  /** ADR-0133: the press time (capture clock, Unix ms); the window reaches at most PRESS_WINDOW_MS back. */
  now: number;
}

/**
 * Batch D (P1-G): with only lost audio since the boundary, the other person's newest words around it: their
 * stretches since the user's last reply that ended at most GAP_CONTEXT_MS before the gap began, or after.
 *
 * @param lines The visible lines.
 * @param gap   The newest gap mark of theirs.
 * @returns The stretches, oldest first ([] when they said nothing near it).
 * Called from: chooseNewest()
 */
function aroundGap(lines: readonly Utterance[], gap: Utterance): Candidate[] {
  return unansweredSpeech(lines, null).filter(
    (candidate) => candidate.segment.tEnd >= gap.tStart - GAP_CONTEXT_MS,
  );
}

/**
 * Decides what a press answers, once the other side is caught up (rule 2 is the caller's).
 *
 * @param input See NewestInput.
 * @returns See NewestChoice.
 * Called from: useLiveAnswers.ts (press); tests
 */
export function chooseNewest(input: NewestInput): NewestChoice {
  const candidates = unansweredSpeech(input.lines, input.answeredEnd);
  // Rule 8 (Batch D, P1-G): their audio lost since the last answer (and since the user's last reply).
  const from = Math.max(
    input.answeredEnd ?? Number.NEGATIVE_INFINITY,
    replyStartOf(spokenLines(input.lines)),
  );
  const gap = input.lines.findLast(
    (line) => line.gap === true && line.speaker === 'them' && line.tEnd > from,
  );
  // The words to answer: the new ones, or with nothing new, the newest around the gap.
  const words = candidates.length > 0 ? candidates : gap ? aroundGap(input.lines, gap) : [];
  if (words.length > 0) {
    const question = asQuestion(words);
    // ADR-0132: the same stretch as the window the press is watched with (whether they were still speaking,
    // and how many of their words were sent). Only the device uses it; the request is production's.
    const window = pressWindow(input.lines, Math.min(from, question.span.start - 1), input.now);
    if (!gap) return { kind: 'answer', ...question, segments: words.length, window };
    return {
      kind: 'answer',
      ...question,
      // Reaches the gap's end, so a second press does not answer the same gap again.
      span: { start: question.span.start, end: Math.max(question.span.end, gap.tEnd) },
      segments: words.length,
      audioLost: true,
      window,
    };
  }
  if (gap) return { kind: 'gap' };
  if (input.lastAnswerId) return { kind: 'show-existing', answerId: input.lastAnswerId };
  return { kind: 'none' };
}

/** ADR-0132: a press made while the other person was still speaking, watched for one update. */
export interface PressWatch {
  /** The press's card. */
  answerId: string;
  /** When the key was pressed (capture clock, Unix ms). */
  pressedAt: number;
  /** The press window's start (capture clock), so the update reads the same window. */
  from: number;
  /** How many words of the other side the press sent. */
  themWords: number;
  /** When the other side's newest words sent with the press ended (capture clock). */
  themEnd: number;
}

/** ADR-0132: what to do with a watched press now. */
export type PressUpdate =
  | {
      /** Their turn is not over yet (or nothing new): look again later. */
      kind: 'wait';
    }
  | {
      /** No update: the user is speaking, the new words came too late, or the watch ran out. */
      kind: 'stop';
      /** Why (for the trace). */
      reason: 'user-spoke' | 'late' | 'expired';
    }
  | {
      /** Ask again once, on the same card, with the window as it is now. */
      kind: 'update';
      /** The window now. */
      window: PressWindow;
    };

/**
 * ADR-0132: whether a press made while the other person was speaking should be asked again now. A press
 * answers at once with the words there are; when the other person went on (their new words started within
 * PRESS_UPDATE_START_MS of the press) and their turn is now over, the card is asked once more with the
 * whole window, in place. Nothing happens once the user speaks (they may be reading the answer out), or
 * after PRESS_UPDATE_MAX_MS.
 *
 * @param watch The press.
 * @param lines The visible lines (noise left out), in order.
 * @param now   The current time (capture clock, Unix ms).
 * @returns See PressUpdate.
 * Called from: useLiveAnswers.ts (on each transcript change and a short timer while a press is watched); tests
 */
export function pressUpdateDue(
  watch: PressWatch,
  lines: readonly Utterance[],
  now: number,
): PressUpdate {
  if (now - watch.pressedAt > PRESS_UPDATE_MAX_MS) return { kind: 'stop', reason: 'expired' };
  const spoken = spokenLines(lines);
  // The user started speaking after the press: never change the answer under them.
  const userSpoke = spoken.some(
    (line) =>
      line.speaker === 'you' &&
      line.tStart >= watch.pressedAt &&
      line.text.trim().split(/\s+/).length >= 3 &&
      !isBlip(line.text),
  );
  if (userSpoke) return { kind: 'stop', reason: 'user-spoke' };
  const window = pressWindow(lines, watch.from, now);
  if (window.themWords <= watch.themWords) return { kind: 'wait' };
  // Their words after the ones sent: they went on at once, or started something new later.
  const fresh = spoken
    .filter((line) => line.speaker === 'them')
    .flatMap((line) => segmentsOf(line))
    .filter((segment) => segment.tEnd > watch.themEnd && !onlyListening(segment.text));
  if (fresh.length === 0) return { kind: 'wait' };
  const firstStart = Math.min(...fresh.map((segment) => Math.max(segment.tStart, watch.themEnd)));
  if (firstStart > watch.pressedAt + PRESS_UPDATE_START_MS) return { kind: 'stop', reason: 'late' };
  // Their turn must be over: no grey words, and the pause after their newest line (none at Flux's end of
  // turn).
  const newestThem = spoken.findLast((line) => line.speaker === 'them');
  if (!newestThem || !newestThem.final || now - newestThem.tEnd < pauseAfter(newestThem)) {
    return { kind: 'wait' };
  }
  return { kind: 'update', window };
}

/** What auto-answer (rule 9) and the re-ask (rule 6) need to know. */
export interface NewestAutoState {
  /** Whether auto-answer is on. The re-ask runs either way. */
  enabled: boolean;
  /** Whether an answer is streaming now. */
  streaming: boolean;
  /** The visible lines, in order. */
  lines: readonly Utterance[];
  /** The end of the newest answered speech, or null. */
  answeredEnd: number | null;
  /** The latest answer to speech (press or auto), or null. */
  last: AnsweredQuestion | null;
  /** When the last answer stopped streaming, or null. */
  idleSince?: number | null;
}

/** What auto-answer should do now. */
export type NewestAutoDecision =
  | {
      /** Answer the newest unanswered question. */
      kind: 'answer';
      /** Exactly these words. Never logged. */
      text: string;
      /** Its lines. */
      lineIds: string[];
      /** Its span. */
      span: AnsweredSpeech;
      /** End of the speech (for the decision key). */
      tEnd: number;
      /** Words sent. */
      words: number;
    }
  | {
      /**
       * Ask again with the whole question (rule 6): on the same card when sameSentence (or while the first
       * answer still streams; the caller knows), otherwise on a new card linked to the first (P0-C).
       */
      kind: 'rerun';
      /** The card it asks again (replaced in place, or the new card's rerunOf). */
      replaces: string;
      /** Batch D (P0-C): the added words only finish the sentence the first request ended in. */
      sameSentence: boolean;
      /**
       * Batch D (trace): why it is asked again: 'grew' (the asked stretches got more words) or 'went-on' (a
       * new stretch started within REASK_WINDOW_MS of the original answer's end).
       */
      reason: 'grew' | 'went-on';
      /** Exactly these words. Never logged. */
      text: string;
      /** Its lines. */
      lineIds: string[];
      /** Its span. */
      span: AnsweredSpeech;
      /** End of the speech (for the decision key). */
      tEnd: number;
      /** Words sent. */
      words: number;
    };

/**
 * How long after a line to wait before treating the turn as over: none at the engine's own end of turn,
 * otherwise the pause rules of autoAnswer.ts (1.2 s, or 3 s when the words look cut off).
 *
 * @param line The newest line of the question.
 * @returns The pause, ms.
 */
function pauseAfter(line: Utterance): number {
  if (line.engineTurnEnd) return 0;
  return looksUnfinished(line.text) ? UNFINISHED_PAUSE_MS : AUTO_PAUSE_MS;
}

/**
 * Rule 6: the asked speech as it is now: the other person's stretches from the ORIGINAL answer's start
 * that started no later than REASK_WINDOW_MS after the original answer's end (later ones are the next
 * question), when the user has not replied since. A joined line's earlier stretch, answered on another
 * card, is left out. With one clock no slack is needed: any new word counts.
 *
 * Batch D (P0-B, ADR-0079): the window is anchored on the card's original answer (anchorStart/anchorEnd),
 * never on the latest re-ask, so it cannot walk forward through a whole call (the 14 Nov call's card B was
 * re-asked ten times). And, as the legacy rules do (autoAnswer.ts continuationOf), a new stretch that is a
 * question of its own and starts more than NEW_QUESTION_GAP_MS after the speech before it is the next
 * question: it and everything after it are left out. (With the 2 s window this second guard only acts if
 * the window is widened or the anchor is missing; it is kept so the two rules cannot drift apart.)
 *
 * @param lines    The visible lines.
 * @param last     The latest answer to speech.
 * @param windowMs How long after the original answer's end new speech may start (default REASK_WINDOW_MS;
 *                 tests pass a wider one to check the new-question rule on its own).
 * @returns The stretches (empty when the user replied since, or nothing is there).
 * Called from: autoNewestDue(); tests
 */
export function reaskSpeech(
  lines: readonly Utterance[],
  last: AnsweredQuestion,
  windowMs: number = REASK_WINDOW_MS,
): Candidate[] {
  const anchorStart = last.anchorStart ?? last.start ?? last.end;
  const anchorEnd = last.anchorEnd ?? last.end;
  const spoken = spokenLines(lines);
  const reply = lastReplyIndex(spoken);
  if (reply !== -1 && spoken[reply]!.tStart >= anchorStart) return [];
  const within = unansweredSpeech(lines, anchorStart - 1).filter(
    (candidate) => candidate.segment.tStart <= anchorEnd + windowMs,
  );
  const kept: Candidate[] = [];
  let before = anchorEnd;
  for (const candidate of within) {
    const { segment } = candidate;
    const fresh = segment.tStart > anchorEnd;
    if (
      fresh &&
      segment.tStart - before > NEW_QUESTION_GAP_MS &&
      lineKind(segment.text) === 'question'
    ) {
      break;
    }
    kept.push(candidate);
    before = Math.max(before, segment.tEnd);
  }
  return kept;
}

/** Batch D (P0-C): a sentence end, with any closing quote or bracket after it. */
const SENTENCE_END = /[.?!]["'”’)\]]*$/;

/**
 * Batch D (P0-C, ADR-0079): whether the words added since the first request only finish the sentence it
 * ended in (a premature end of turn, or a press on grey words cut mid-sentence), so the same card may be
 * replaced. Anything else (the first request ended a sentence, or the added words hold another sentence)
 * gets a new card, so a finished answer is never overwritten by an answer to a different question.
 *
 * @param askedText  The words the first request sent (undefined when unknown: never the same sentence).
 * @param fullText   The words the re-ask sends (the first request's words, then the added ones).
 * @param askedWords How many words the first request sent.
 * @returns True when the added words only finish that sentence.
 * Called from: autoNewestDue(); tests
 */
export function finishesSameSentence(
  askedText: string | undefined,
  fullText: string,
  askedWords: number,
): boolean {
  if (!askedText) return false;
  // The first request ended a sentence: whatever follows is more than its end.
  if (SENTENCE_END.test(askedText.trim())) return false;
  const added = fullText.trim().split(/\s+/).filter(Boolean).slice(askedWords).join(' ');
  if (added === '') return true;
  // At most one sentence end, and only at the very end of the added words.
  return !/[.?!]/.test(added.replace(SENTENCE_END, ''));
}

/**
 * Rules 6 and 9: whether to re-ask the last card, or to auto-answer the newest question, now.
 *
 * @param input See NewestAutoState.
 * @param now   The current time (Unix ms, the lines' clock).
 * @returns The decision, or null.
 * Called from: useAutoAnswer.ts (every tick and transcript change); tests
 */
export function autoNewestDue(input: NewestAutoState, now: number): NewestAutoDecision | null {
  const spoken = spokenLines(input.lines);
  // The other person is still talking: the question may go on.
  if (
    spoken.some(
      (line) => !line.final && line.speaker === 'them' && now - line.tEnd < STALE_PARTIAL_MS,
    )
  ) {
    return null;
  }

  // Rule 6: the asked speech went on (grew, or more speech started within REASK_WINDOW_MS of the original
  // answer's end, with no reply in between): ask again once that turn is over.
  // Batch D (P0-B): at most MAX_REASKS per card; with auto-answer off (decision D1), only a press that
  // answered words still being spoken (grey) is asked again.
  const last = input.last;
  const mayReask =
    last !== null &&
    (last.reasks ?? 0) < MAX_REASKS &&
    (input.enabled || (last.grey === true && !last.auto));
  const again = last && mayReask ? reaskSpeech(input.lines, last) : [];
  if (last && again.length > 0) {
    const question = asQuestion(again);
    if (question.words >= (last.words ?? 0) + REASK_WORDS) {
      const lines = spoken.filter((line) => question.lineIds.includes(line.id));
      const newest = lines.reduce((latest, line) => (line.tEnd > latest.tEnd ? line : latest));
      // It is still going on (or the turn is not over yet): nothing else is started meanwhile.
      if (question.grey || now - newest.tEnd < pauseAfter(newest)) return null;
      const anchorEnd = last.anchorEnd ?? last.end;
      return {
        kind: 'rerun',
        replaces: last.answerId,
        sameSentence: finishesSameSentence(last.askedText, question.text, last.words ?? 0),
        reason: again.some((candidate) => candidate.segment.tStart > anchorEnd)
          ? 'went-on'
          : 'grew',
        text: question.text,
        lineIds: question.lineIds,
        span: question.span,
        tEnd: question.span.end,
        words: question.words,
      };
    }
  }

  if (!input.enabled || input.streaming) return null;
  const candidates = unansweredSpeech(input.lines, input.answeredEnd);
  if (candidates.length === 0 || candidates.some((candidate) => candidate.grey)) return null;
  // The newest finished words must be the other person's: a real reply from the user ends the moment.
  const newest = spoken.filter((line) => line.final).at(-1);
  if (!newest || newest.speaker !== 'them') return null;
  const question = asQuestion(candidates);
  // Auto-answer answers questions only; a press answers anything new (rule 4).
  if (!isAutoQuestion(question.text)) return null;
  const end = question.span.end;
  if (now - end < pauseAfter(newest)) return null;
  // Too old to answer by itself, unless it came due while another answer was streaming.
  const cameDueWhileStreaming =
    input.idleSince != null && now - input.idleSince <= AFTER_STREAM_GRACE_MS;
  if (now - end > AUTO_MAX_AGE_MS && !cameDueWhileStreaming) return null;
  return {
    kind: 'answer',
    text: question.text,
    lineIds: question.lineIds,
    span: question.span,
    tEnd: end,
    words: question.words,
  };
}
