/**
 * File: apps/web/src/core/storage/types.ts
 * Purpose: The shapes Kite stores on the user's device (IndexedDB): call sessions with their
 *          preferences, documents, transcript lines, answers and notes. Text fields hold the
 *          user's own content and are never logged (CLAUDE.md).
 * Used by: src/core/storage/db.ts and the repositories next to it (sessions.ts, documents.ts,
 *          utterances.ts, wipe.ts); from Stage 3 the session screens
 * Depends on: nothing
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (data model), §8.1 (where
 *               data lives); day-03-sessions.md Stage 1
 */

/** What kind of call a session is for (the dashboard's type filter tabs). */
export type SessionType = 'interview' | 'sales' | 'support' | 'internal';

/** Every session type, in the order the dashboard tabs show them. */
export const SESSION_TYPES: readonly SessionType[] = ['interview', 'sales', 'support', 'internal'];

/**
 * Where a session is in its life:
 * - 'not-started': created, never connected;
 * - 'live': a call is (or was last seen) running. A 'live' session with no activity for
 *   STALE_LIVE_MS is shown as 'ended' (see shownStatus() in sessions.ts);
 * - 'ended': the call was ended.
 */
export type SessionStatus = 'not-started' | 'live' | 'ended';

/** Which Claude model answers: 'fast' = Haiku (live answers), 'smart' = Sonnet. */
export type AnswerModel = 'fast' | 'smart';

/** How answers are laid out (architecture §7.2 "style"). */
export interface AnswerStyle {
  /** 'headline+bullets' (a short headline, then up to 5 bullets) or 'paragraph'. */
  format: 'headline+bullets' | 'paragraph';
  /** Rough answer length: 'short' (the live default), 'medium' or 'detailed'. */
  length: 'short' | 'medium' | 'detailed';
  /** Wording: 'simple' (plain language), 'professional' or 'friendly'. */
  tone: 'simple' | 'professional' | 'friendly';
}

/** A session's preferences (step 2 of the Create session wizard). */
export interface SessionPreferences {
  /** Transcription language. Only 'en' (English) exists in v1. */
  language: 'en';
  /** Which model answers during this session. */
  model: AnswerModel;
  /** How answers are written. */
  style: AnswerStyle;
  /**
   * Names and terms to listen for, typed by the user: one per line ('' = none). They become
   * speech-to-text hotwords for this session (Stage 4), ahead of terms found in documents.
   */
  keyTerms: string;
}

/** One call session (architecture §7.4 `sessions`). */
export interface Session {
  /** Random id (crypto.randomUUID()); also the /live/[id] URL segment. */
  id: string;
  /** What kind of call. */
  type: SessionType;
  /** Company the call is with ('' when not given). */
  company: string;
  /** Role (interview) or topic (other types) ('' when not given). */
  role: string;
  /** Free-text description of the call ('' when not given). */
  description: string;
  /** Preferences chosen in the wizard. */
  preferences: SessionPreferences;
  /** Extra instructions for the AI, typed by the user ('' = none). */
  instructions: string;
  /** True to save final transcript lines on this device; false keeps them in memory only. */
  saveTranscript: boolean;
  /** Auto-answer (beta). Always false until Day 6. */
  autoAnswer: boolean;
  /** When the session was created (Unix ms). The dashboard sorts by it, newest first. */
  createdAt: number;
  /** Stored status (see SessionStatus; the dashboard shows shownStatus()). */
  status: SessionStatus;
  /**
   * Last sign of a running call (Unix ms): set when the call connects and refreshed while it
   * runs. null = never connected.
   */
  lastActiveAt: number | null;
}

/** A document attached to a session, as extracted text (architecture §7.4 `documents`). */
export interface StoredDocument {
  /** Random id (crypto.randomUUID()). */
  id: string;
  /** The session it belongs to. */
  sessionId: string;
  /** Original file name, for example 'pricing.pdf' (shown in the wizard and sent to Claude). */
  name: string;
  /** The extracted plain text (never the original file). */
  text: string;
  /** Length of `text` in characters (UTF-16 code units, as JavaScript counts them). */
  chars: number;
  /** When it was added (Unix ms); documents are listed oldest first. */
  addedAt: number;
}

/** One final transcript line (architecture §7.4 `utterances`). Echo lines are never stored. */
export interface StoredUtterance {
  /** Unique id, chosen by the caller (stays the same when a merged line is saved again). */
  id: string;
  /** The session it belongs to. */
  sessionId: string;
  /** Who spoke: 'you' (microphone) or 'them' (the other side). */
  speaker: 'you' | 'them';
  /** What was said. */
  text: string;
  /** When it started (Unix ms, capture time). Lines are listed in this order. */
  tStart: number;
  /** When its last word changed (Unix ms, capture time). */
  tEnd: number;
}

/** One answer from Claude (architecture §7.4 `answers`). Written from Day 4. */
export interface StoredAnswer {
  /** Random id. */
  id: string;
  /** The session it belongs to. */
  sessionId: string;
  /** What asked for it: 'answer' (hotkey), 'chat' (typed question) or 'screenshot'. */
  mode: 'answer' | 'chat' | 'screenshot';
  /** The question it answers ('' for a screenshot without a question). */
  question: string;
  /** The answer text. */
  text: string;
  /** Which model answered. */
  model: AnswerModel;
  /** Request → first answer words, in ms (null when no text arrived). */
  msFirstToken: number | null;
  /** Request → answer complete, in ms. */
  msTotal: number;
  /** When it was asked (Unix ms). */
  createdAt: number;
}

/** AI notes written after a call (architecture §7.4 `notes`). Written from Day 5. */
export interface StoredNotes {
  /** The session they belong to (one set of notes per session, so it is also the key). */
  sessionId: string;
  /** Short summary of the call. */
  summary: string;
  /** Questions the other side asked, one per entry. */
  questions: string[];
  /** Agreed next steps, one per entry. */
  nextSteps: string[];
  /** When they were written (Unix ms). */
  createdAt: number;
}
