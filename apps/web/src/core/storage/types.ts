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
import type { AnswerMeta, BankGroup, CallNotes } from '@kite/shared';

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
  /** Wording: 'simple' (shown as "Plain"), 'professional' or 'technical'. */
  tone: 'simple' | 'professional' | 'technical';
  /**
   * v1.2.0: behavioural answers use Situation, Task, Action and Result bullets. Absent means off (older
   * sessions have no such field), and then the prompt is exactly what it was.
   */
  star?: boolean;
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
  /**
   * The company's domain, for its logo, when the user picked a suggestion (ADR-0048). Stays on this
   * device and is not sent with answers. Absent for a typed name.
   */
  companyDomain?: string;
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
  /**
   * v1.1.0 (ADR-0041): the name of the person on the call, shown on their transcript lines. Missing or
   * '': the line says "Client 1". Display only: it is not sent to Claude.
   */
  contactName?: string;
  /**
   * v1.1.0 (ADR-0041): how long the latest call lasted, in ms, for the home panel's card. Filled in for
   * older sessions by the version 8 upgrade (core/storage/migrate.ts).
   */
  lastCallMs?: number;
  /**
   * v1.2.0 (ADR-0045): when the hand-off file this copy came from was written (Unix ms). Only a newer
   * file replaces it. Absent on a session made on this device.
   */
  handoffAt?: number;
  /**
   * ADR-0067: the short summary of the session's documents other than the CV, written by the fast
   * model (POST /api/summary) and sent to the smart-model routes instead of those documents. Absent
   * until first needed; replaced when the documents change (the fingerprint no longer matches).
   */
  documentsSummary?: StoredDocumentsSummary;
  /**
   * 1.6.0 (ADR-0072): who else gets this session's "saved to Google Drive" email, instead of the list
   * in Settings. Absent or empty: the Settings list. Lower-case addresses; synced with the session.
   */
  driveAlsoNotify?: string[];
}

/** A session's documents summary (ADR-0067), as kept on the device. */
export interface StoredDocumentsSummary {
  /**
   * SHA-256 (hex) of the summarised documents' names and texts, in prompt order. A different
   * fingerprint means the documents changed and the summary must be written again.
   */
  fingerprint: string;
  /** The summary text. Never logged. */
  text: string;
  /** When it was written (Unix ms). */
  createdAt: number;
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
  /**
   * 1.5.1 (ADR-0069): set on the rows of a document longer than one row holds (core/documents/parts.ts):
   * which document, and where in it. listDocuments() joins them; absent on ordinary rows.
   */
  part?: DocumentPart;
}

/** 1.5.1 (ADR-0069): one stored part of a long document. */
export interface DocumentPart {
  /** The document's id (the first part's id). */
  group: string;
  /** This part's place, from 0. */
  index: number;
  /** How many parts the document has. */
  count: number;
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
  /**
   * The question as Claude cleaned it up (v1.0.2, ADR-0037). Missing on answers saved before
   * v1.0.2 and on answers from the v-previous rules; the card then shows `question`.
   */
  cleanQuestion?: string;
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
  /**
   * The answer's question type, who it is for and its source (ADR-0030). Missing on answers saved
   * earlier. No index uses it, so no new database version.
   */
  meta?: AnswerMeta;
  /**
   * The numbers, dates and names the claim check could not find in the documents or the call
   * (core/answer/claimCheck.ts), to underline again in the review. Missing means none.
   */
  claims?: string[];
  /**
   * v1.1.0 (ADR-0041): when the call this answer belongs to connected (Unix ms), so a session's calls
   * stay apart in the history. Filled in for older answers by the version 8 upgrade, which estimates
   * it from long gaps (core/storage/migrate.ts).
   */
  callStartedAt?: number;
  /**
   * v1.3.2: the id of the transcript line the question ended on (the live line id, for example "u12"; the
   * saved line's id ends with it), so Review and the downloads put the answer right after that turn.
   * Only answers to something said (mode 'answer'); missing on chat and screenshot answers and on
   * answers saved earlier, which are placed by their time. No index uses it, so no new database version.
   */
  sourceLineId?: string;
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

/** A file or past session attached to an Ask Kite chat: the chat keeps its own copy (ADR-0030). */
export interface ChatAttachment {
  /** Random id. */
  id: string;
  /** What to show and to tell Claude, for example 'resume.pdf'. */
  name: string;
  /** Where it came from. */
  kind: LibraryKind | 'session';
  /** Its text. The user's content; never logged. */
  text: string;
}

/** One message of an Ask Kite chat. */
export interface ChatMessage {
  /** Random id. */
  id: string;
  /** Who wrote it. */
  role: 'you' | 'kite';
  /** What was written. The user's content; never logged. */
  text: string;
  /** When it was written (Unix ms). */
  at: number;
  /** How many screenshots were pasted with it. The images themselves are never stored. */
  images?: number;
  /** Kite's message: its question type and source. */
  meta?: AnswerMeta;
}

/** An Ask Kite chat, stored on this device (ADR-0030). */
export interface StoredChat {
  /** Random id. */
  id: string;
  /** The chat's name: the start of its first question. */
  title: string;
  /** When it was started (Unix ms). */
  createdAt: number;
  /** When it last changed (Unix ms). The page lists the latest first. */
  updatedAt: number;
  /** What is attached to it. */
  attachments: ChatAttachment[];
  /** Its messages, oldest first. */
  messages: ChatMessage[];
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

/** Where a recording stands, as the account knows it (desktop 1.5.0, ADR-0068). */
export type RecordingStatus = 'recording' | 'complete' | 'recovered';

/**
 * One recording part, as the account keeps it (desktop 1.5.0, ADR-0068): when, how long, how big, the
 * file's name and which computer holds it. The video and sound stay on that computer and never sync;
 * this record syncs encrypted like the other call data (ADR-0049) and goes with its session.
 */
export interface StoredRecording {
  /** The part's id (a UUID; the shell's index uses the same id). */
  id: string;
  /** The session it belongs to. */
  sessionId: string;
  /** The meeting (one call) its parts belong to; Meetings shows a meeting's parts together. */
  meetingId: string;
  /** Which part of the meeting, from 1. */
  part: number;
  /** 'screen' (screen and sound) or 'audio' (sound only). */
  kind: 'screen' | 'audio';
  /** 'standard' (720p) or 'high' (1080p); absent for sound only. */
  quality?: 'standard' | 'high';
  /** When it started (Unix ms). */
  startedAt: number;
  /** Its length, ms (the time recorded so far while it records). */
  durationMs: number;
  /** The main file's size, bytes (0 until it stops). */
  bytes: number;
  /** The main file's name on that computer (no folder; never call details). */
  fileName: string;
  /** True when a stereo sound file (You left, Them right) was kept beside it. */
  hasStereo: boolean;
  /** The computer that holds the files: its random id (the desktop app's). */
  deviceId: string;
  /** That computer's name when it was recorded or last renamed ("Saved on <name>"). */
  deviceName: string;
  /** Recording, complete, or recovered after the app stopped during it. */
  status: RecordingStatus;
  /** When this record last changed (Unix ms). */
  updatedAt: number;
}

/**
 * One file a session's Google Drive upload saves (ADR-0072). Kept on this device only (never synced):
 * where it goes, how far it got, the resumable upload's address (so a restart or a lost connection
 * resumes instead of starting again) and, once saved, its Drive id (so a retry never makes a copy).
 */
export interface DriveFileJob {
  /**
   * Stable key: 'rec:<recordingId>:main' or ':stereo' for a recording's files, or
   * 'call:<callStartedAt>:transcript-txt' / ':transcript-pdf' / ':notes-pdf' for a call's files.
   */
  key: string;
  /** The session subfolder it goes into. */
  folder: 'Recordings' | 'Transcripts';
  /** Its name in Drive (names.ts). */
  name: string;
  /** The recording it comes from (recording files only). */
  recordingId?: string;
  /** The recording's main file or its stereo sound file (recording files only). */
  track?: 'main' | 'stereo';
  /** The recording's part (recording files only; 1.6.0 email labels). */
  part?: number;
  /** The call it belongs to (call files only). */
  callStartedAt?: number;
  /** Its size in bytes (0 until known). */
  bytes: number;
  /** Bytes Google has so far. */
  sent: number;
  /** The resumable upload session's address while uploading (valid about a week). */
  uploadUrl?: string;
  /** The file's Drive id once saved. */
  driveFileId?: string;
  /** True once saved, or once it can never be (the local file was deleted: see missing). */
  done: boolean;
  /** True when the local file was gone, so it was not saved. */
  missing?: boolean;
}

/**
 * Where a session's Drive upload stands:
 * - queued: waiting its turn (or to be retried);
 * - uploading: being saved now;
 * - paused: a call started; it carries on after the call;
 * - waiting: Google Drive needs the person (reason: 'reconnect', 'not-connected', 'no-folder',
 *   'save-off');
 * - done: every file is saved;
 * - error: it stopped (reason says why, for the person); Retry queues it again.
 */
export type DriveJobState = 'queued' | 'uploading' | 'paused' | 'waiting' | 'done' | 'error';

/** One call of a session that is saved to Drive. */
export interface DriveCall {
  /** When the call started (Unix ms). */
  startedAt: number;
  /** When it ended (Unix ms). */
  endedAt: number;
}

/**
 * A session's Google Drive upload (ADR-0072), on this device only (the `driveUploads` store, version
 * 11). Calls are added as they end; the session folder and its subfolders are made once and their Drive
 * ids kept, so nothing is ever made twice.
 */
export interface DriveSessionJob {
  /** The session (the key). */
  sessionId: string;
  /** The calls to save, oldest first. */
  calls: DriveCall[];
  /** The Drive folder the session folder was made in (a changed folder starts a new session folder). */
  parentId?: string;
  /** The session folder's Drive id. */
  folderId?: string;
  /** Its "Recordings" subfolder's Drive id. */
  recordingsId?: string;
  /** Its "Transcripts" subfolder's Drive id. */
  transcriptsId?: string;
  /** The files, in the order they are saved. */
  files: DriveFileJob[];
  /** Where it stands. */
  state: DriveJobState;
  /**
   * Why it waits or stopped, as a code (core/drive/reasons.ts has the words): 'reconnect',
   * 'not-connected', 'no-folder', 'save-off', 'folder-gone', 'network', 'refused', 'failed'.
   */
  reason?: string;
  /** True when the error may clear by itself (a lost connection): it is queued again after a while. */
  autoRetry?: boolean;
  /** True once the server has the "saved" notification for the latest finish (one email per session). */
  notified: boolean;
  /** True once the "saved" notice was shown on this device for the latest finish. */
  noticeShown: boolean;
  /**
   * How many saved files the server has been told about (1.6.0): more saved files than this means a
   * report is due. Absent on jobs made before the combined email.
   */
  reportedFiles?: number;
  /**
   * True for a job whose session must never be emailed automatically (1.6.0): sessions saved before the
   * combined email, and sessions uploaded with "Upload to Drive". Their email is sent from Settings.
   */
  manualEmail?: boolean;
  /** When the first call was queued (Unix ms). */
  queuedAt: number;
  /** When this record last changed (Unix ms). */
  updatedAt: number;
}
