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
import type { DocumentText, NewSessionInput } from '@/core/storage/sessions';
import type {
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
}

/** Everything the wizard edits. */
export interface SessionDraft {
  /** Session type. */
  type: SessionType;
  /** Company ('' until typed; required). */
  company: string;
  /** Role (interview) or topic ('' until typed; required). */
  role: string;
  /** Free-text description (optional). */
  description: string;
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
 * @returns The draft.
 * Called from: SessionWizard (create)
 */
export function emptyDraft(defaults: SessionDefaults): SessionDraft {
  return {
    type: 'interview',
    company: '',
    role: '',
    description: '',
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
    role: session.role,
    description: session.description,
    documents: documents.map((document) => ({
      key: document.id,
      storedId: document.id,
      name: document.name,
      text: document.text,
      chars: document.chars,
    })),
    removedIds: [],
    preferences: { ...session.preferences, style: { ...session.preferences.style } },
    instructions: session.instructions,
    saveTranscript: session.saveTranscript,
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
      draft.type === 'interview'
        ? 'Enter the role you are interviewing for.'
        : 'Enter what the call is about.';
  }
  return errors;
}

/**
 * The session fields to store, with surrounding spaces trimmed.
 *
 * @param draft The draft.
 * @returns Input for createSession / updateSession (auto-answer stays off until Day 6).
 * Called from: SessionWizard (Create/Save)
 */
export function draftToInput(draft: SessionDraft): NewSessionInput {
  return {
    type: draft.type,
    company: draft.company.trim(),
    role: draft.role.trim(),
    description: draft.description.trim(),
    preferences: { ...draft.preferences, keyTerms: draft.preferences.keyTerms.trim() },
    instructions: draft.instructions.trim(),
    saveTranscript: draft.saveTranscript,
    autoAnswer: false,
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
    .map(({ name, text }) => ({ name, text }));
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
