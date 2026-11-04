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
 * Depends on: src/core/transcript/display.ts (sentence case), src/core/transcript/question.ts
 *             (questionSpan), src/core/transcript/questionKind.ts (lineKind),
 *             src/core/transcript/transcript.ts (Speaker)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session: transcript strip)
 *
 * Transcript text is only arranged for the screen here; it is never logged.
 */
import { continuationCase, sentenceCase, splitAtQuestions, type DisplayTerm } from './display';
import { questionSpan } from './question';
import { lineKind, looksGarbled } from './questionKind';
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

/**
 * All the words of a bubble, finished and still being heard: what "Answer this" asks (v1.0.4). A
 * question is often still grey when the button is pressed.
 *
 * @param group The bubble.
 * @returns The words.
 * Called from: LivePage.tsx, tests/visual/rig-live.tsx; tests
 */
export function groupWords(group: Pick<TranscriptGroup, 'finalText' | 'provisionalText'>): string {
  return `${group.finalText} ${group.provisionalText}`.trim();
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

/** A sentence end at the end of a text, allowing for closing quotes and brackets. */
const SENTENCE_END = /[.?!]["'’)\]]*\s*$/;

/** A question mark at the end of a text, allowing for closing quotes and brackets. */
const QUESTION_END = /\?["'’)\]]*\s*$/;

/**
 * Whether two lines of one speaker stay apart because a question is complete (v1.1.0, item 19): one
 * bubble holds one thing to answer. A pause can still cut one question in two ("what would it cost /
 * for forty seats"), so words that do not start a question stay with it, unless they follow a "?".
 *
 * @param before The line before, as the engine wrote it.
 * @param next   The next line, as the engine wrote it.
 * @returns True when the next line starts a new bubble.
 * Called from: groupLines(); tests
 */
export function questionEndsBubble(before: string, next: string): boolean {
  if (QUESTION_END.test(before)) return true;
  if (questionSpan(next)?.start !== 0) return false;
  return SENTENCE_END.test(before) || questionSpan(before) !== null;
}

/**
 * A finished line's pieces: written text splits at its questions (splitAtQuestions()), with times in
 * proportion to the words. A line still being heard stays whole: its words may change.
 *
 * @param line The line.
 * @returns The pieces, sharing the line's id.
 * Called from: groupLines()
 */
function linePieces(line: GroupLine): GroupLine[] {
  const texts = line.final ? splitAtQuestions(line.text) : [line.text];
  if (texts.length < 2) return [line];
  const total = texts.reduce((sum, text) => sum + wordCount(text), 0);
  const duration = Math.max(0, line.tEnd - line.tStart);
  let done = 0;
  return texts.map((text) => {
    const tStart = Math.round(line.tStart + (duration * done) / total);
    done += wordCount(text);
    return { ...line, text, tStart, tEnd: Math.round(line.tStart + (duration * done) / total) };
  });
}

/**
 * Finishes a bubble's text that came from an engine that writes marks (v1.1.0): the model leaves the end
 * of a line open, as more may follow, and by now nothing has. Text in capitals, from before the
 * punctuation pass, stays as it is.
 *
 * @param text The bubble's finished words.
 * @param raws Its lines, as the engine wrote them.
 * @returns The text with a mark at its end.
 * Called from: groupLines()
 */
function closeText(text: string, raws: readonly string[]): string {
  if (text === '' || SENTENCE_END.test(text)) return text;
  if (!raws.every((raw) => raw !== raw.toUpperCase())) return text;
  const lastSentence = text.split(/(?<=[.?!])\s+/).at(-1) ?? text;
  return `${text.replace(/[,;:]$/, '')}${questionSpan(lastSentence) !== null ? '?' : '.'}`;
}

/**
 * Groups lines into bubbles. A line joins the bubble before it when the speaker is the same, the
 * pause from the bubble's end to the line's start is at most gapMs, the bubble has fewer than
 * GROUP_MAX_WORDS words, and no question has just ended; otherwise it starts a new bubble. Empty lines
 * are left out.
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
  /** The ids handed out, so a line split into two bubbles still gives each its own. */
  const usedIds = new Set<string>();
  for (const line of lines.flatMap(linePieces)) {
    if (line.text.trim() === '') continue;
    const last = groups.at(-1);
    const lastRaw = raws.at(-1)?.at(-1);
    const joins =
      last !== undefined &&
      last.speaker === line.speaker &&
      line.tStart - last.tEnd <= gapMs &&
      // Words still settling are always the end of a bubble: nothing is joined after them.
      last.provisionalText === '' &&
      wordCount(last.finalText) < GROUP_MAX_WORDS &&
      !(lastRaw !== undefined && questionEndsBubble(lastRaw, line.text)) &&
      // Noise stays apart from speech, so it can collapse (v1.1.0) and a question stays clean.
      !(lastRaw !== undefined && line.final && looksGarbled(line.text) !== looksGarbled(lastRaw));
    if (!joins) {
      let id = line.id;
      for (let n = 1; usedIds.has(id); n += 1) id = `${line.id}#${n}`;
      usedIds.add(id);
      groups.push({
        id,
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
    if (group.lineIds.at(-1) !== line.id) group.lineIds.push(line.id);
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
    // v1.0.4: questionSpan() also finds a question after a lead-in or in the middle of a line, which
    // the speech model joins without punctuation ("GREAT SO HOW WOULD YOU…"). Same as the overlay's
    // live question, so the "?" mark and that line agree. v1.1.0: a greeting or an instruction worded
    // as a question ("how are you", "are you ready") is not one (ADR-0043).
    group.question =
      group.speaker === 'them' &&
      (`${group.finalText} ${group.provisionalText}`.includes('?') ||
        raws[index]!.some((raw) => questionSpan(raw) !== null)) &&
      raws[index]!.some((raw) => lineKind(raw) === 'question');
    if (group.final) group.finalText = closeText(group.finalText, raws[index]!);
  });
  return groups;
}
