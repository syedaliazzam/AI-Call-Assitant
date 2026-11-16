/**
 * File: apps/web/src/core/notes/regenerate.ts
 * Purpose: The review page's Regenerate (Day 5 Stage 6): writes a session's notes again from
 *          what this device saved, and replaces the old notes. ADR-0077: per call (regenerateCallNotes),
 *          saved as that call's own notes. Regenerate replaces the notes
 *          only. From Stage 7, lesson decisions (approved / rejected) live in their own store,
 *          so regenerating never loses or duplicates them.
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/notes/generate.ts (generateNotes), src/core/review/load.ts (ReviewData)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes), §7.4;
 *               day-05-overlay-screenshots-notes.md Stage 6
 *
 * Which call: the notes describe the latest call. Its start is the old notes' callStartedAt;
 * without notes, the earliest saved line or answer. Only lines from that start on are sent
 * (generateNotes() picks the answers the same way). When no transcript was saved, the notes
 * are written from the answers alone and saved with fromAnswersOnly = true.
 */
import type { CallView } from '../review/calls';
import type { ReviewData } from '../review/load';
import { saveCallNotes } from '../storage/callNotes';
import { updateCall } from '../storage/calls';
import { generateNotes, type NotesDeps, type NotesInput, type NotesOutcome } from './generate';

/**
 * When the call the notes describe started.
 *
 * @param review The review data.
 * @returns Unix ms: the old notes' call start, else the earliest saved line or answer, else
 *          when the session was created.
 * Called from: regenerateInput()
 */
function callStart(review: ReviewData): number {
  if (review.notes) return review.notes.callStartedAt;
  const times = [
    ...review.lines.map((line) => line.tStart),
    ...review.answers.map((answer) => answer.createdAt),
  ];
  return times.length > 0 ? Math.min(...times) : review.session.createdAt;
}

/**
 * Builds the notes input from the saved data.
 *
 * @param review The review data.
 * @returns The input for generateNotes().
 * Called from: regenerateNotes(); tests
 */
export function regenerateInput(review: ReviewData): NotesInput {
  const callStartedAt = callStart(review);
  return {
    session: review.session,
    documents: review.documents,
    lines: review.lines
      .filter((line) => line.tStart >= callStartedAt)
      .map((line) => ({ speaker: line.speaker, text: line.text, tStart: line.tStart })),
    answers: review.answers,
    callStartedAt,
  };
}

/**
 * Writes the notes again and replaces the saved ones (nothing else changes).
 *
 * @param review The review data.
 * @param deps   fetch, save and clock (tests).
 * @returns The outcome: 'saved' (with the new notes), 'skipped' (nothing saved to write
 *          from) or 'failed' (with the reason when Claude was unavailable). Never throws.
 * Called from: SessionReview.tsx (Regenerate / Write the notes)
 */
export function regenerateNotes(review: ReviewData, deps: NotesDeps = {}): Promise<NotesOutcome> {
  return generateNotes(regenerateInput(review), deps);
}

/**
 * ADR-0077: writes ONE call's notes again (or for the first time), from that call's own lines and
 * answers, and saves them as that call's notes (core/storage/callNotes.ts); a call with a record says its
 * notes are saved. Other calls' notes never change.
 *
 * @param review The review data (the session and its documents).
 * @param call   The call.
 * @param deps   fetch, save and clock (tests).
 * @returns The outcome, as regenerateNotes(). Never throws.
 * Called from: SessionReview.tsx (Regenerate / Write the notes on a call); tests
 */
export async function regenerateCallNotes(
  review: Pick<ReviewData, 'session' | 'documents'>,
  call: Pick<CallView, 'id' | 'startedAt' | 'lines' | 'answers' | 'record'>,
  deps: NotesDeps = {},
): Promise<NotesOutcome> {
  const outcome = await generateNotes(
    {
      session: review.session,
      documents: review.documents,
      lines: call.lines.map((line) => ({
        speaker: line.speaker,
        text: line.text,
        tStart: line.tStart,
      })),
      answers: call.answers,
      callStartedAt: call.startedAt,
      // ADR-0093: the call's own name for the other person.
      ...(call.record?.themName ? { callTheirName: call.record.themName } : {}),
    },
    {
      ...deps,
      save:
        deps.save ??
        ((stored) =>
          saveCallNotes({
            callId: call.id,
            sessionId: review.session.id,
            notes: stored.notes,
            callStartedAt: stored.callStartedAt,
            createdAt: stored.createdAt,
            ...(stored.fromAnswersOnly ? { fromAnswersOnly: true } : {}),
            ...(stored.writtenTheirName ? { writtenTheirName: stored.writtenTheirName } : {}),
          })),
    },
  );
  if (outcome.status === 'saved' && call.record) {
    await updateCall(call.id, { notesState: 'saved', notesError: undefined }).catch(() => false);
  }
  return outcome;
}
