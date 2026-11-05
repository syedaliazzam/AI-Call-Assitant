/**
 * File: apps/web/src/features/session-setup/draft.ts
 * Purpose: The Create/Edit session wizard's working copy ("draft"): what it starts from, how
 *          the Details step is validated, and how a draft becomes the input the storage layer
 *          saves. No React; kept apart so the wizard's components stay small.
 * Used by: SessionWizard.tsx, DetailsStep.tsx, PreferencesStep.tsx
 * Depends on: src/core/storage (types, NewSessionInput, DocumentText)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2, F3), §7.4;
 *               day-03-sessions.md Stage 3
 */
import { normaliseKeyTerms } from '@kite/shared';
import type { DocumentText, NewSessionInput } from '@/core/storage/sessions';
import type {
  LibraryItem,
  LibraryKind,
  Session,
  SessionDefaults,
  SessionPreferences,
  SessionType,
  StoredDocument,
} from '@/core/storage/types';

/** One document in the wizard: already stored (edit) or just read from a file. */
export interface DraftDocument {
  /** Key for React lists (stable while the wizard is open). */
  key: string;
  /** The stored document's id, or undefined for a document added in this wizard. */
  storedId?: string;
  /** File name. */
  name: string;
  /** Extracted text (the user's content; never logged). */
  text: string;
  /** Length of `text` in characters. */
  chars: number;
  /** 'resume' for the session's resume; absent or 'document' otherwise. */
  kind?: LibraryKind;
  /** The library item it is a copy of, if any. */
  sourceId?: string;
}

/** Everything the wizard edits. */
export interface SessionDraft {
  /** Session type. */
  type: SessionType;
  /** Company ('' until typed; required). */
  company: string;
  /** The company's domain, when a suggestion was picked ('' for a typed name; ADR-0048). */
  companyDomain: string;
  /** Role (interview) or topic ('' until typed; required). */
  role: string;
  /** Free-text description (optional). */
  description: string;
  /** The name of the person on the call (optional; v1.1.0): shown on their transcript lines. */
  contactName: string;
  /** The documents to keep or add. */
  documents: DraftDocument[];
  /** Stored documents the user removed (edit only), deleted when the wizard saves. */
  removedIds: string[];
  /** Preferences (step 2). */
  preferences: SessionPreferences;
  /** AI instructions ('' = none). */
  instructions: string;
  /** Save the transcript on this device. */
  saveTranscript: boolean;
  /** Auto-answer (beta) for this session. */
  autoAnswer: boolean;
}

/** Problems with the Details step, by field (absent = fine). */
export interface DetailsErrors {
  /** Message for the company field. */
  company?: string;
  /** Message for the role or topic field. */
  role?: string;
}

/**
 * A new, empty draft starting from the user's default preferences.
 *
 * @param defaults The defaults from Settings.
 * @param type     The session type to start with.
 * @returns The draft.
 * Called from: SessionWizard (create)
 */
export function emptyDraft(
  defaults: SessionDefaults,
  type: SessionType = 'interview',
): SessionDraft {
  return {
    type,
    company: '',
    companyDomain: '',
    role: '',
    description: '',
    contactName: '',
    documents: [],
    removedIds: [],
    preferences: {
      language: 'en',
      model: defaults.model,
      style: { ...defaults.style },
      keyTerms: '',
    },
    instructions: defaults.instructions,
    saveTranscript: defaults.saveTranscript,
    autoAnswer: false,
  };
}

/**
 * A draft holding an existing session and its documents.
 *
 * @param session   The stored session.
 * @param documents Its stored documents.
 * @returns The draft.
 * Called from: SessionWizard (edit)
 */
export function draftFromSession(session: Session, documents: StoredDocument[]): SessionDraft {
  return {
    type: session.type,
    company: session.company,
    companyDomain: session.companyDomain ?? '',
    role: session.role,
    description: session.description,
    contactName: session.contactName ?? '',
    documents: documents.map((document) => ({
      key: document.id,
      storedId: document.id,
      name: document.name,
      text: document.text,
      chars: document.chars,
      ...(document.kind ? { kind: document.kind } : {}),
      ...(document.sourceId ? { sourceId: document.sourceId } : {}),
    })),
    removedIds: [],
    preferences: { ...session.preferences, style: { ...session.preferences.style } },
    instructions: session.instructions,
    saveTranscript: session.saveTranscript,
    autoAnswer: session.autoAnswer,
  };
}

/**
 * Checks the Details step's required fields: company and role/topic (both feed the session
 * prompt and the hotwords, so a session without them answers worse).
 *
 * @param draft The draft.
 * @returns The problems by field (an empty object when the step is complete).
 * Called from: SessionWizard (Next and Create/Save)
 */
export function validateDetails(draft: SessionDraft): DetailsErrors {
  const errors: DetailsErrors = {};
  if (draft.company.trim() === '') errors.company = 'Enter the company the call is with.';
  if (draft.role.trim() === '') {
    errors.role =
      draft.type === 'regular'
        ? 'Enter what the call is about.'
        : 'Enter the role you are interviewing for.';
  }
  return errors;
}

/**
 * The session fields to store, with surrounding spaces trimmed.
 *
 * @param draft The draft.
 * @returns Input for createSession / updateSession.
 * Called from: SessionWizard (Create/Save)
 */
export function draftToInput(draft: SessionDraft): NewSessionInput {
  return {
    type: draft.type,
    company: draft.company.trim(),
    // Absent for a typed name, so a session without one stores what it always has.
    ...(draft.companyDomain ? { companyDomain: draft.companyDomain } : {}),
    role: draft.role.trim(),
    description: draft.description.trim(),
    // Absent when empty, so a session without one stores what it always has.
    ...(draft.contactName.trim() ? { contactName: draft.contactName.trim() } : {}),
    // One clean term per line, however they were pasted (commas, semicolons, new lines; v1.0.1).
    preferences: { ...draft.preferences, keyTerms: normaliseKeyTerms(draft.preferences.keyTerms) },
    instructions: draft.instructions.trim(),
    saveTranscript: draft.saveTranscript,
    autoAnswer: draft.autoAnswer,
  };
}

/**
 * The documents added in this wizard (not yet stored).
 *
 * @param draft The draft.
 * @returns Their names and texts, in the order added.
 * Called from: SessionWizard (Create/Save)
 */
export function newDocuments(draft: SessionDraft): DocumentText[] {
  return draft.documents
    .filter((document) => document.storedId === undefined)
    .map(({ name, text, kind, sourceId }) => ({
      name,
      text,
      ...(kind ? { kind } : {}),
      ...(sourceId ? { sourceId } : {}),
    }));
}

/**
 * Total characters of the draft's documents (for the session cap).
 *
 * @param draft The draft.
 * @returns The sum of their sizes.
 * Called from: SessionWizard (adding files), DetailsStep (room left)
 */
export function draftChars(draft: SessionDraft): number {
  return draft.documents.reduce((sum, document) => sum + document.chars, 0);
}

/**
 * Which library a document belongs with.
 *
 * @param document The document.
 * @returns 'resume', or 'document' (also for older rows, which have no kind).
 * Called from: ContextFields.tsx, withLibraryItem(); tests
 */
export function documentKind(document: Pick<DraftDocument, 'kind'>): LibraryKind {
  return document.kind ?? 'document';
}

/**
 * Removes a document from the draft. A stored one is deleted when the wizard saves.
 *
 * @param draft The draft.
 * @param key   The document's list key.
 * @returns The changes to apply.
 * Called from: SessionWizard, withLibraryItem(); tests
 */
export function withoutDocument(
  draft: Pick<SessionDraft, 'documents' | 'removedIds'>,
  key: string,
): Pick<SessionDraft, 'documents' | 'removedIds'> {
  const document = draft.documents.find((candidate) => candidate.key === key);
  return {
    documents: draft.documents.filter((candidate) => candidate.key !== key),
    removedIds: document?.storedId ? [...draft.removedIds, document.storedId] : draft.removedIds,
  };
}

/**
 * Adds a copy of a library item to the draft. A session has one resume, so a new one replaces the
 * old. The text is copied, so deleting the library item later does not change the session.
 *
 * @param draft The draft.
 * @param item  The library item.
 * @param key   The new document's list key.
 * @returns The changes to apply.
 * Called from: SessionWizard; tests
 */
export function withLibraryItem(
  draft: Pick<SessionDraft, 'documents' | 'removedIds'>,
  item: LibraryItem,
  key: string,
): Pick<SessionDraft, 'documents' | 'removedIds'> {
  let next = { documents: draft.documents, removedIds: draft.removedIds };
  if (item.kind === 'resume') {
    for (const old of draft.documents.filter((document) => documentKind(document) === 'resume')) {
      next = withoutDocument(next, old.key);
    }
  }
  return {
    ...next,
    documents: [
      ...next.documents,
      {
        key,
        name: item.name,
        text: item.text,
        chars: item.chars,
        kind: item.kind,
        sourceId: item.id,
      },
    ],
  };
}
