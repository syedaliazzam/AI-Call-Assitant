/**
 * File: apps/web/src/core/answer/repeatGuard.ts
 * Purpose: Makes Answer idempotent (v1.0.1, widened in v1.0.2). An answer can be started from
 *          several places at once: the desktop app's global shortcut and the page's own key
 *          handler (merged only within 150 ms, in one window), the overlay's keys and buttons (sent
 *          over the live channel), auto-answer, and a transcript bubble's "Answer this" button.
 *          A real call got the same question answered twice ~2 s apart.
 *          The guard ignores a trigger while an answer is still streaming, and the same question
 *          text within REPEAT_WINDOW_MS. v1.0.2 also remembers WHICH speech each answer was for
 *          (the time span of the "Them" lines it used), for the whole call: auto-answer never
 *          answers speech that was already answered, and a manual press for it within
 *          SHOW_EXISTING_MS shows the existing answer instead of asking again. This closes the
 *          v1.0.1 gaps: auto-answer firing after a manual answer that took longer than 3 s, and the
 *          same question arriving with slightly different words (words settling, or the accurate
 *          engine rewriting the line).
 * Used by: src/features/live/useLiveAnswers.ts (ask)
 * Depends on: nothing (pure)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0037
 */

/** How long the same question text is not answered again, in milliseconds. */
export const REPEAT_WINDOW_MS = 3_000;

/** How long a manual press for already-answered speech shows that answer instead, in ms. */
export const SHOW_EXISTING_MS = 10_000;

/**
 * Slack when comparing speech times, in ms: a grey line's end is "when it last changed", so the
 * finished line for the same words can end a little later than the grey one did.
 */
export const SPAN_SLACK_MS = 700;

/** The speech an answer is for: the time span of the "Them" lines its question came from. */
export interface SpeechSpan {
  /** Start of the first line (Unix ms). */
  start: number;
  /** End of the last line (Unix ms). */
  end: number;
}

/** One trigger to check. */
export interface AnswerTrigger {
  /** The question the answer would be for ('' when none was found yet). */
  question: string;
  /** True while an answer is still streaming. */
  streaming: boolean;
  /** When the trigger happened (ms, any clock that only goes forward). */
  now: number;
  /** The speech the question came from, when it came from the transcript. */
  span?: SpeechSpan;
  /** True for auto-answer: it never repeats speech that was already answered. */
  auto?: boolean;
  /**
   * True when the question was found by looking back past a greeting or an instruction (v1.1.0): the
   * user did not ask for it again, so speech already answered shows its answer however long ago.
   */
  lookedBack?: boolean;
}

/** What to do with a trigger. */
export type TriggerDecision =
  | {
      /** Start a new answer. */
      kind: 'answer';
    }
  | {
      /** Do nothing: it is the same press, or speech that was already answered. */
      kind: 'ignore';
    }
  | {
      /** Show the answer already given for this speech. */
      kind: 'show';
      /** That answer's id. */
      answerId: string;
    };

/** A guard for one call's answers. */
export interface RepeatGuard {
  /**
   * Decides what a trigger should do. Remembers the question text when it answers (the span is
   * remembered by remember(), once the answer has an id).
   *
   * @param trigger The question, whether one is streaming, the time, and the speech it is for.
   * @returns See TriggerDecision.
   */
  decide: (trigger: AnswerTrigger) => TriggerDecision;
  /**
   * Remembers that an answer was started for some speech.
   *
   * @param span     The speech.
   * @param answerId The answer's id.
   * @param now      When (the same clock as AnswerTrigger.now).
   */
  remember: (span: SpeechSpan, answerId: string, now: number) => void;
  /**
   * decide() for callers that only need yes or no ('show' counts as no).
   *
   * @param trigger See decide().
   * @returns True to answer.
   */
  accept: (trigger: AnswerTrigger) => boolean;
}

/**
 * The comparison key for a question: lower case, letters and digits only.
 *
 * @param question The question.
 * @returns The key.
 * Called from: createRepeatGuard()
 */
function keyOf(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether new speech is the same as speech already answered: nothing in it ended after the
 * answered speech did (within the slack), and it overlaps it.
 *
 * @param next     The speech a trigger is for.
 * @param answered Speech already answered.
 * @returns True when it is the same speech.
 * Called from: createRepeatGuard()
 */
export function sameSpeech(next: SpeechSpan, answered: SpeechSpan): boolean {
  return next.end <= answered.end + SPAN_SLACK_MS && next.end >= answered.start - SPAN_SLACK_MS;
}

/**
 * Which transcript bubbles were already answered: a bubble whose speech is the same as an answered
 * span (sameSpeech()) shows "Answered" instead of its "Answer this" button.
 *
 * @param groups  The bubbles (id and time span).
 * @param spans   The speech answered in this call.
 * @returns The ids of the answered bubbles.
 * Called from: TranscriptStrip.tsx, CompactView.tsx; tests
 */
export function answeredGroupIds(
  groups: readonly { id: string; tStart: number; tEnd: number }[],
  spans: readonly SpeechSpan[],
): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    const span = { start: group.tStart, end: group.tEnd };
    if (spans.some((answered) => sameSpeech(span, answered))) ids.add(group.id);
  }
  return ids;
}

/**
 * The time span of the "Them" lines a question was picked from.
 *
 * @param lines   The transcript lines (finished and grey).
 * @param lineIds The ids of the lines the question came from.
 * @returns The span, or null when none of them is a "Them" line.
 * Called from: useLiveAnswers() (ask); tests
 */
export function themSpan(
  lines: readonly { id: string; speaker: string; tStart: number; tEnd: number }[],
  lineIds: readonly string[],
): SpeechSpan | null {
  const used = lines.filter((line) => line.speaker === 'them' && lineIds.includes(line.id));
  if (used.length === 0) return null;
  return {
    start: Math.min(...used.map((line) => line.tStart)),
    end: Math.max(...used.map((line) => line.tEnd)),
  };
}

/**
 * Creates the guard for one call.
 *
 * @param windowMs How long the same question text is ignored (default REPEAT_WINDOW_MS).
 * @returns The guard.
 * Called from: useLiveAnswers(); tests
 */
export function createRepeatGuard(windowMs: number = REPEAT_WINDOW_MS): RepeatGuard {
  let last: { key: string; at: number } | null = null;
  // Every span answered in this call, newest last (a call has tens of answers, not thousands).
  const answered: { span: SpeechSpan; answerId: string; at: number }[] = [];

  const decide = ({
    question,
    streaming,
    now,
    span,
    auto,
    lookedBack,
  }: AnswerTrigger): TriggerDecision => {
    // One answer at a time: a second trigger while one streams is the same press seen again.
    if (streaming) return { kind: 'ignore' };
    if (span) {
      const earlier = answered.findLast((entry) => sameSpeech(span, entry.span));
      if (earlier) {
        // Auto-answer never answers the same speech twice, however long ago.
        if (auto) return { kind: 'ignore' };
        // A quick second press shows what is there; a later one is a deliberate new answer.
        if (lookedBack || now - earlier.at < SHOW_EXISTING_MS) {
          return { kind: 'show', answerId: earlier.answerId };
        }
      }
    }
    const key = keyOf(question);
    if (last && last.key === key && now - last.at < windowMs) return { kind: 'ignore' };
    last = { key, at: now };
    return { kind: 'answer' };
  };

  return {
    decide,
    remember(span, answerId, now) {
      answered.push({ span, answerId, at: now });
    },
    accept: (trigger) => decide(trigger).kind === 'answer',
  };
}
