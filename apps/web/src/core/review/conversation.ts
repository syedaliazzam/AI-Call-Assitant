/**
 * File: apps/web/src/core/review/conversation.ts
 * Purpose: A session's call as one conversation: transcript lines and Kite's answers merged in time
 *          order, for the Transcript section's chat layout and for its TXT and PDF downloads. The
 *          downloads leave out each answer's private note: it was never meant to be said or shared.
 * Used by: src/features/review/ConversationSection.tsx
 * Depends on: src/core/answer/format.ts (splitAnswer), src/core/transcript/display.ts (sentenceCase),
 *             src/core/storage/types.ts, ./pdf.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * Runs on this device only; nothing here is sent or logged.
 */
import { splitAnswer } from '../answer/format';
import type { Session, StoredAnswer, StoredUtterance } from '../storage/types';
import { sentenceCase } from '../transcript/display';
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
 * Merges lines and answers in time order. At the same moment the line comes first: an answer
 * follows what it answers.
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
    ...answers.map((answer) => ({ kind: 'answer' as const, at: answer.createdAt, answer })),
  ];
  return items.sort((a, b) => a.at - b.at || (a.kind === 'line' ? -1 : 1));
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
  return `kite-transcript${name ? `-${name}` : ''}.${extension}`;
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
  session: Pick<Session, 'company' | 'role'>,
  items: readonly ConversationItem[],
  terms: readonly string[],
): PdfLine[] {
  const out: PdfLine[] = [
    { text: `Kite transcript: ${session.company} (${session.role})`, bold: true },
    { text: '' },
  ];
  for (const item of items) {
    if (item.kind === 'line') {
      const who = item.line.speaker === 'you' ? 'You' : 'Them';
      out.push({
        text: `[${CLOCK.format(item.at)}] ${who}: ${sentenceCase(item.line.text, terms)}`,
      });
      continue;
    }
    const { headline, bullets, tip } = splitAnswer(item.answer.text);
    const question = item.answer.question ? ` (question: ${item.answer.question})` : '';
    out.push({ text: `[${CLOCK.format(item.at)}] Kite answer${question}`, bold: true });
    out.push({ text: headline, indent: 14 });
    for (const bullet of bullets) out.push({ text: `- ${bullet}`, indent: 14 });
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
  session: Pick<Session, 'company' | 'role'>,
  items: readonly ConversationItem[],
  terms: readonly string[] = [],
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
  session: Pick<Session, 'company' | 'role'>,
  items: readonly ConversationItem[],
  terms: readonly string[] = [],
): PdfResult {
  return writePdf(`Kite transcript: ${session.company}`, paragraphs(session, items, terms));
}
