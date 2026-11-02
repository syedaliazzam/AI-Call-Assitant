/**
 * File: apps/web/src/core/storage/types.ts
 * Purpose: The shapes Kite stores on the user's device (IndexedDB): call sessions with their
 *          preferences, documents, transcript lines, answers and notes. Text fields hold the
 *          user's own content and are never logged (CLAUDE.md).
 * Used by: src/core/storage/db.ts and the repositories next to it (sessions.ts, documents.ts,
 *          utterances.ts, wipe.ts); from Stage 3 the session screens
 * Depends on: @kite/shared (CallNotes type)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (data model), §8.1 (where
 *               data lives); day-03-sessions.md Stage 1
 */
import type { BankGroup, CallNotes } from '@kite/shared';

/** What kind of call a session is for (the dashboard's type filter tabs). */
export type SessionType = 'interview' | 'regular' | 'mock';

/** Every session type, in the order the dashboard tabs show them. */
export const SESSION_TYPES: readonly SessionType[] = ['interview', 'regular', 'mock'];

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
  /**
   * 'headline+bullets' (shown as "Script + bullets": an answer line, then up to 5 bullets),
   * 'bullets' ("Bullets only") or 'paragraph' ("Script only"). The stored names stayed when the
   * labels changed, so existing sessions and the evaluation baselines stay valid (ADR-0029).
   */
  format: 'headline+bullets' | 'bullets' | 'paragraph';
  /** Rough answer length: 'short' (the live default), 'medium' (shown as "Balanced") or 'detailed'. */
  length: 'short' | 'medium' | 'detailed';
  /** Wording: 'simple' (plain language), 'professional' or 'technical'. */
  tone: 'simple' | 'professional' | 'technical';
}

/** The languages answers can be written in (live transcription stays English-only for now). */
export const ANSWER_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ur', label: 'Urdu' },
];

/**
 * The language to send with a request.
 *
 * @param code A language code from ANSWER_LANGUAGES.
 * @returns Its English name, or undefined for English and unknown codes (nothing is sent then).
 * Called from: core/answer/warm.ts (toSessionContext), AnswerPreferencesDialog.tsx
 */
export function answerLanguageName(code: string): string | undefined {
  if (code === 'en') return undefined;
  return ANSWER_LANGUAGES.find((language) => language.value === code)?.label;
}

/** A session's preferences (step 2 of the Create session wizard). */
export interface SessionPreferences {
  /**
   * The language answers are written in, as a code from ANSWER_LANGUAGES ('en' by default).
   * Live transcription stays English-only for now.
   */
  language: string;
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
  /** Auto-answer (beta) for this session, on top of the device-wide setting in Settings. */
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
  /** 'resume' for the session's resume; 'document' (or absent, in older rows) otherwise. */
  kind?: LibraryKind;
  /** The library item it was copied from, if any (the copy stays when that item is deleted). */
  sourceId?: string;
}

/** Which library an item is in. */
export type LibraryKind = 'resume' | 'document';

/** A file in the Resume or Document library, as extracted text (ADR-0029). */
export interface LibraryItem {
  /** Random id (crypto.randomUUID()). */
  id: string;
  /** Which library it is in. */
  kind: LibraryKind;
  /** Original file name, for example 'resume.pdf'. */
  name: string;
  /** The extracted plain text (never the original file). The user's content; never logged. */
  text: string;
  /** Length of `text` in characters (UTF-16 code units, as JavaScript counts them). */
  chars: number;
  /** When it was added (Unix ms). Libraries list newest first. */
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

/** The user's rating of an answer: thumbs up, thumbs down, or not rated. */
export type AnswerRating = 'up' | 'down' | null;

/**
 * One answer from Claude (architecture §7.4 `answers`). Written from Day 4, even when "Save
 * transcript" is off: the review page (Day 5) and the learning loop need the answers, their
 * ratings and notes. Deleted with the session.
 */
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
  /**
   * The user's rating (Day 4): 'up', 'down' or null. Day 5's notes step reads ratings to
   * propose lessons for the learning loop.
   */
  rating: AnswerRating;
  /** The user's note, "What was wrong / better answer" ('' when none). Day 4. */
  note: string;
  /**
   * True when the user reported this answer (ADR-0029): stored here with the note, and never sent
   * anywhere. Missing on answers saved earlier: read as false. No index uses it, so no new
   * database version.
   */
  reported?: boolean;
}

/**
 * Default preferences for new sessions (the Settings page). The wizard starts from these; each
 * session then keeps its own copy, so changing the defaults never changes existing sessions.
 * Key terms are not included: they belong to one call.
 */
export interface SessionDefaults {
  /** Default model. */
  model: AnswerModel;
  /** Default answer style. */
  style: AnswerStyle;
  /** Default AI instructions ('' = none). */
  instructions: string;
  /** Default for "save transcript". */
  saveTranscript: boolean;
}

/** One row of the `settings` store (database version 2). */
export interface StoredSettings {
  /** Which settings: only 'defaults' exists. */
  id: 'defaults';
  /** The default preferences for new sessions. */
  defaults: SessionDefaults;
  /** When they were last saved (Unix ms). */
  updatedAt: number;
}

/**
 * AI notes written after a call (architecture §7.4 `notes`), Day 5: the latest call's notes
 * for the session. They include proposed lessons, which are only suggestions until the user
 * approves one (Stage 7).
 */
export interface StoredNotes {
  /** The session they belong to (one set of notes per session, so it is also the key). */
  sessionId: string;
  /** The notes (summary, questions, next steps, unclear parts, proposed lessons). */
  notes: CallNotes;
  /** When the call they describe connected (Unix ms). */
  callStartedAt: number;
  /** When they were written (Unix ms). */
  createdAt: number;
  /**
   * True when they were written from the answers only, because no transcript lines were
   * available ("Save transcript" was off and they were regenerated from the review page).
   * The review page labels them "Written from answers only". Missing on notes saved before
   * Day 5 Stage 6: read as false. No index uses it, so no new database version.
   */
  fromAnswersOnly?: boolean;
}

/** Which sessions a lesson applies to: every session, or one session type. */
export type LessonScope = 'all' | SessionType;

/**
 * A decision on a lesson the notes proposed (architecture §7.4 `lessons`), Day 5 Stage 7.
 * Proposed lessons live only in the notes; this store holds the user's decisions, apart from
 * the notes, so regenerating the notes never loses or duplicates them. Only approved lessons
 * are sent to Claude. Lesson text is never logged.
 */
export interface StoredLesson {
  /** Unique id (random). */
  id: string;
  /**
   * The lesson as it is sent: one line, at most MAX_LESSON_CHARS (cleanLessonText()). The user
   * may have edited it from the proposal.
   */
  text: string;
  /** Which sessions it applies to. */
  scope: LessonScope;
  /** 'approved' (sent with answers) or 'rejected' (kept so it is not offered again). */
  status: 'approved' | 'rejected';
  /** The session whose notes proposed it (kept after that session is deleted, if approved). */
  sourceSessionId: string;
  /**
   * The proposal's original text, normalised (core/lessons/match.ts normaliseLesson()). It
   * never changes, even when the text is edited; a regenerated proposal is matched against it.
   */
  sourceKey: string;
  /** What the notes based it on (which answer, rating and note), shown in Settings. */
  evidence: string;
  /** When the decision was first made (Unix ms). */
  decidedAt: number;
  /**
   * When it was approved (Unix ms), or null when rejected. Lessons are sent oldest approval
   * first, so editing a lesson never moves it.
   */
  approvedAt: number | null;
}

/** A session's question bank (parity Phase 4). */
export interface StoredQuestionBank {
  /** The session it was written for (one per session, so it is also the key). */
  sessionId: string;
  /** The questions and suggested answers, by kind. */
  groups: BankGroup[];
  /** When it was written (Unix ms). */
  createdAt: number;
}
