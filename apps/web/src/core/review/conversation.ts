/**
 * File: apps/web/src/core/review/conversation.ts
 * Purpose: A session's calls as one conversation, for the Transcript section's tabs and for its TXT and
 *          PDF downloads, with a divider between calls (v1.1.0). v1.3.2: laid out like an Otter export:
 *          turns ("<Speaker name>  <mm:ss>", then the words; one speaker's consecutive lines merged),
 *          each answer right after the turn it answered ("Paramount AI answered  <mm:ss>", "Question:",
 *          "Answer:"). The downloads leave out each answer's private note: it was never meant to be said
 *          or shared.
 * Used by: src/features/review/ConversationSection.tsx, ./downloadTranscript.ts
 * Depends on: src/core/answer/format.ts (splitAnswer, cardQuestion), src/core/answer/history.ts
 *             (one entry per question, v1.0.4), src/core/transcript/turns.ts (turns, mm:ss, names),
 *             src/core/storage/types.ts, ./pdf.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * Runs on this device only; nothing here is sent or logged.
 */
import { cardQuestion, splitAnswer } from '../answer/format';
import { mergeAnswers } from '../answer/history';
import { CALL_GAP_MS } from '../storage/migrate';
import type { Session, StoredAnswer, StoredUtterance } from '../storage/types';
import type { DisplayTerm } from '../transcript/display';
import type { TranscriptGroup } from '../transcript/group';
import { formatElapsed, lineTurns, speakerNames, type Turn } from '../transcript/turns';
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

/**
 * One thing on screen and in the downloads (v1.3.2): a turn, one of Kite's answers placed right after
 * the turn it answered, or a call's divider.
 */
export type ConversationEntry =
  | {
      /** One speaker's consecutive lines (core/transcript/turns.ts). */
      kind: 'turn';
      /** When its first line started (Unix ms). */
      at: number;
      /** Milliseconds since its call started (the mm:ss on its header). */
      elapsed: number;
      /** The turn. */
      turn: Turn<TranscriptGroup>;
    }
  | {
      /** One of Kite's answers. */
      kind: 'answer';
      /** When it was asked (Unix ms). */
      at: number;
      /** Milliseconds since its call started. */
      elapsed: number;
      /** The answer. */
      answer: StoredAnswer;
    }
  | {
      /**
       * The start of a call, when the session has more than one (v1.1.0), or (1.5.1) when the call heard
       * nothing from the other side.
       */
      kind: 'call';
      /** When it started (Unix ms): 1.5.1, the call's own start (its reference), not its first line. */
      at: number;
      /** 1.5.1 (ADR-0069): true when the call has lines but none from the other side. */
      noOtherSide?: boolean;
    };

/**
 * When a call started, for its mm:ss clock: the moment it connected when an answer recorded it (and it is
 * no later than the call's first item), otherwise the call's first item.
 *
 * @param call The call's items, in time order (at least one).
 * @returns The start (Unix ms).
 * Called from: conversationEntries(); tests
 */
export function callReference(call: readonly ConversationItem[]): number {
  const first = call[0]!.at;
  const known = call.flatMap((item) =>
    item.kind === 'answer' &&
    item.answer.callStartedAt !== undefined &&
    item.answer.callStartedAt <= first &&
    first - item.answer.callStartedAt < CALL_GAP_MS
      ? [item.answer.callStartedAt]
      : [],
  );
  return known.length > 0 ? Math.max(...known) : first;
}

/**
 * Which turn an answer follows (v1.3.2). An answer to something said goes after the turn holding the line
 * its question ended on (StoredAnswer.sourceLineId; a saved line's id ends with the live id). Without
 * one, or when that line is gone (merged into another, or cleared), and for chat and screenshot answers:
 * after the last turn that started at or before the answer's time.
 *
 * @param answer The answer.
 * @param turns  The call's turns, oldest first.
 * @param lines  The call's saved lines.
 * @returns The turn's index, or -1 to go before every turn.
 * Called from: conversationEntries(); tests
 */
export function answerAnchor(
  answer: Pick<StoredAnswer, 'mode' | 'sourceLineId' | 'createdAt'>,
  turns: readonly Pick<Turn<TranscriptGroup>, 'tStart' | 'parts'>[],
  lines: readonly Pick<StoredUtterance, 'id' | 'tStart'>[],
): number {
  const source = answer.mode === 'answer' ? answer.sourceLineId : undefined;
  if (source) {
    // Live line ids start again at u1 on every page load: the latest line with it, asked before.
    const line = lines
      .filter(
        (candidate) =>
          (candidate.id === source || candidate.id.endsWith(`:${source}`)) &&
          candidate.tStart <= answer.createdAt,
      )
      .reduce<Pick<StoredUtterance, 'id' | 'tStart'> | undefined>(
        (latest, candidate) =>
          latest === undefined || candidate.tStart >= latest.tStart ? candidate : latest,
        undefined,
      );
    const index = line
      ? turns.findIndex((turn) => turn.parts.some((part) => part.lineIds.includes(line.id)))
      : -1;
    if (index !== -1) return index;
  }
  return turns.findLastIndex((turn) => turn.tStart <= answer.createdAt);
}

/**
 * The conversation as turns with the answers placed in it (v1.3.2; v1.0.2 bubbles before): each call's
 * lines merged into turns (same speaker, no pause over 8 s), each answer right after the turn it
 * answered (answerAnchor()), and a divider before each call when a session has several. Every turn and
 * answer carries its time since its call started.
 *
 * @param items The conversation (conversationItems()), in time order.
 * @param terms The session's spellings to restore.
 * @returns The turns, answers and dividers, oldest first.
 * Called from: ConversationSection.tsx, paragraphs(); tests
 */
export function conversationEntries(
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
): ConversationEntry[] {
  const starts = callStarts(items);
  const calls: ConversationItem[][] = [];
  for (const item of items) {
    if (calls.length === 0 || starts.includes(item.at)) calls.push([]);
    calls.at(-1)!.push(item);
  }
  const entries: ConversationEntry[] = [];
  for (const call of calls) {
    const reference = callReference(call);
    const lines = call.flatMap((item) => (item.kind === 'line' ? [item.line] : []));
    // 1.5.1 (ADR-0069): a call that never heard the other side says so (its sound was not captured).
    const noOtherSide = lines.length > 0 && !lines.some((line) => line.speaker === 'them');
    if (starts.length > 1 || noOtherSide) {
      entries.push({ kind: 'call', at: reference, ...(noOtherSide ? { noOtherSide: true } : {}) });
    }
    const turns = lineTurns(lines, terms);
    // The answers after each turn (index -1: before the first), in the order they were asked.
    const after = new Map<number, StoredAnswer[]>();
    for (const item of call) {
      if (item.kind !== 'answer') continue;
      const index = answerAnchor(item.answer, turns, lines);
      after.set(index, [...(after.get(index) ?? []), item.answer]);
    }
    const answers = (index: number) => {
      for (const answer of (after.get(index) ?? []).sort((a, b) => a.createdAt - b.createdAt)) {
        entries.push({
          kind: 'answer',
          at: answer.createdAt,
          elapsed: answer.createdAt - reference,
          answer,
        });
      }
    };
    answers(-1);
    turns.forEach((turn, index) => {
      entries.push({ kind: 'turn', at: turn.tStart, elapsed: turn.tStart - reference, turn });
      answers(index);
    });
  }
  return entries;
}

/**
 * Puts the entries in the order asked for. Newest first keeps each divider above its own call, and each
 * answer under the turn it answered.
 *
 * @param entries     The entries, oldest first.
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
  return calls.reverse().flatMap((call) => {
    const divider = call[0]?.kind === 'call' ? [call[0]] : [];
    // A block is a turn with the answers after it (answers before the first turn make their own).
    const blocks: ConversationEntry[][] = [];
    for (const entry of call.slice(divider.length)) {
      if (entry.kind === 'turn' || blocks.length === 0) blocks.push([entry]);
      else blocks.at(-1)!.push(entry);
    }
    return [...divider, ...blocks.reverse().flat()];
  });
}

/**
 * The file name for a download.
 *
 * @param session   The session.
 * @param extension 'txt' or 'pdf'.
 * @returns For example "paramount-ai-transcript-lantern-freight.txt".
 * Called from: ConversationSection.tsx; tests
 */
export function transcriptFileName(session: Pick<Session, 'company'>, extension: string): string {
  const name = session.company
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `paramount-ai-transcript${name ? `-${name}` : ''}.${extension}`;
}

/** 1.5.1 (ADR-0069): under the divider of a call that heard nothing from the other side. */
export const NO_OTHER_SIDE_TEXT =
  'Nothing was heard from the other side in this call (their sound was not captured).';

/** The date and time on a call's divider in downloads. */
const CLOCK = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });

/**
 * How an answer is labelled (v1.3.2): "Paramount AI answered", with its type for a chat or screenshot
 * answer, and "private" for one the user read rather than said.
 *
 * @param answer The answer.
 * @returns For example "Paramount AI answered (chat)".
 * Called from: paragraphs(), ConversationSection.tsx; tests
 */
export function answerLabel(answer: Pick<StoredAnswer, 'mode' | 'meta'>): string {
  const kinds = [
    ...(answer.mode === 'answer' ? [] : [answer.mode]),
    ...(answer.meta?.target === 'kite' ? ['private'] : []),
  ];
  return `Paramount AI answered${kinds.length > 0 ? ` (${kinds.join(', ')})` : ''}`;
}

/**
 * The session fields a download uses. ADR-0093: contactName is the other person's name for the call
 * (callers pass the call's own name there, withTheirName()), and the type picks the fallback label.
 */
type DownloadSession = Pick<Session, 'company' | 'role' | 'contactName'> &
  Partial<Pick<Session, 'type'>>;

/**
 * The paragraphs of a download, shared by TXT and PDF so they always say the same (v1.3.2, the Otter
 * export format): blocks separated by one blank line. A turn is "<Speaker name>  <mm:ss>" then its words;
 * an answer is "Paramount AI answered  <mm:ss>" then "Question:" and "Answer:" lines, written out in full
 * (bullets, code, tip), never its private note.
 *
 * @param session     The session.
 * @param items       The conversation.
 * @param terms       The session's own spellings (displayTerms()).
 * @param accountName The account's display name, on the user's turns.
 * @returns The lines.
 * Called from: transcriptText(), transcriptPdf()
 */
function paragraphs(
  session: DownloadSession,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[],
  accountName: string | null | undefined,
): PdfLine[] {
  // v1.1.0: no empty brackets when a session has no company or role.
  const about = [session.company.trim(), session.role.trim() && `(${session.role.trim()})`]
    .filter(Boolean)
    .join(' ');
  const names = speakerNames(session, accountName);
  const blocks: PdfLine[][] = [
    [{ text: about ? `Paramount AI transcript: ${about}` : 'Paramount AI transcript', bold: true }],
  ];
  for (const entry of conversationEntries(items, terms)) {
    if (entry.kind === 'call') {
      // 1.5.1 (ADR-0069): every call, the first too, with its real start; and a call that heard nothing
      // from the other side says so (a short first call looked like noise before the second one).
      blocks.push([
        { text: `--- Call of ${CLOCK.format(entry.at)} ---`, bold: true },
        ...(entry.noOtherSide ? [{ text: NO_OTHER_SIDE_TEXT }] : []),
      ]);
      continue;
    }
    if (entry.kind === 'turn') {
      const who = entry.turn.speaker === 'you' ? names.you : names.them;
      blocks.push([
        { text: `${who}  ${formatElapsed(entry.elapsed)}`, bold: true },
        { text: entry.turn.finalText },
      ]);
      continue;
    }
    const { answer } = entry;
    const { headline, bullets, code, complexity, say, tip, alsoAsked } = splitAnswer(
      answer.text,
      true,
    );
    const question = cardQuestion(
      answer.question,
      answer.cleanQuestion,
      terms,
      `The latest from ${names.them}`,
    );
    const block: PdfLine[] = [
      { text: `${answerLabel(answer)}  ${formatElapsed(entry.elapsed)}`, bold: true },
      { text: `Question: ${question}` },
      { text: `Answer: ${headline}`.trimEnd() },
      ...bullets.map((bullet) => ({ text: `- ${bullet}` })),
      ...code.flatMap((piece) =>
        piece.text.split('\n').map((line) => ({ text: line, indent: 14 })),
      ),
    ];
    if (complexity) block.push({ text: `Complexity: ${complexity}` });
    // Labelled, so the file says which line is which.
    if (say) block.push({ text: `Say: ${say}` });
    if (tip) block.push({ text: `Tip: ${tip}` });
    // ADR-0133: the questions the answer left for the next press.
    if (alsoAsked) block.push({ text: `Also asked: ${alsoAsked}` });
    blocks.push(block);
  }
  return blocks.flatMap((block, index) => (index === 0 ? block : [{ text: '' }, ...block]));
}

/**
 * The conversation as plain text (v1.3.2: the Otter export format; code is indented four spaces).
 *
 * @param session     The session.
 * @param items       The conversation.
 * @param terms       The session's own spellings.
 * @param accountName The account's display name, on the user's turns ("You" when not given).
 * @returns The file's text, ending with one newline.
 * Called from: ConversationSection.tsx, downloadTranscript.ts; tests
 */
export function transcriptText(
  session: DownloadSession,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
  accountName?: string | null,
): string {
  return `${paragraphs(session, items, terms, accountName)
    .map((line) => `${line.indent ? '    ' : ''}${line.text}`)
    .join('\n')}\n`;
}

/**
 * The conversation as a PDF, with the same lines as the text file.
 *
 * @param session     The session.
 * @param items       The conversation.
 * @param terms       The session's own spellings.
 * @param accountName The account's display name, on the user's turns.
 * @returns The file, and whether some letters could not be drawn.
 * Called from: ConversationSection.tsx; tests
 */
export function transcriptPdf(
  session: DownloadSession,
  items: readonly ConversationItem[],
  terms: readonly DisplayTerm[] = [],
  accountName?: string | null,
): PdfResult {
  const title = session.company.trim()
    ? `Paramount AI transcript: ${session.company.trim()}`
    : 'Paramount AI transcript';
  return writePdf(title, paragraphs(session, items, terms, accountName));
}
