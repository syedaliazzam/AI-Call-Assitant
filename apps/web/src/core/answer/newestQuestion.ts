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
 *             again on the same card: presses, auto-answers and finals alike.
 *          7. Feedback: every press ends in a card, "Showing the earlier answer", "Already answering", or
 *             "Nothing new to answer" (useLiveAnswers.ts).
 *          8. Gaps: when only lost audio follows the last answer, the press says so.
 *          9. Auto-answer uses the same window, at the engine's own end of turn (Flux EndOfTurn), and answers
 *             a question once (plus the rule-6 re-ask).
 * Used by: src/features/live/useLiveAnswers.ts, src/features/live/useAutoAnswer.ts
 * Depends on: src/core/answer/autoAnswer.ts (isAutoQuestion, the pause and age rules),
 *             src/core/transcript (question.ts lastReplyIndex, blip.ts, questionKind.ts, transcript.ts)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md E3; ADR-0076
 *
 * Pure: the caller passes the lines, what was answered and the time. Text is never logged.
 */
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
  STALE_PARTIAL_MS,
  UNFINISHED_PAUSE_MS,
  type AnsweredQuestion,
} from './autoAnswer';

/** Rule 2: the longest a press waits for the other side to be transcribed up to the press, ms. */
export const CATCH_UP_CAP_MS = 300;

/** Rule 7 / G2: "Finishing the question…" shows only when the wait lasts longer than this, ms. */
export const FINISHING_NOTICE_AFTER_MS = 150;

/** Rule 6: speech that goes on within this long after the asked speech ended is asked again, ms. */
export const REASK_WINDOW_MS = 2_000;

/** Rule 6: one new word is enough to ask again (it was two before ADR-0076). */
export const REASK_WORDS = 1;

/** At most this many words are sent (the newest), so a long monologue stays a reasonable request. */
export const MAX_NEWEST_WORDS = 200;

/** The speech one answer covered (capture clock, Unix ms). */
export interface AnsweredSpeech {
  /** Start of its first segment. */
  start: number;
  /** End of its last segment. */
  end: number;
}

/** A stretch of the other person's speech with the line it is in. */
interface Candidate {
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
 */
function segmentsOf(line: Utterance): Segment[] {
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
  const reply = lastReplyIndex(spoken);
  const replyStart = reply === -1 ? Number.NEGATIVE_INFINITY : spoken[reply]!.tStart;
  const from = Math.max(answeredEnd ?? Number.NEGATIVE_INFINITY, replyStart);
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
    }
  | {
      /** Nothing new since the last card: show it ("Showing the earlier answer" / "Already answering"). */
      kind: 'show-existing';
      /** That card. */
      answerId: string;
    }
  | {
      /** Only lost audio since the last answer: say so instead of answering the question before it. */
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
  /** The end of the newest answered speech (capture clock), or null before any answer. */
  answeredEnd: number | null;
  /** The newest card for speech in this call, or null. */
  lastAnswerId: string | null;
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
  if (candidates.length > 0) {
    return { kind: 'answer', ...asQuestion(candidates), segments: candidates.length };
  }
  // Rule 8: their audio was lost after the last answer: the question may be in the gap.
  const from = input.answeredEnd ?? Number.NEGATIVE_INFINITY;
  if (input.lines.some((line) => line.gap && line.speaker === 'them' && line.tEnd > from)) {
    return { kind: 'gap' };
  }
  if (input.lastAnswerId) return { kind: 'show-existing', answerId: input.lastAnswerId };
  return { kind: 'none' };
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
      /** Ask again on the same card with the whole question (rule 6). */
      kind: 'rerun';
      /** The card it replaces. */
      replaces: string;
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
 * Rule 6: the asked speech as it is now: the other person's stretches from the asked span's start that
 * started no later than REASK_WINDOW_MS after its end (later ones are the next question), when the user has
 * not replied since. A joined line's earlier stretch, answered on another card, is left out. With one clock
 * no slack is needed: any new word counts.
 *
 * @param lines The visible lines.
 * @param last  The latest answer to speech.
 * @returns The stretches (empty when the user replied since, or nothing is there).
 * Called from: autoNewestDue()
 */
function reaskSpeech(lines: readonly Utterance[], last: AnsweredQuestion): Candidate[] {
  const start = last.start ?? last.end;
  const spoken = spokenLines(lines);
  const reply = lastReplyIndex(spoken);
  if (reply !== -1 && spoken[reply]!.tStart >= start) return [];
  return unansweredSpeech(lines, start - 1).filter(
    (candidate) => candidate.segment.tStart <= last.end + REASK_WINDOW_MS,
  );
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

  // Rule 6: the asked speech went on (grew, or more speech started within REASK_WINDOW_MS of its end,
  // with no reply in between): ask again on the same card once that turn is over.
  const last = input.last;
  const again = last ? reaskSpeech(input.lines, last) : [];
  if (last && again.length > 0) {
    const question = asQuestion(again);
    if (question.words >= (last.words ?? 0) + REASK_WORDS) {
      const lines = spoken.filter((line) => question.lineIds.includes(line.id));
      const newest = lines.reduce((latest, line) => (line.tEnd > latest.tEnd ? line : latest));
      // It is still going on (or the turn is not over yet): nothing else is started meanwhile.
      if (question.grey || now - newest.tEnd < pauseAfter(newest)) return null;
      return {
        kind: 'rerun',
        replaces: last.answerId,
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
