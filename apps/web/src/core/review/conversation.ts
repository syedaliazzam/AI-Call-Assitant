/**
 * File: apps/web/src/core/review/conversation.ts
 * Purpose: A session's calls as one conversation: transcript lines and Kite's answers merged in time
 *          order, for the Transcript section's tabs and for its TXT and PDF downloads, with a divider
 *          between calls (v1.1.0). The downloads leave out each answer's private note: it was never
 *          meant to be said or shared.
 * Used by: src/features/review/ConversationSection.tsx
 * Depends on: src/core/answer/format.ts (splitAnswer, cardQuestion), src/core/answer/history.ts
 *             (one entry per question, v1.0.4), src/core/transcript/display.ts (sentenceCase),
 *             src/core/transcript/group.ts (bubbles), src/core/storage/types.ts, ./pdf.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * Runs on this device only; nothing here is sent or logged.
 */
import { cardQuestion, splitAnswer } from '../answer/format';
import { mergeAnswers } from '../answer/history';
import { CALL_GAP_MS } from '../storage/migrate';
import type { Session, StoredAnswer, StoredUtterance } from '../storage/types';
import { sentenceCase, type DisplayTerm } from '../transcript/display';
import { groupLines, type TranscriptGroup } from '../transcript/group';
import { writePdf, type PdfLine, type PdfResult } from './pdf';

/** One thing in the conversation. */
export type ConversationItem =
  | {
      /** A transcript line. */
      kind: 'line';
      /** When it started (Unix ms). */
      at: number;
      /** The line. */
      line: StoredUtterance;
    }
  | {
      /** One of Kite's answers. */
      kind: 'answer';
      /** When it was asked (Unix ms). */
      at: number;
      /** The answer. */
      answer: StoredAnswer;
    };

/**
 * Merges lines and answers in time order, with one answer per question (v1.0.4, ADR-0040). At the
 * same moment the line comes first: an answer follows what it answers.
 *
 * @param lines   The saved lines.
 * @param answers The saved answers.
 * @returns The conversation.
 * Called from: ConversationSection.tsx; transcriptText(), transcriptPdf(); tests
 */
export function conversationItems(
  lines: readonly StoredUtterance[],
  answers: readonly StoredAnswer[],
): ConversationItem[] {
  const items: ConversationItem[] = [
    ...lines.map((line) => ({ kind: 'line' as const, at: line.tStart, line })),
    ...mergeAnswers(answers, (answer) => answer.createdAt).list.map((answer) => ({
      kind: 'answer' as const,
      at: answer.createdAt,
      answer,
    })),
  ];
  return items.sort((a, b) => a.at - b.at || (a.kind === 'line' ? -1 : 1));
}

/**
 * When each call in a conversation starts (v1.1.0): a call starts at a long gap, or where an answer says
 * one started. Lines do not record their call, so this is the same estimate the database upgrade makes,
 * sharpened by the answers that know.
 *
 * @param items The conversation, in time order.
 * @returns The first item's time in each call, oldest first.
 * Called from: conversationEntries(), paragraphs(); tests
 */
export function callStarts(items: readonly ConversationItem[]): number[] {
  const known = items.flatMap((item) =>
    item.kind === 'answer' && item.answer.callStartedAt !== undefined
      ? [item.answer.callStartedAt]
      : [],
  );
  const starts: number[] = [];
  let last: number | null = null;
  for (const item of items) {
    const before: number | null = last;
    if (
      before === null ||
      item.at - before >= CALL_GAP_MS ||
      known.some((start) => start > before && start <= item.at)
    ) {
      starts.push(item.at);
    }
    last = item.at;
  }
  return starts;
}

/** One thing on screen in the chat layout: a bubble, one of Kite's answers, or a call's divider. */
export type ConversationEntry =
  | {
      /** A bubble: one speaker's lines with short pauses between them (v1.0.2). */
      kind: 'group';
      /** When its first line started (Unix ms). */
      at: number;
      /** The bubble. */
      group: TranscriptGroup;
    }
  | Extract<ConversationItem, { kind: 'answer' }>
  | {
      /** The start of a call, when the session has more than one (v1.1.0). */
      kind: 'call';
      /** When it started (Unix ms). */
      at: number;
    };

/**
 * The conversation for the chat layout (v1.0.2): each run of lines between two answers is
 * grouped into bubbles (groupLines(): same speaker, pauses up to 4 s), so a turn cut by pauses
 * reads as one bubble. Answers stay where they were in time order, and a session with several calls has
 * a divider before each. The downloads keep one row per line (transcriptText(), transcriptPdf()).
 *
 * @param items The conversation (conversationItems()), in time order.
 * @param terms The session's spellings to restore.
 * @returns The bubbles, answers and dividers, in time order.
 * Called from: ConversationSection.tsx; tests
 */
export function conversationEntries(
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  const starts = callStarts(items);
  const dividers = new Set(starts.length > 1 ? starts : []);
  let run: StoredUtterance[] = [];
  const flush = () => {
    // Saved lines are all final (only finished lines are stored).
    const groups = groupLines(
      run.map((line) => ({ ...line, final: true })),
      { terms },
    );
    for (const group of groups) entries.push({ kind: 'group', at: group.tStart, group });
    run = [];
  };
  for (const item of items) {
    if (dividers.has(item.at)) {
      flush();
      entries.push({ kind: 'call', at: item.at });
      // Two items can share a call's first moment: one divider.
      dividers.delete(item.at);
    }
    if (item.kind === 'line') run.push(item.line);
    else {
      flush();
      entries.push(item);
    }
  }
  flush();
  return entries;
}

/**
 * Puts the entries in the order asked for. Newest first keeps each divider above its own call, so it
 * still says what follows.
 *
 * @param entries     The entries, in time order.
 * @param oldestFirst True to leave them in time order.
 * @returns The entries to show.
 * Called from: ConversationSection.tsx; tests
 */
export function orderEntries(
  entries: readonly ConversationEntry[],
  oldestFirst: boolean,
): ConversationEntry[] {
  if (oldestFirst) return [...entries];
  const calls: ConversationEntry[][] = [[]];
  for (const entry of entries) {
    if (entry.kind === 'call') calls.push([entry]);
    else calls.at(-1)!.push(entry);
  }
  return calls.reverse().flatMap(([first, ...rest]) => {
    if (!first) return [];
    return first.kind === 'call' ? [first, ...rest.reverse()] : [...rest.reverse(), first];
  });
}

/**
 * The file name for a download.
 *
 * @param session   The session.
 * @param extension 'txt' or 'pdf'.
 * @returns For example "kite-transcript-lantern-freight.txt".
 * Called from: ConversationSection.tsx; tests
 */
export function transcriptFileName(session: Pick<Session, 'company'>, extension: string): string {
  const name = session.company
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `paramount-ai-transcript${name ? `-${name}` : ''}.${extension}`;
}

/** The time format in downloads. */
const CLOCK = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });

/**
 * The paragraphs of a download, shared by TXT and PDF so they always say the same.
 *
 * @param session The session.
 * @param items   The conversation.
 * @param terms   The session's own spellings (displayTerms()).
 * @returns The paragraphs.
 * Called from: transcriptText(), transcriptPdf()
 */
function paragraphs(
  session: Pick<Session, 'company' | 'role' | 'contactName'>,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[],
): PdfLine[] {
  // v1.1.0: no empty brackets when a session has no company or role.
  const about = [session.company.trim(), session.role.trim() && `(${session.role.trim()})`]
    .filter(Boolean)
    .join(' ');
  const out: PdfLine[] = [
    { text: about ? `Paramount AI transcript: ${about}` : 'Paramount AI transcript', bold: true },
    { text: '' },
  ];
  const them = session.contactName?.trim() || 'Them';
  const starts = callStarts(items);
  let lastKind: ConversationItem['kind'] | null = null;
  for (const item of items) {
    // v1.1.0: a divider between a session's calls, and a blank line around each answer.
    if (lastKind !== null && starts.includes(item.at)) {
      out.push(
        { text: '' },
        { text: `--- Call of ${CLOCK.format(item.at)} ---`, bold: true },
        { text: '' },
      );
    } else if (lastKind === 'answer' || (lastKind !== null && item.kind === 'answer')) {
      out.push({ text: '' });
    }
    lastKind = item.kind;
    if (item.kind === 'line') {
      const who = item.line.speaker === 'you' ? 'You' : them;
      out.push({
        text: `[${CLOCK.format(item.at)}] ${who}: ${sentenceCase(item.line.text, terms)}`,
      });
      continue;
    }
    const { headline, bullets, code, complexity, say, tip } = splitAnswer(item.answer.text, true);
    const question =
      item.answer.question || item.answer.cleanQuestion
        ? ` (question: ${cardQuestion(item.answer.question, item.answer.cleanQuestion, terms)})`
        : '';
    // A private answer was read by the user, not said on the call: the file says which it was.
    const kind = item.answer.meta?.target === 'kite' ? 'private answer' : 'answer';
    out.push({ text: `[${CLOCK.format(item.at)}] Paramount AI ${kind}${question}`, bold: true });
    out.push({ text: headline, indent: 14 });
    for (const bullet of bullets) out.push({ text: `- ${bullet}`, indent: 14 });
    for (const block of code) {
      for (const line of block.text.split('\n')) out.push({ text: line, indent: 14 });
    }
    if (complexity) out.push({ text: `Complexity: ${complexity}`, indent: 14 });
    if (say) out.push({ text: say, indent: 14 });
    if (tip) out.push({ text: tip, indent: 14 });
  }
  return out;
}

/**
 * The conversation as plain text.
 *
 * @param session The session.
 * @param items   The conversation.
 * @param terms   The session's own spellings.
 * @returns The file's text.
 * Called from: ConversationSection.tsx; tests
 */
export function transcriptText(
  session: Pick<Session, 'company' | 'role' | 'contactName'>,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
): string {
  return `${paragraphs(session, items, terms)
    .map((line) => `${line.indent ? '    ' : ''}${line.text}`)
    .join('\n')}\n`;
}

/**
 * The conversation as a PDF.
 *
 * @param session The session.
 * @param items   The conversation.
 * @param terms   The session's own spellings.
 * @returns The file, and whether some letters could not be drawn.
 * Called from: ConversationSection.tsx; tests
 */
export function transcriptPdf(
  session: Pick<Session, 'company' | 'role' | 'contactName'>,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
): PdfResult {
  const title = session.company.trim()
    ? `Paramount AI transcript: ${session.company.trim()}`
    : 'Paramount AI transcript';
  return writePdf(title, paragraphs(session, items, terms));
}
