/**
 * File: packages/shared/src/notes.ts
 * Purpose: Request and response types for POST /api/notes (Day 5): the notes Kite writes after
 *          a call (summary, questions asked, next steps, the parts too unclear to summarise, and
 *          up to 3 proposed lessons), and the limits the server checks. Shared by the server
 *          route and the browser, so both agree on the format.
 * Used by: apps/web/src/server/notes.ts, apps/web/src/server/validate.ts,
 *          apps/web/app/api/notes/route.ts, apps/web/src/core/notes/generate.ts,
 *          apps/web/src/core/storage (notes)
 * Depends on: ./api.ts (CallLine, SessionContext, AnswerUsage)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2 (/api/notes), §7.4 (notes),
 *               §7.6 (learning loop); day-05-overlay-screenshots-notes.md Stage 5
 *
 * Proposed lessons are suggestions only: nothing becomes a lesson until the user approves it
 * (Stage 7). Notes text is never logged.
 */
import type { AnswerUsage, CallLine, SessionContext } from './api';

/** An answer Kite gave during the call, with what the user thought of it. */
export interface NotesAnswer {
  /** When it was asked, in whole seconds since the call connected. */
  at: number;
  /** How it was asked. */
  mode: 'answer' | 'chat' | 'screenshot';
  /** The question it answered. Never logged. */
  question: string;
  /** The answer text. Never logged. */
  text: string;
  /** The user's rating: 'up', 'down', or null when not rated. */
  rating: 'up' | 'down' | null;
  /** The user's note ("What was wrong / better answer"), '' when none. Never logged. */
  note: string;
}

/** Body of POST /api/notes. */
export interface NotesRequest {
  /** The session details (the same as for answers). */
  session: SessionContext;
  /** The call's final lines, oldest first (echo lines left out). */
  lines: CallLine[];
  /** The answers given in the call, oldest first. */
  answers: NotesAnswer[];
  /**
   * The AI-notes company instructions version the call started with (ADR-0083): a version id, or
   * 'none'. Absent: the version in force now (a Regenerate, or a page opened after the call).
   */
  instructionsVersion?: string;
}

/** A question the other side asked. */
export interface NotesQuestion {
  /** The question, in a few words. */
  question: string;
  /** When it was asked, in whole seconds since the call connected. */
  at: number;
  /** Whether a Kite answer covered it. */
  answered: 'yes' | 'partly' | 'no';
  /** The rating of that Kite answer (from the request, never from the model), or null. */
  rating: 'up' | 'down' | null;
}

/** A next step that was agreed. */
export interface NotesStep {
  /** What will happen. */
  step: string;
  /** Who does it, if someone was named ('' when not said). */
  owner: string;
}

/** A part of the call too unclear to summarise (garbled or missing transcript). */
export interface NotesUnclear {
  /** Start, in seconds since the call connected. */
  from: number;
  /** End, in seconds since the call connected. */
  to: number;
  /** Why it could not be summarised, in a few words. */
  reason: string;
}

/** A lesson the notes propose from the call's ratings and notes (a suggestion only). */
export interface ProposedLesson {
  /** The lesson, one sentence (for example "Give prices per seat and per month"). */
  text: string;
  /** What it is based on: which answer, its rating and note. */
  evidence: string;
}

/** The notes for one call. */
export interface CallNotes {
  /** The summary, at most MAX_SUMMARY_BULLETS bullets. */
  summary: string[];
  /** The questions the other side asked. */
  questions: NotesQuestion[];
  /** The agreed next steps. */
  nextSteps: NotesStep[];
  /** Parts too unclear to summarise (said instead of guessed). */
  unclear: NotesUnclear[];
  /** At most MAX_PROPOSED_LESSONS proposed lessons. */
  lessons: ProposedLesson[];
}

/** What POST /api/notes returns. */
export interface NotesResponse {
  /** The notes. */
  notes: CallNotes;
  /** Token counts. */
  usage: AnswerUsage;
  /** Server time, request to reply, in ms. */
  ms: number;
}

/** Most summary bullets. */
export const MAX_SUMMARY_BULLETS = 6;

/** Most proposed lessons per call. */
export const MAX_PROPOSED_LESSONS = 3;

/** Most transcript lines a notes request may carry (a 3-hour call is about 2,500). */
export const MAX_NOTES_LINES = 6_000;

/**
 * Most transcript characters a notes request may carry (about 60,000 tokens, about four hours
 * of speech). The client drops the oldest lines beyond it.
 */
export const MAX_NOTES_CHARS = 240_000;

/** Most answers a notes request may carry. */
export const MAX_NOTES_ANSWERS = 300;

/** Longest question in Ask AI, in characters. */
export const MAX_ASK_QUESTION_CHARS = 2_000;

/** Most earlier chat turns sent with a question. */
export const MAX_ASK_HISTORY = 20;

/** Longest chat turn sent back as history, in characters (long enough for any reply). */
export const MAX_ASK_TURN_CHARS = 4_000;

/** Longest AI notes text sent with a question, in characters. */
export const MAX_ASK_NOTES_CHARS = 20_000;

/** One turn of the Ask AI chat. */
export interface AskTurn {
  /** 'you' for the user's question, 'kite' for the reply. */
  role: 'you' | 'kite';
  /** What was said. Never logged. */
  text: string;
}

/** Body of POST /api/ask: the call as for the notes, its notes, and the question. */
export interface AskRequest extends Omit<NotesRequest, 'instructionsVersion'> {
  /** The AI notes as text ('' when there are none). */
  notes: string;
  /** The user's question. */
  question: string;
  /** The chat so far, oldest first. */
  history: AskTurn[];
}

/** Response of POST /api/ask. */
export interface AskResponse {
  /** Kite's reply. */
  text: string;
}
