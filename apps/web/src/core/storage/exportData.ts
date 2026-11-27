/**
 * File: apps/web/src/core/storage/exportData.ts
 * Purpose: "Export my data" and "Import data" (Day 6): one JSON file with everything Kite keeps
 *          on this computer that a user would want to move or back up: sessions, documents
 *          (their extracted text, so a restore is complete; layout version 2), saved transcript
 *          lines, answers, notes and lesson decisions. Never audio (Kite stores none). The file is
 *          versioned and fully validated before anything is written; import merges: a record
 *          already on this computer (same id; for lessons also the same original proposal)
 *          is kept, so importing the same file twice adds nothing.
 * Used by: src/features/settings/DataTransfer.tsx
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts, zod
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (local storage); ADR-0024
 *
 * The file holds the user's own call content; it is never logged or sent anywhere.
 */
import {
  ANSWER_MODELS,
  ANSWER_TYPES,
  normaliseKeyTerms,
  type AnswerModel,
  type AnswerType,
} from '@kite/shared';
import { z } from 'zod';
import { getDb } from './db';
import { currentSessionType, currentTone } from './migrate';
import type {
  DocumentPart,
  LibraryItem,
  LibraryKind,
  StoredQuestionBank,
  Session,
  StoredAnswer,
  StoredChat,
  StoredLesson,
  StoredNotes,
  StoredUtterance,
} from './types';

/** The file's "format" value: tells a Kite export apart from any other JSON file. */
export const EXPORT_FORMAT = 'kite-export';

/**
 * The file layout version. Raise it when the layout changes, and keep reading older ones.
 * 1: documents as metadata only. 2: documents with their extracted text. 3: adds the Resume and
 * Document libraries. 4: adds the question banks.
 */
export const EXPORT_VERSION = 5;

/** Largest file accepted for import (50 MB): far above a year of calls, below browser limits. */
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

/** A document in the export. */
export interface ExportedDocument {
  /** Document id. */
  id: string;
  /** The session it belongs to. */
  sessionId: string;
  /** Original file name. */
  name: string;
  /** Length of its extracted text, in characters. */
  chars: number;
  /** When it was added (Unix ms). */
  addedAt: number;
  /** The extracted text (version 2). Missing in version 1 files: those documents are not restored. */
  text?: string;
  /** 'resume' for a session's resume; absent or 'document' otherwise. */
  kind?: LibraryKind;
  /** The library item it was copied from, if any. */
  sourceId?: string;
  /** 1.5.1 (ADR-0069): this row is one part of a long document (core/documents/parts.ts). */
  part?: DocumentPart;
}

/** The export file. */
export interface ExportFile {
  /** Always EXPORT_FORMAT. */
  format: typeof EXPORT_FORMAT;
  /** The layout version (EXPORT_VERSION when written). */
  version: number;
  /** When it was written (Unix ms). */
  exportedAt: number;
  /** All sessions. */
  sessions: Session[];
  /** Documents, with their text. */
  documents: ExportedDocument[];
  /** Saved transcript lines. */
  utterances: StoredUtterance[];
  /** Answers with ratings and notes. */
  answers: StoredAnswer[];
  /** Notes, one per session that has them. */
  notes: StoredNotes[];
  /** Lesson decisions (approved and rejected). */
  lessons: StoredLesson[];
  /** The Resume and Document libraries (version 3; absent in older files). */
  library?: LibraryItem[];
  /** The question banks (version 4; absent in older files). */
  questionBanks?: StoredQuestionBank[];
  /** The Ask Kite chats (version 5; absent in older files). */
  chats?: StoredChat[];
}

// Older files hold the old types and tones; they are read as today's (core/storage/migrate.ts).
const sessionType = z
  .enum(['interview', 'regular', 'mock', 'sales', 'support', 'internal'])
  .transform(currentSessionType);

/** Validation for each record type (matching core/storage/types.ts). */
const SessionSchema = z.object({
  id: z.string().min(1),
  type: sessionType,
  company: z.string(),
  companyDomain: z.string().optional(),
  role: z.string(),
  description: z.string(),
  preferences: z.object({
    language: z.string(),
    // ADR-0099: every answer model (the Gemini and GPT ones too).
    model: z.enum(ANSWER_MODELS as [AnswerModel, ...AnswerModel[]]),
    style: z.object({
      format: z.enum(['headline+bullets', 'bullets', 'paragraph']),
      length: z.enum(['short', 'medium', 'detailed']),
      tone: z.enum(['simple', 'professional', 'technical', 'friendly']).transform(currentTone),
      star: z.boolean().optional(),
    }),
    // An older export may hold a pasted comma list as one term: one clean term per line (v1.0.1).
    keyTerms: z.string().transform(normaliseKeyTerms),
  }),
  instructions: z.string(),
  saveTranscript: z.boolean(),
  autoAnswer: z.boolean(),
  createdAt: z.number(),
  status: z.enum(['not-started', 'live', 'ended']),
  lastActiveAt: z.number().nullable(),
  // v1.1.0: absent in older files.
  contactName: z.string().optional(),
  lastCallMs: z.number().optional(),
  handoffAt: z.number().optional(),
  // ADR-0129: a copy's own name ("Copy of Acme"); absent in older files and on other sessions.
  name: z.string().optional(),
});
const DocumentSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string(),
  chars: z.number(),
  addedAt: z.number(),
  text: z.string().optional(),
  kind: z.enum(['resume', 'document']).optional(),
  sourceId: z.string().optional(),
});
const QuestionBankSchema = z.object({
  sessionId: z.string().min(1),
  groups: z.array(
    z.object({
      type: z.enum(['behavioural', 'technical', 'role', 'company']),
      questions: z.array(z.object({ question: z.string(), answer: z.string() })),
    }),
  ),
  createdAt: z.number(),
});
const LibrarySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['resume', 'document']),
  name: z.string(),
  text: z.string(),
  chars: z.number(),
  addedAt: z.number(),
});
const UtteranceSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  speaker: z.enum(['you', 'them']),
  text: z.string(),
  tStart: z.number(),
  tEnd: z.number(),
});
const AnswerSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  mode: z.enum(['answer', 'chat', 'screenshot']),
  question: z.string(),
  // v1.0.2: this field was missing here, so an export dropped the cleaned question; fixed in v1.1.0.
  cleanQuestion: z.string().optional(),
  // v1.1.0: absent in older files.
  callStartedAt: z.number().optional(),
  text: z.string(),
  model: z.enum(ANSWER_MODELS as [AnswerModel, ...AnswerModel[]]),
  msFirstToken: z.number().nullable(),
  msTotal: z.number(),
  createdAt: z.number(),
  rating: z.enum(['up', 'down']).nullable(),
  note: z.string(),
  reported: z.boolean().optional(),
  meta: z
    .object({
      type: z.enum(ANSWER_TYPES as [AnswerType, ...AnswerType[]]),
      target: z.enum(['call', 'kite']),
      source: z.enum(['docs', 'call', 'general', 'example']),
    })
    .optional(),
  claims: z.array(z.string()).optional(),
});
const ChatSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  attachments: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      kind: z.enum(['resume', 'document', 'session']),
      text: z.string(),
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(['you', 'kite']),
      text: z.string(),
      at: z.number(),
      images: z.number().optional(),
      meta: z
        .object({
          type: z.enum(ANSWER_TYPES as [AnswerType, ...AnswerType[]]),
          target: z.enum(['call', 'kite']),
          source: z.enum(['docs', 'call', 'general', 'example']),
        })
        .optional(),
    }),
  ),
});
const NotesSchema = z.object({
  sessionId: z.string().min(1),
  notes: z.object({
    summary: z.array(z.string()),
    questions: z.array(z.looseObject({ question: z.string(), at: z.number() })),
    nextSteps: z.array(z.looseObject({ step: z.string(), owner: z.string() })),
    unclear: z.array(z.looseObject({ from: z.number(), to: z.number(), reason: z.string() })),
    lessons: z.array(z.looseObject({ text: z.string(), evidence: z.string() })),
  }),
  callStartedAt: z.number(),
  createdAt: z.number(),
  fromAnswersOnly: z.boolean().optional(),
});
const LessonSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  scope: z.union([z.literal('all'), sessionType]),
  status: z.enum(['approved', 'rejected']),
  sourceSessionId: z.string(),
  sourceKey: z.string(),
  evidence: z.string(),
  decidedAt: z.number(),
  approvedAt: z.number().nullable(),
});
const ExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int(),
  exportedAt: z.number(),
  sessions: z.array(SessionSchema),
  documents: z.array(DocumentSchema),
  utterances: z.array(UtteranceSchema),
  answers: z.array(AnswerSchema),
  notes: z.array(NotesSchema),
  lessons: z.array(LessonSchema),
  library: z.array(LibrarySchema).optional(),
  questionBanks: z.array(QuestionBankSchema).optional(),
  chats: z.array(ChatSchema).optional(),
});

/**
 * Reads everything to export.
 *
 * @param now The export time (Unix ms).
 * @returns The export file's contents.
 * Called from: DataTransfer.tsx ("Export my data"); tests
 */
export async function exportData(now = Date.now()): Promise<ExportFile> {
  const db = getDb();
  const documents = await db.documents.toArray();
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    sessions: await db.sessions.toArray(),
    documents: documents.map(
      ({ id, sessionId, name, chars, addedAt, text, kind, sourceId, part }) => ({
        id,
        sessionId,
        name,
        chars,
        addedAt,
        text,
        ...(kind ? { kind } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(part ? { part } : {}),
      }),
    ),
    utterances: await db.utterances.toArray(),
    answers: await db.answers.toArray(),
    notes: await db.notes.toArray(),
    lessons: await db.lessons.toArray(),
    library: await db.library.toArray(),
    questionBanks: await db.questionBanks.toArray(),
    chats: await db.chats.toArray(),
  };
}

/**
 * The file name for an export, for example "kite-export-2026-11-02.json".
 *
 * @param now The export time (Unix ms).
 * @returns The file name.
 * Called from: DataTransfer.tsx
 */
export function exportFileName(now = Date.now()): string {
  return `paramount-ai-export-${new Date(now).toISOString().slice(0, 10)}.json`;
}

/** The result of checking a file: the export, or why it cannot be imported. */
export type ParsedExport = ExportAccepted | ExportRejected;

/** A file that passed every check. */
export interface ExportAccepted {
  /** Always true. */
  ok: true;
  /** The checked export. */
  file: ExportFile;
}

/** A file that cannot be imported. */
export interface ExportRejected {
  /** Always false. */
  ok: false;
  /** Why, in words for the user (never the file's content). */
  error: string;
}

/**
 * Checks a file's text before anything is imported: size, JSON, format, version and every
 * record.
 *
 * @param text The file's text.
 * @returns The export, or a message for the user.
 * Called from: DataTransfer.tsx ("Import data"); tests
 */
export function parseExport(text: string): ParsedExport {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'This file is too large to be a Paramount AI export.' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not a Paramount AI export (it is not JSON).' };
  }
  const head = json as { format?: unknown; version?: unknown } | null;
  if (!head || typeof head !== 'object' || head.format !== EXPORT_FORMAT) {
    return { ok: false, error: 'This file is not a Paramount AI export.' };
  }
  if (typeof head.version !== 'number' || head.version > EXPORT_VERSION) {
    return {
      ok: false,
      error:
        'This export was made by a newer version of Paramount AI. Update Paramount AI, then import it.',
    };
  }
  const result = ExportSchema.safeParse(json);
  if (!result.success) {
    // Name the place only (for example "answers.3.rating"), never the content.
    const where = result.error.issues[0]?.path.join('.') ?? 'unknown';
    return {
      ok: false,
      error: `This Paramount AI export is damaged (at ${where}). Nothing was imported.`,
    };
  }
  // Every record field is checked above; the notes items are checked on the fields Kite reads
  // and kept whole (looseObject), so the type is narrowed through unknown.
  return { ok: true, file: result.data as unknown as ExportFile };
}

/** How many records of one kind were added, and how many were already here. */
export interface MergeCount {
  /** Added to this computer. */
  added: number;
  /** Already here (kept as they are). */
  skipped: number;
}

/** What an import did. */
export interface ImportSummary {
  /** Sessions. */
  sessions: MergeCount;
  /** Documents (with their text). */
  documents: MergeCount;
  /** Saved transcript lines. */
  utterances: MergeCount;
  /** Answers. */
  answers: MergeCount;
  /** Notes. */
  notes: MergeCount;
  /** Lesson decisions. */
  lessons: MergeCount;
  /** Library items (Resumes and Documents). */
  library: MergeCount;
  /** Question banks. */
  questionBanks: MergeCount;
  /** Ask Kite chats. */
  chats: MergeCount;
  /**
   * Documents a version 1 file lists by name only (no text), for sessions that were added: their
   * files must be attached again. Always 0 for version 2 files.
   */
  documentsToReattach: number;
}

/**
 * Picks the records whose key is not here yet.
 *
 * @param existing What bulkGet found for each record's key, in the same order (undefined when
 *                 the key is not here).
 * @param records  The file's records.
 * @returns The records to add, and the merge count.
 * Called from: importData()
 */
function missing<T>(
  existing: readonly unknown[],
  records: readonly T[],
): { toAdd: T[]; count: MergeCount } {
  const toAdd = records.filter((_, index) => existing[index] === undefined);
  return { toAdd, count: { added: toAdd.length, skipped: records.length - toAdd.length } };
}

/**
 * Imports a checked export by merging: records already on this computer are kept as they are,
 * so nothing is duplicated and importing the same file twice adds nothing. All in one
 * transaction: either everything new is added, or nothing is.
 *
 * @param file A file checked by parseExport().
 * @returns What was added and kept.
 * Called from: DataTransfer.tsx ("Import data"); tests
 */
export async function importData(file: ExportFile): Promise<ImportSummary> {
  const db = getDb();
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.documents,
      db.utterances,
      db.answers,
      db.notes,
      db.lessons,
      db.library,
      db.questionBanks,
      db.chats,
    ],
    async () => {
      const sessions = missing(
        await db.sessions.bulkGet(file.sessions.map((session) => session.id)),
        file.sessions,
      );
      // Only documents with their text can be restored (version 2); see documentsToReattach.
      const withText = file.documents.filter((document) => typeof document.text === 'string');
      const documents = missing(
        await db.documents.bulkGet(withText.map((document) => document.id)),
        withText,
      );
      const utterances = missing(
        await db.utterances.bulkGet(file.utterances.map((line) => line.id)),
        file.utterances,
      );
      const answers = missing(
        await db.answers.bulkGet(file.answers.map((answer) => answer.id)),
        file.answers,
      );
      const notes = missing(
        await db.notes.bulkGet(file.notes.map((entry) => entry.sessionId)),
        file.notes,
      );
      // Lessons: also skip a decision on the same original proposal (sourceKey), so a decision
      // made again on this computer is not doubled.
      const knownKeys = new Set((await db.lessons.toArray()).map((lesson) => lesson.sourceKey));
      const byId = await db.lessons.bulkGet(file.lessons.map((lesson) => lesson.id));
      const lessonsToAdd = file.lessons.filter(
        (lesson, index) => byId[index] === undefined && !knownKeys.has(lesson.sourceKey),
      );

      const fileLibrary = file.library ?? [];
      const library = missing(
        await db.library.bulkGet(fileLibrary.map((item) => item.id)),
        fileLibrary,
      );

      const fileBanks = file.questionBanks ?? [];
      const questionBanks = missing(
        await db.questionBanks.bulkGet(fileBanks.map((bank) => bank.sessionId)),
        fileBanks,
      );

      const fileChats = file.chats ?? [];
      const chats = missing(await db.chats.bulkGet(fileChats.map((chat) => chat.id)), fileChats);

      await db.sessions.bulkAdd(sessions.toAdd);
      await db.chats.bulkAdd(chats.toAdd);
      await db.questionBanks.bulkAdd(questionBanks.toAdd);
      await db.documents.bulkAdd(
        documents.toAdd.map(
          ({ id, sessionId, name, chars, addedAt, text, kind, sourceId, part }) => ({
            id,
            sessionId,
            name,
            chars,
            addedAt,
            text: text ?? '',
            ...(kind ? { kind } : {}),
            ...(sourceId ? { sourceId } : {}),
            // 1.5.1 (ADR-0069): a long document's part keeps its place.
            ...(part ? { part } : {}),
          }),
        ),
      );
      await db.library.bulkAdd(library.toAdd);
      await db.utterances.bulkAdd(utterances.toAdd);
      await db.answers.bulkAdd(answers.toAdd);
      await db.notes.bulkAdd(notes.toAdd);
      await db.lessons.bulkAdd(lessonsToAdd);

      const addedSessionIds = new Set(sessions.toAdd.map((session) => session.id));
      return {
        sessions: sessions.count,
        documents: documents.count,
        utterances: utterances.count,
        answers: answers.count,
        notes: notes.count,
        lessons: {
          added: lessonsToAdd.length,
          skipped: file.lessons.length - lessonsToAdd.length,
        },
        library: library.count,
        questionBanks: questionBanks.count,
        chats: chats.count,
        documentsToReattach: file.documents.filter(
          (document) => document.text === undefined && addedSessionIds.has(document.sessionId),
        ).length,
      };
    },
  );
}
