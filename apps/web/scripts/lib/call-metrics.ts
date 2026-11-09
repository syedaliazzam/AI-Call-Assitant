/**
 * File: apps/web/scripts/lib/call-metrics.ts
 * Purpose: The call-quality metrics of a synthetic test call (v1.4, ADR-0062 Phase 2), computed from the
 *          script's ground truth and what the app made of the call: the transcript lines (shown and
 *          hidden) and the answers. Pure functions, the same for every version of the app measured, so
 *          the baseline and each phase are scored alike:
 *          - words on the right channel (attribution), and lines that belong to the other side;
 *          - word error rate per channel, as shown;
 *          - one-word noise lines per 10 minutes;
 *          - questions split across lines or turns;
 *          - question capture: answered, whole, duplicate answers, answers to non-questions, and the
 *            time from the end of a question to its answer being sent;
 *          - lines of another language caught, and English lines wrongly marked.
 * Used by: scripts/stt-calls.ts; tests/unit/scripts/call-metrics.test.ts
 * Depends on: src/core/stt/wer.ts (normalizeWords, wordErrorRate), scripts/lib/call-script.ts (types)
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * Text is compared here but never printed: the results hold numbers only.
 */
import { normalizeWords, wordErrorRate } from '../../src/core/stt/wer';
import type { ExpectedQuestion, PlacedLine } from './call-script';

/** A transcript line as the metrics see it (the app's Utterance, with times in Unix ms). */
export interface MeasuredLine {
  /** Its id. */
  id: string;
  /** Who it was heard from. */
  speaker: 'you' | 'them';
  /** Its words (or "[non-English speech]"). */
  text: string;
  /** Start, Unix ms. */
  tStart: number;
  /** End, Unix ms. */
  tEnd: number;
  /** True when the app hid it (echo, noise). */
  hidden: boolean;
  /** True when the app marked it as another language. */
  nonEnglish: boolean;
}

/** An answer the app started (a card), as the metrics see it. */
export interface MeasuredAnswer {
  /** The card's id. */
  id: string;
  /** When its final request was sent (Unix ms). */
  sentAt: number;
  /** The transcript lines its question came from. */
  lineIds: string[];
  /** How many times it was asked again on the same card (reruns). */
  reruns: number;
}

/** A script line with its times in Unix ms (the call's start added). */
export interface TimedScriptLine extends PlacedLine {
  /** Start, Unix ms. */
  start: number;
  /** End, Unix ms. */
  end: number;
}

/** A number for each channel. */
export interface PerChannel {
  /** The microphone ("You"). */
  you: number;
  /** The call's sound ("Them"). */
  them: number;
}

/** A count out of a total. */
export interface CountOf {
  /** How many. */
  count: number;
  /** Out of how many. */
  of: number;
}

/** Everything measured on one call. */
export interface CallMetrics {
  /** Share of matched words heard on the right channel, by channel, and both. */
  rightChannel: PerChannel & {
    /** Both channels together. */
    all: number;
  };
  /** Lines shown on a channel that belong to the other side. */
  crossLines: PerChannel;
  /** Word error rate as shown, by channel (another language left out of the reference). */
  wer: PerChannel;
  /** One-word lines that match no one-word script line, per 10 minutes, both channels. */
  fragmentsPer10Min: number;
  /** Questions of two or more lines shown in more than one line, of all such questions. */
  splitLines: CountOf;
  /** The same at the level of turns (what the transcript panel shows). */
  splitTurns: CountOf;
  /** Questions that got an answer, of all questions. */
  answered: CountOf;
  /** Questions whose answer covered at least WHOLE_COVERAGE of the question, of all questions. */
  whole: CountOf;
  /** Extra cards for a question already answered. */
  duplicates: number;
  /** Cards for speech that was no question. */
  nonQuestionAnswers: number;
  /** Cards in all. */
  cards: number;
  /** End of question → answer sent, ms (p50, p95), over answered questions. */
  sendDelayMs: {
    /** Median. */
    p50: number;
    /** 95th percentile. */
    p95: number;
  };
  /** Lines of another language caught (marked), of those in the script. */
  otherLanguage: {
    /** Marked. */
    caught: number;
    /** In the script. */
    of: number;
  };
  /** English lines wrongly marked as another language. */
  falseOtherLanguage: number;
}

/** An answer counts as the whole question when it covers at least this share of its time. */
export const WHOLE_COVERAGE = 0.85;

/** How far apart in time a transcript line and a script line may be and still be compared, ms. */
const NEAR_MS = 1_500;

/**
 * The longest common subsequence of two word lists (exact words), so the metric never changes with the
 * app's own matching rules.
 *
 * @param a One list.
 * @param b The other.
 * @returns Its length.
 * Called from: computeCallMetrics(); tests
 */
export function exactLcs(a: readonly string[], b: readonly string[]): number {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * A percentile of some numbers (nearest rank).
 *
 * @param values The numbers.
 * @param p      The percentile, 0…100.
 * @returns It, or NaN with no numbers.
 * Called from: computeCallMetrics(); tests
 */
export function percentileOf(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  ]!;
}

/**
 * How much of a time span another one covers.
 *
 * @param span  The span (start, end).
 * @param cover The covering span.
 * @returns 0…1.
 * Called from: computeCallMetrics()
 */
function coverage(span: [number, number], cover: [number, number]): number {
  const overlap = Math.min(span[1], cover[1]) - Math.max(span[0], cover[0]);
  return span[1] > span[0] ? Math.max(0, overlap) / (span[1] - span[0]) : 0;
}

/**
 * Whether two spans overlap, allowing some slack.
 *
 * @param a     One span.
 * @param b     The other.
 * @param slack Slack either side, ms.
 * @returns True when they overlap.
 * Called from: computeCallMetrics()
 */
function overlaps(a: [number, number], b: [number, number], slack = 0): boolean {
  return a[0] <= b[1] + slack && b[0] <= a[1] + slack;
}

/**
 * Computes every metric of one call.
 *
 * @param input.script    The script lines with Unix times.
 * @param input.questions The expected questions.
 * @param input.lines     Every final transcript line (shown and hidden).
 * @param input.turns     The "Them" turns as the transcript panel shows them, as time spans.
 * @param input.answers   The cards the app made.
 * @param input.totalMs   The call's length, ms.
 * @returns The metrics.
 * Called from: stt-calls.ts; tests
 */
export function computeCallMetrics(input: {
  script: readonly TimedScriptLine[];
  questions: readonly ExpectedQuestion[];
  lines: readonly MeasuredLine[];
  turns: readonly { start: number; end: number }[];
  answers: readonly MeasuredAnswer[];
  totalMs: number;
}): CallMetrics {
  const shown = input.lines.filter((line) => !line.hidden);
  const english = input.script.filter((line) => line.role !== 'other-language');

  // Attribution: each shown line's words are matched with what each side said around it.
  const right = { you: 0, them: 0 };
  const wrong = { you: 0, them: 0 };
  const crossLines = { you: 0, them: 0 };
  for (const line of shown) {
    if (line.nonEnglish) continue;
    const words = normalizeWords(line.text);
    if (words.length === 0) continue;
    const near = english.filter((ref) =>
      overlaps([line.tStart, line.tEnd], [ref.start, ref.end], NEAR_MS),
    );
    const said = (speaker: 'you' | 'them') =>
      normalizeWords(
        near
          .filter((ref) => ref.speaker === speaker)
          .map((ref) => ref.text)
          .join(' '),
      );
    const own = exactLcs(words, said(line.speaker));
    const other = exactLcs(words, said(line.speaker === 'you' ? 'them' : 'you'));
    if (other > own) {
      wrong[line.speaker] += other;
      if (other >= Math.max(1, words.length / 2)) crossLines[line.speaker] += 1;
    } else {
      right[line.speaker] += own;
    }
  }
  const share = (good: number, bad: number) => (good + bad === 0 ? 1 : good / (good + bad));

  // Word error rate as shown, per channel.
  const werOf = (speaker: 'you' | 'them') => {
    const reference = english
      .filter((ref) => ref.speaker === speaker)
      .sort((a, b) => a.start - b.start)
      .map((ref) => ref.text)
      .join(' ');
    const hypothesis = shown
      .filter((line) => line.speaker === speaker && !line.nonEnglish)
      .sort((a, b) => a.tStart - b.tStart)
      .map((line) => line.text)
      .join(' ');
    return wordErrorRate(reference, hypothesis).wer;
  };

  // One-word lines that match no one-word line said nearby by the same speaker.
  const fragments = shown.filter((line) => {
    const words = normalizeWords(line.text);
    if (words.length !== 1 || line.nonEnglish) return false;
    return !input.script.some(
      (ref) =>
        ref.speaker === line.speaker &&
        normalizeWords(ref.text).includes(words[0]!) &&
        normalizeWords(ref.text).length <= 2 &&
        overlaps([line.tStart, line.tEnd], [ref.start, ref.end], 2_000),
    );
  }).length;

  // Questions and their spans.
  const spans = input.questions.map((question) => {
    const parts = input.script.filter((ref) => question.lineIds.includes(ref.id));
    return {
      id: question.id,
      parts: parts.length,
      span: [
        Math.min(...parts.map((ref) => ref.start)),
        Math.max(...parts.map((ref) => ref.end)),
      ] as [number, number],
    };
  });
  const multi = spans.filter((question) => question.parts > 1);
  const themShown = shown.filter((line) => line.speaker === 'them');
  const splitLines = multi.filter(
    (question) =>
      themShown.filter((line) => coverage([line.tStart, line.tEnd], question.span) > 0.3).length >
      1,
  ).length;
  const splitTurns = multi.filter(
    (question) =>
      input.turns.filter((turn) => coverage([turn.start, turn.end], question.span) > 0.3).length >
      1,
  ).length;

  // Answers: the time span of each card's lines.
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const cards = input.answers.map((answer) => {
    const used = answer.lineIds.flatMap((id) => byId.get(id) ?? []);
    const span: [number, number] = used.length
      ? [Math.min(...used.map((line) => line.tStart)), Math.max(...used.map((line) => line.tEnd))]
      : [answer.sentAt, answer.sentAt];
    return { ...answer, span };
  });
  let answered = 0;
  let whole = 0;
  let duplicates = 0;
  const delays: number[] = [];
  for (const question of spans) {
    const mine = cards.filter((card) => coverage(question.span, card.span) > 0.2);
    if (mine.length === 0) continue;
    answered += 1;
    duplicates += mine.length - 1;
    if (Math.max(...mine.map((card) => coverage(question.span, card.span))) >= WHOLE_COVERAGE)
      whole += 1;
    delays.push(Math.min(...mine.map((card) => card.sentAt)) - question.span[1]);
  }
  const nonQuestionAnswers = cards.filter(
    (card) => !spans.some((question) => coverage(question.span, card.span) > 0.2),
  ).length;

  // Another language.
  const other = input.script.filter((ref) => ref.role === 'other-language');
  const caught = other.filter((ref) =>
    shown.some(
      (line) =>
        line.nonEnglish &&
        line.speaker === ref.speaker &&
        overlaps([line.tStart, line.tEnd], [ref.start, ref.end]),
    ),
  ).length;
  const falseOther = shown.filter(
    (line) =>
      line.nonEnglish &&
      !other.some(
        (ref) =>
          ref.speaker === line.speaker &&
          overlaps([line.tStart, line.tEnd], [ref.start, ref.end], NEAR_MS),
      ),
  ).length;

  return {
    rightChannel: {
      you: share(right.you, wrong.you),
      them: share(right.them, wrong.them),
      all: share(right.you + right.them, wrong.you + wrong.them),
    },
    crossLines,
    wer: { you: werOf('you'), them: werOf('them') },
    fragmentsPer10Min: (fragments / Math.max(1, input.totalMs)) * 600_000,
    splitLines: { count: splitLines, of: multi.length },
    splitTurns: { count: splitTurns, of: multi.length },
    answered: { count: answered, of: spans.length },
    whole: { count: whole, of: spans.length },
    duplicates,
    nonQuestionAnswers,
    cards: cards.length,
    sendDelayMs: { p50: percentileOf(delays, 50), p95: percentileOf(delays, 95) },
    otherLanguage: { caught, of: other.length },
    falseOtherLanguage: falseOther,
  };
}
