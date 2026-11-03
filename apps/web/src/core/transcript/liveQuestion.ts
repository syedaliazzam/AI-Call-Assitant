/**
 * File: apps/web/src/core/transcript/liveQuestion.ts
 * Purpose: The current live question (v1.0.4, ADR-0040): the latest question the other person asked,
 *          as one clean line for the overlay ("How would you design a voice agent?"), updating while
 *          the words are still being heard. Display only: Answer still picks its own question
 *          (question.ts), and Claude still gets the whole conversation.
 * Used by: src/features/live/LiveAnswers.tsx (the overlay's state)
 * Depends on: src/core/transcript/question.ts (questionSpan), src/core/transcript/display.ts,
 *             src/core/transcript/group.ts (the pause that ends a turn)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0040
 *
 * Pure. Transcript text is only arranged for the screen here; it is never logged.
 */
import { chipWords, sentenceCase, type DisplayTerm } from './display';
import { GROUP_GAP_MS } from './group';
import { questionSpan } from './question';
import type { Utterance } from './transcript';

/** At most this many words are shown: the overlay gives the line two rows. */
export const LIVE_QUESTION_WORDS = 30;

/** A request worded as an instruction, which reads wrongly with a "?" after it. */
const INSTRUCTION = /^(?:tell me|walk me through|explain|describe)\b/i;

/**
 * The latest question from the other person.
 *
 * @param lines The call's lines in time order (finished and still being heard).
 * @param terms The session's own spellings (displayTerms()).
 * @param since Ignore speech that ended before this time (Unix ms; Clear sets it).
 * @returns The question to show, with "…" while it is still being heard; null when there is none.
 * Called from: LiveAnswers.tsx; tests
 */
export function liveQuestion(
  lines: readonly Utterance[],
  terms: readonly DisplayTerm[] = [],
  since = 0,
): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.speaker !== 'them' || line.tEnd <= since) continue;
    const span = questionSpan(line.text);
    if (!span) continue;
    const parts = [line.text.slice(span.start, span.end)];
    let heard = line.final;
    // A pause can cut a question in two ("…the plan cost / for forty seats"): the same turn's next
    // lines finish it. A "?" already closed it.
    if (!parts[0]!.endsWith('?')) {
      let end = line.tEnd;
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j]!;
        if (next.speaker !== 'them' || next.tStart - end > GROUP_GAP_MS) break;
        parts.push(next.text);
        heard &&= next.final;
        end = next.tEnd;
      }
    }
    const words = chipWords(sentenceCase(parts.join(' '), terms));
    if (words.length === 0) continue;
    const text = words.slice(0, LIVE_QUESTION_WORDS).join(' ');
    if (!heard || words.length > LIVE_QUESTION_WORDS) return `${text}…`;
    return /[?.!]$/.test(text) || INSTRUCTION.test(text) ? text : `${text}?`;
  }
  return null;
}
