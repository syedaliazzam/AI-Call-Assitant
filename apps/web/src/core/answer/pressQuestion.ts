/**
 * File: apps/web/src/core/answer/pressQuestion.ts
 * Purpose: What an Answer press (Ctrl+Enter, the Answer button) answers (1.5.2, ADR-0070): always the newest
 *          question of the other person, including one they are still asking (the grey line) and while the
 *          user is talking. Moved out of useLiveAnswers.ts ask() so every rule is unit-tested and the
 *          real-call replay (scripts/lib/real-call-replay.ts) runs the same code.
 *          In order:
 *          1. New plain words that only continue the question just answered are asked again on its card
 *             (v1.4, ADR-0062).
 *          2. ADR-0132: a press never waits for the other person to finish (it waited up to 8 s for a grey
 *             line that was not yet a question): their grey words are answered at once, and the card is
 *             asked again when they go on (the continuation rule, autoAnswer.ts).
 *          3. The unanswered question since the user's last real reply, grey words included.
 *          4. Otherwise the newest real question of the call; talk about the call ("can you repeat that
 *             last part?"), greetings and remarks look back to it. When it was answered already, the
 *             repeat guard shows its card instead of asking again.
 * Used by: src/features/live/useLiveAnswers.ts (ask); scripts/lib/real-call-replay.ts
 * Depends on: src/core/answer/autoAnswer.ts (continuationOf), src/core/transcript (questionKind.ts,
 *             question.ts, blip.ts)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); ADR-0070
 *
 * Pure: the caller passes the lines, what was answered and the time. Text is never logged.
 */
import { isBlip } from '../transcript/blip';
import { lastReplyIndex } from '../transcript/question';
import { lineKind, pickQuestion, type PickedQuestion } from '../transcript/questionKind';
import { readableLine, type Utterance } from '../transcript/transcript';
import { CONTINUE_WINDOW_MS, continuationOf, type AnsweredQuestion } from './autoAnswer';

/** What a press does. */
export type PressChoice =
  | {
      /** Answer these lines. */
      kind: 'answer';
      /** The lines of the question, oldest first. */
      lineIds: string[];
      /** Its words. Never logged. */
      text: string;
      /** The card it replaces (a continuation), if any. */
      replaces?: string;
      /** Found by looking back past talk about the call, a greeting or a remark. */
      lookedBack: boolean;
      /** Only part of the lines: send the words as they are. */
      partOfLines: boolean;
      /** True when some of its words are still grey. */
      grey: boolean;
    }
  | {
      /** The latest words look like noise. */
      kind: 'garbled';
      /** The words, to tell a second press on them from new words. Never logged. */
      text: string;
      /** Their lines. */
      lineIds: string[];
    }
  | {
      /** Nothing to answer. */
      kind: 'none';
    };

/** What choosePress() needs. */
export interface PressInput {
  /** The visible lines (finals and grey lines), noise lines left out, in order. */
  lines: readonly Utterance[];
  /** The lines already answered in this call (ids as the lines have them now). */
  answeredLineIds: ReadonlySet<string>;
  /** The latest answer to speech in this call (ids as the lines have them now), or null. */
  last: AnsweredQuestion | null;
  /** The current time (Unix ms, the lines' clock). */
  now: number;
}

/**
 * A picked question as a press choice.
 *
 * @param picked      pickQuestion()'s result.
 * @param lines       The lines it was picked from.
 * @param partOfLines Whether it came from only part of the lines.
 * @returns The choice.
 */
function fromPicked(
  picked: PickedQuestion,
  lines: readonly Utterance[],
  partOfLines: boolean,
): PressChoice {
  if (picked.kind === 'none') return { kind: 'none' };
  if (picked.kind === 'garbled') {
    return { kind: 'garbled', text: picked.selected.text, lineIds: picked.selected.lineIds };
  }
  const ids = picked.selected.lineIds;
  return {
    kind: 'answer',
    lineIds: ids,
    text: picked.selected.text,
    lookedBack: picked.lookedBack,
    partOfLines: partOfLines || picked.lookedBack,
    grey: lines.some((line) => ids.includes(line.id) && !line.final),
  };
}

/**
 * Decides what a press answers.
 *
 * @param input See PressInput.
 * @returns See PressChoice.
 * Called from: useLiveAnswers.ts ask(); the real-call replay; tests
 */
export function choosePress(input: PressInput): PressChoice {
  const { answeredLineIds: answered, last } = input;
  // 1.5.2 (ADR-0070): lines are read with the punctuation model's marks when they have no marks yet.
  const lines = input.lines.map(readableLine);
  const spoken = lines.filter((line) => line.text.trim() !== '' && !line.nonEnglish);
  if (!spoken.some((line) => line.speaker === 'them')) return { kind: 'none' };

  // 1. New words that only continue the question just answered: asked again on its card.
  const more = last ? continuationOf(lines, last, CONTINUE_WINDOW_MS, last.end) : [];
  if (last && more.length > 0) {
    const text = more.map((line) => line.text.trim()).join(' ');
    if (lineKind(text) === 'statement') {
      const whole = lines.filter((line) => last.lineIds.includes(line.id) || more.includes(line));
      return {
        kind: 'answer',
        lineIds: whole.map((line) => line.id),
        text: whole.map((line) => line.text.trim()).join(' '),
        replaces: last.answerId,
        lookedBack: false,
        partOfLines: true,
        grey: whole.some((line) => !line.final),
      };
    }
  }

  // 3. The unanswered part of what they said since the user's last real reply.
  const since = spoken.slice(lastReplyIndex(spoken) + 1).filter((line) => line.speaker === 'them');
  // Talk about the call, greetings and "mm-hm" are never part of the question ("can you repeat that last
  // part?" then the next question asks the next question).
  const unanswered = since.filter((line) => {
    if (answered.has(line.id) || isBlip(line.text)) return false;
    const kind = lineKind(line.text);
    return kind !== 'meta' && kind !== 'greeting' && kind !== 'instruction';
  });
  if (unanswered.length > 0) {
    const picked = pickQuestion(unanswered, { allowStatement: false });
    if (picked.kind === 'question' && !picked.lookedBack) {
      return fromPicked(picked, lines, unanswered.length !== since.length);
    }
    if (picked.kind === 'garbled') return fromPicked(picked, lines, true);
  }

  // 4. The newest real question of the call (talk about the call and remarks look back to it); when it was
  // answered already, the repeat guard shows that card.
  return fromPicked(pickQuestion(lines), lines, false);
}
