/**
 * File: apps/web/src/core/transcript/group.ts
 * Purpose: Groups transcript lines into chat bubbles for display (v1.0.2): consecutive lines from
 *          the same speaker with short pauses between them become one bubble, so a sentence cut
 *          by pauses reads as one turn instead of many one-word fragments. Display only: the
 *          stored lines, the 1.5 s storage merge (merge.ts) and what answers and notes use are
 *          unchanged, so the prompt and its cache are not affected.
 * Used by: src/features/live/TranscriptStrip.tsx, src/features/live/TranscriptBubbles.tsx,
 *          src/features/review/ConversationSection.tsx, the overlay's expanded transcript
 *          (src/features/live/CompactView.tsx)
 * Depends on: src/core/transcript/display.ts (sentence case), src/core/answer/autoAnswer.ts
 *             (isAutoQuestion), src/core/transcript/transcript.ts (Speaker)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only arranged for the screen here; it is never logged.
 */
import { isAutoQuestion } from '../answer/autoAnswer';
import { continuationCase, sentenceCase, type DisplayTerm } from './display';
import type { Speaker } from './transcript';

/**
 * Longest pause between two lines of one bubble, in ms. Lines closer than 1.5 s are already one
 * stored line (merge.ts), so every join here bridges a pause of 1.5 to 4 s: a breath, not a turn.
 */
export const GROUP_GAP_MS = 4_000;

/** A bubble stops taking lines at this many words, so a long monologue stays readable. */
export const GROUP_MAX_WORDS = 80;

/** The parts of a transcript line that grouping needs (an Utterance, or a stored line). */
export interface GroupLine {
  /** The line's id. */
  id: string;
  /** Who spoke. */
  speaker: Speaker;
  /** What was said, as the engine wrote it. Never logged. */
  text: string;
  /** False while the words may still change (shown grey). */
  final: boolean;
  /** Start (Unix ms). */
  tStart: number;
  /** End (Unix ms). */
  tEnd: number;
}

/** One bubble: one speaker's lines with short pauses between them. */
export interface TranscriptGroup {
  /** The first line's id: stays the same as the bubble grows. */
  id: string;
  /** Who spoke. */
  speaker: Speaker;
  /** Ids of the lines in the bubble, in order. */
  lineIds: string[];
  /** The finished words, ready to show (sentence case, the session's spellings). */
  finalText: string;
  /** Words that may still change (the bubble's last line while it is heard), or ''. */
  provisionalText: string;
  /** Start of the first line (Unix ms). */
  tStart: number;
  /** End of the last line (Unix ms). */
  tEnd: number;
  /** True for a "Them" bubble that holds a question (question words, or a "?" from the engine). */
  question: boolean;
  /** True when every line is final. */
  final: boolean;
}

/** Options for groupLines(). */
export interface GroupOptions {
  /** Longest pause inside a bubble (default GROUP_GAP_MS). */
  gapMs?: number;
  /** The session's spellings to restore (displayTerms()). */
  terms?: readonly DisplayTerm[];
}

/**
 * Counts the words of a text.
 *
 * @param text Any text.
 * @returns The number of words.
 * Called from: groupLines()
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Adds a line's words to a bubble's text. After a sentence end (".", "?", "!") the line starts
 * with a capital; otherwise it carries on the sentence in lower case, as speech recognition cut
 * it at a pause rather than at a sentence (an engine that writes case keeps its own).
 *
 * @param before The bubble's text so far ('' for the first words).
 * @param raw    The line as the engine wrote it.
 * @param terms  The session's spellings.
 * @returns The joined text, with single spaces.
 * Called from: groupLines()
 */
function joinText(before: string, raw: string, terms: readonly DisplayTerm[]): string {
  const start = before.trim() === '' || /[.?!]["'’)\]]*$/.test(before.trim());
  const next = (start ? sentenceCase(raw, terms) : continuationCase(raw, terms)).trim();
  if (next === '') return before;
  return before.trim() === '' ? next : `${before.trimEnd()} ${next}`;
}

/**
 * Groups lines into bubbles. A line joins the bubble before it when the speaker is the same, the
 * pause from the bubble's end to the line's start is at most gapMs, and the bubble has fewer than
 * GROUP_MAX_WORDS words; otherwise it starts a new bubble. Empty lines are left out.
 *
 * @param lines   The lines in time order (finals and lines still being heard).
 * @param options The longest pause and the session's spellings.
 * @returns The bubbles, oldest first.
 * Called from: TranscriptStrip.tsx, ConversationSection.tsx, CompactView.tsx; tests
 */
export function groupLines(
  lines: readonly GroupLine[],
  options: GroupOptions = {},
): TranscriptGroup[] {
  const gapMs = options.gapMs ?? GROUP_GAP_MS;
  const terms = options.terms ?? [];
  const groups: TranscriptGroup[] = [];
  /** The raw text of each bubble's lines, to look for a question in each line on its own. */
  const raws: string[][] = [];
  for (const line of lines) {
    if (line.text.trim() === '') continue;
    const last = groups.at(-1);
    const joins =
      last !== undefined &&
      last.speaker === line.speaker &&
      line.tStart - last.tEnd <= gapMs &&
      // Words still settling are always the end of a bubble: nothing is joined after them.
      last.provisionalText === '' &&
      wordCount(last.finalText) < GROUP_MAX_WORDS;
    if (!joins) {
      groups.push({
        id: line.id,
        speaker: line.speaker,
        lineIds: [],
        finalText: '',
        provisionalText: '',
        tStart: line.tStart,
        tEnd: line.tEnd,
        question: false,
        final: true,
      });
      raws.push([]);
    }
    const group = groups.at(-1)!;
    group.lineIds.push(line.id);
    group.tEnd = Math.max(group.tEnd, line.tEnd);
    raws.at(-1)!.push(line.text);
    if (line.final) group.finalText = joinText(group.finalText, line.text, terms);
    else {
      group.provisionalText = joinText(group.finalText, line.text, terms)
        .slice(group.finalText.length)
        .trim();
      group.final = false;
    }
  }
  groups.forEach((group, index) => {
    group.question =
      group.speaker === 'them' &&
      (`${group.finalText} ${group.provisionalText}`.includes('?') ||
        raws[index]!.some((raw) => isAutoQuestion(raw)));
  });
  return groups;
}
