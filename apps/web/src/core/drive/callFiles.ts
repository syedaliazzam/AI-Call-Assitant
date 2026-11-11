/**
 * File: apps/web/src/core/drive/callFiles.ts
 * Purpose: The files a call saves to Drive's "Transcripts" folder (ADR-0072), made on this device from
 *          its saved data: the call's transcript as TXT and PDF (the same text as the review page's
 *          downloads, for this call only), and the call's AI notes as a PDF. A session with "Save
 *          transcript" off saves no transcript (the person chose not to keep one); its notes are still
 *          saved. Nothing here leaves the device except as those files, uploaded to the person's Drive.
 * Used by: src/core/drive/uploader.ts
 * Depends on: src/core/review/conversation.ts (transcriptText, transcriptPdf), src/core/review/pdf.ts,
 *             src/core/review/load.ts (formatCallTime), src/core/storage (answers, utterances, notes),
 *             src/core/transcript/display.ts
 * Architecture: ADR-0072; architecture §5 (Session review)
 */
import type { CallNotes } from '@kite/shared';
import { conversationItems, transcriptPdf, transcriptText } from '../review/conversation';
import { formatCallTime } from '../review/load';
import { writePdf, type PdfLine } from '../review/pdf';
import { listAnswers } from '../storage/answers';
import { getNotes } from '../storage/notes';
import type { DriveCall, Session, StoredAnswer, StoredUtterance } from '../storage/types';
import { listUtterances } from '../storage/utterances';
import { displayTerms } from '../transcript/display';
import type { CallFileKind } from './names';

/** Lines may start a little before the call's recorded start (the connect takes a moment), ms. */
const BEFORE_START_MS = 5_000;

/** A line ending just after End is still the call's (the last words are flushed at End), ms. */
const AFTER_END_MS = 60_000;

/** One file of a call, ready to upload. */
export interface CallFile {
  /** Which file. */
  kind: CallFileKind;
  /** Its bytes. */
  blob: Blob;
}

/**
 * The lines and answers of one call.
 *
 * @param lines   The session's saved lines.
 * @param answers The session's answers.
 * @param call    The call.
 * @returns The call's own lines and answers.
 * Called from: buildCallFiles(); tests
 */
export function callSlice(
  lines: readonly StoredUtterance[],
  answers: readonly StoredAnswer[],
  call: DriveCall,
): { lines: StoredUtterance[]; answers: StoredAnswer[] } {
  const from = call.startedAt - BEFORE_START_MS;
  const to = call.endedAt + AFTER_END_MS;
  return {
    lines: lines.filter((line) => line.tStart >= from && line.tStart <= to),
    answers: answers.filter((answer) =>
      answer.callStartedAt !== undefined
        ? answer.callStartedAt === call.startedAt
        : answer.createdAt >= from && answer.createdAt <= to,
    ),
  };
}

/**
 * The AI notes as PDF paragraphs: summary, the other side's questions (with whether an answer covered
 * them), next steps, and the parts too unclear to summarise. The proposed lessons are left out: they are
 * about Paramount AI's own answers, not the call.
 *
 * @param title The session's title.
 * @param notes The notes.
 * @returns The paragraphs.
 * Called from: notesPdf(); tests
 */
export function notesParagraphs(title: string, notes: CallNotes): PdfLine[] {
  const lines: PdfLine[] = [{ text: `Paramount AI notes: ${title}`, bold: true }];
  const section = (heading: string, body: PdfLine[]) => {
    if (body.length === 0) return;
    lines.push({ text: '' }, { text: heading, bold: true }, ...body);
  };
  section(
    'Summary',
    notes.summary.map((point) => ({ text: `- ${point}` })),
  );
  const answered = { yes: 'answered', partly: 'partly answered', no: 'not answered' } as const;
  section(
    'Questions',
    notes.questions.map((question) => ({
      text: `- ${formatCallTime(question.at)}  ${question.question} (${answered[question.answered]})`,
    })),
  );
  section(
    'Next steps',
    notes.nextSteps.map((step) => ({
      text: `- ${step.step}${step.owner ? ` (${step.owner})` : ''}`,
    })),
  );
  section(
    'Unclear parts',
    notes.unclear.map((part) => ({
      text: `- ${formatCallTime(part.from)}–${formatCallTime(part.to)}: ${part.reason}`,
    })),
  );
  return lines;
}

/**
 * The notes PDF's bytes.
 *
 * @param title The session's title.
 * @param notes The notes.
 * @returns The file.
 * Called from: buildCallFiles(); tests
 */
export function notesPdf(title: string, notes: CallNotes): Blob {
  const { bytes } = writePdf(`Paramount AI notes: ${title}`, notesParagraphs(title, notes));
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Makes a call's Transcripts files from this device's saved data.
 *
 * @param session     The session.
 * @param call        The call.
 * @param title       The session's title (names.ts sessionTitle()).
 * @param accountName The account's display name, on the user's turns (as in the review downloads).
 * @returns The files there is something for (none when nothing was saved).
 * Called from: uploader.ts (through its deps); tests
 */
export async function buildCallFiles(
  session: Session,
  call: DriveCall,
  title: string,
  accountName: string | null,
): Promise<CallFile[]> {
  const files: CallFile[] = [];
  if (session.saveTranscript) {
    const [allLines, allAnswers] = await Promise.all([
      listUtterances(session.id),
      listAnswers(session.id),
    ]);
    const slice = callSlice(allLines, allAnswers, call);
    if (slice.lines.length > 0 || slice.answers.length > 0) {
      const items = conversationItems(slice.lines, slice.answers);
      const terms = displayTerms(session);
      files.push({
        kind: 'transcript-txt',
        blob: new Blob([transcriptText(session, items, terms, accountName)], {
          type: 'text/plain;charset=utf-8',
        }),
      });
      files.push({
        kind: 'transcript-pdf',
        blob: new Blob([transcriptPdf(session, items, terms, accountName).bytes as BlobPart], {
          type: 'application/pdf',
        }),
      });
    }
  }
  const notes = await getNotes(session.id);
  // The notes kept are the latest call's; an earlier call's notes were replaced and are not saved.
  if (notes && notes.callStartedAt === call.startedAt) {
    files.push({ kind: 'notes-pdf', blob: notesPdf(title, notes.notes) });
  }
  return files;
}
