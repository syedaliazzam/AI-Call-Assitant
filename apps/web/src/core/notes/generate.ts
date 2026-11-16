/**
 * File: apps/web/src/core/notes/generate.ts
 * Purpose: Asks the server to write a finished call's notes (POST /api/notes, Sonnet) and saves
 *          them on this device. Builds the request from what the live page has: the session and
 *          its documents, the call's final lines (in memory, whether or not the transcript is
 *          saved), and the call's answers with their ratings and notes. Never throws and never
 *          blocks End: it runs after the call, and a failure only means no notes (the outcome
 *          says when that was because Claude was unavailable, so the page can say so).
 * Used by: src/features/live/LivePage.tsx (at End); the review page's Regenerate (Stage 6)
 * Depends on: @kite/shared (notes types and limits), src/core/documents/summary.ts (the CV and a
 *             summary of the other documents, ADR-0067),
 *             src/core/answer/unavailable.ts (why Claude was unavailable),
 *             src/core/storage (notes.ts, types.ts), the browser's fetch
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 5
 *
 * Logs the session id, sizes, timings and token counts only; never transcript or notes text.
 */
import {
  MAX_ANSWER_CHARS,
  MAX_LINE_CHARS,
  MAX_NOTES_ANSWERS,
  MAX_NOTES_CHARS,
  MAX_NOTES_LINES,
  type CallLine,
  type NotesRequest,
  type NotesResponse,
} from '@kite/shared';
import { unavailableReason, type UnavailableReason } from '../answer/unavailable';
import {
  ensureDocumentsSummary,
  withDocumentsSummary,
  type SummaryDeps,
} from '../documents/summary';
import { saveNotes } from '../storage/notes';
import { pinFor } from '../answer/instructionsPin';
import type { Session, StoredAnswer, StoredDocument, StoredNotes } from '../storage/types';
import { theirName } from '../transcript/theirName';

/** A final transcript line, as the live page has it. */
export interface NotesLine {
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** What was said. */
  text: string;
  /** Start (Unix ms). */
  tStart: number;
}

/** Everything generateNotes() needs. */
export interface NotesInput {
  /** The session. */
  session: Session;
  /** Its documents. */
  documents: readonly StoredDocument[];
  /** The call's final lines (no echoes), oldest first. */
  lines: readonly NotesLine[];
  /** The session's answers (with ratings and notes); only this call's are sent. */
  answers: readonly StoredAnswer[];
  /** When the call connected (Unix ms). */
  callStartedAt: number;
  /**
   * ADR-0093: the call's own name for the other person (StoredCall.themName), which wins over the
   * session's contactName. Absent: the session's.
   */
  callTheirName?: string;
}

/** What generateNotes() needs from the outside (tests replace them). */
export interface NotesDeps {
  /** fetch. Default the browser's. */
  fetchImpl?: typeof fetch;
  /** Where the notes are saved. Default this device (core/storage/notes.ts). */
  save?: (notes: StoredNotes) => Promise<void>;
  /** Clock (Unix ms). Default Date.now. */
  now?: () => number;
  /** How the documents summary is written and kept (ADR-0067). Default the real ones. */
  summary?: SummaryDeps;
}

/**
 * Whole seconds since the call connected (never negative).
 *
 * @param unixMs        A time.
 * @param callStartedAt The call's start.
 * @returns Seconds.
 * Called from: notesRequest()
 */
function secondsSince(unixMs: number, callStartedAt: number): number {
  return Math.max(0, Math.floor((unixMs - callStartedAt) / 1000));
}

/**
 * Builds the notes request, within the limits: the newest lines are kept when a very long call
 * is over MAX_NOTES_CHARS or MAX_NOTES_LINES (about four hours of speech).
 *
 * The session goes as the smart model reads it (ADR-0067): the CV in full and the summary of the
 * other documents (withDocumentsSummary()).
 *
 * @param input   The call.
 * @param summary The documents summary from ensureDocumentsSummary() ('' or null: none).
 * @returns The request.
 * Called from: generateNotes(); core/review/ask.ts (askRequest()); tests
 */
export function notesRequest(input: NotesInput, summary: string | null = null): NotesRequest {
  const lines: CallLine[] = input.lines
    .filter((line) => line.text.trim() !== '')
    .map((line) => ({
      speaker: line.speaker,
      text: line.text.trim().slice(0, MAX_LINE_CHARS),
      at: secondsSince(line.tStart, input.callStartedAt),
    }));
  let first = Math.max(0, lines.length - MAX_NOTES_LINES);
  let total = lines.slice(first).reduce((sum, line) => sum + line.text.length, 0);
  while (total > MAX_NOTES_CHARS && first < lines.length) {
    total -= lines[first]!.text.length;
    first += 1;
  }
  const answers = [...input.answers]
    // A private Ask Kite answer was never part of the call (ADR-0030), so the notes must not read
    // it as something discussed.
    .filter((answer) => answer.meta?.target !== 'kite')
    .filter((answer) => answer.text.trim() !== '' && answer.createdAt >= input.callStartedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-MAX_NOTES_ANSWERS)
    .map((answer) => ({
      at: secondsSince(answer.createdAt, input.callStartedAt),
      mode: answer.mode,
      question: answer.question.slice(0, MAX_LINE_CHARS),
      text: answer.text.slice(0, MAX_ANSWER_CHARS),
      rating: answer.rating ?? null,
      note: (answer.note ?? '').slice(0, MAX_LINE_CHARS),
    }));
  // ADR-0093: the other person's name for this call goes as their speaker label (toSessionContext()
  // reads it from contactName).
  const named = theirName(input.session, { themName: input.callTheirName });
  return {
    session: withDocumentsSummary(
      { ...input.session, contactName: named },
      input.documents,
      summary,
    ),
    lines: lines.slice(first),
    answers,
  };
}

/** How writing the notes went. */
export type NotesOutcome =
  | {
      /** The notes were written and saved. */
      status: 'saved';
      /** The saved notes. */
      stored: StoredNotes;
    }
  | {
      /** The call had no lines and no answers, so nothing was sent. */
      status: 'skipped';
    }
  | {
      /** The notes could not be written (nothing was saved). */
      status: 'failed';
      /** Why Claude was unavailable (usage limit or overload), or null for any other failure. */
      unavailable: UnavailableReason | null;
    };

/** The JSON body of a failed /api/notes response. */
interface ErrorBody {
  /** The server's error code. */
  code?: string;
  /** The server's short message. */
  message?: string;
}

/**
 * Writes and saves a call's notes.
 *
 * @param input The call.
 * @param deps  fetch, save and clock (tests).
 * @returns 'saved' with the notes; 'skipped' when the call had nothing to write about; or
 *          'failed', with the reason when Claude was unavailable (usage limit or overload).
 * Called from: LivePage.tsx (at End, not awaited); the review page (Stage 6); tests
 */
export async function generateNotes(
  input: NotesInput,
  deps: NotesDeps = {},
): Promise<NotesOutcome> {
  const empty = notesRequest(input);
  if (empty.lines.length === 0 && empty.answers.length === 0) return { status: 'skipped' };
  // Written once per session and kept (usually already written when the call opened).
  // ADR-0083: the notes instructions version the call started with, when this page pinned it (a
  // Regenerate later, or another page, uses the version in force).
  const pin = pinFor(input.callStartedAt);
  const request: NotesRequest = {
    ...notesRequest(
      input,
      await ensureDocumentsSummary(input.session, input.documents, deps.summary),
    ),
    ...(pin ? { instructionsVersion: pin.notes } : {}),
  };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  const startedAt = performance.now();
  try {
    const response = await fetchImpl('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as ErrorBody;
      console.warn('notes: failed', {
        sessionId: input.session.id,
        status: response.status,
        code: failure.code,
      });
      return { status: 'failed', unavailable: unavailableReason(failure.code, failure.message) };
    }
    const body = (await response.json()) as NotesResponse;
    const stored: StoredNotes = {
      sessionId: input.session.id,
      notes: body.notes,
      callStartedAt: input.callStartedAt,
      createdAt: now(),
      fromAnswersOnly: request.lines.length === 0,
      // ADR-0093: the label the notes were written with, so a later rename can show the new one.
      ...(request.session.themName ? { writtenTheirName: request.session.themName } : {}),
    };
    await (deps.save ?? saveNotes)(stored);
    console.info('notes: saved', {
      sessionId: input.session.id,
      lines: request.lines.length,
      answers: request.answers.length,
      msTotal: Math.round(performance.now() - startedAt),
      serverMs: body.ms,
      input: body.usage.input_tokens,
      output: body.usage.output_tokens,
      cacheRead: body.usage.cache_read_input_tokens,
    });
    return { status: 'saved', stored };
  } catch {
    console.warn('notes: failed', { sessionId: input.session.id, code: 'network' });
    return { status: 'failed', unavailable: null };
  }
}
