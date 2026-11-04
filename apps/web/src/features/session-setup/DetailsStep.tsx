/**
 * File: apps/web/src/features/session-setup/DetailsStep.tsx
 * Purpose: Step 1 of the Create/Edit session wizard: session type, "Paste a job link", company,
 *          role or topic, contact name (v1.1.0), job description, and the Resume and Documents pickers
 *          (from the libraries, with upload), with the room left against the session's character cap.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: src/ui (Input, Select, Textarea), src/core/documents/limits.ts, ./draft.ts,
 *             ./labels.ts, ./JobLinkField.tsx, ./LibraryPicker.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2), §5 (Create session); ADR-0029
 *
 * Document text is never logged.
 */
'use client';

import type { JobImportFields } from '@kite/shared';
import { MAX_SESSION_CHARS, roomLeft } from '@/core/documents/limits';
import type { LibraryItem } from '@/core/storage/types';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { draftChars, type DetailsErrors, type SessionDraft } from './draft';
import { JobLinkField } from './JobLinkField';
import { SESSION_TYPE_OPTIONS } from './labels';
import { LibraryPicker } from './LibraryPicker';

/** Props for DetailsStep. */
export interface DetailsStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Problems with required fields (shown once the user tried to continue). */
  errors: DetailsErrors;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
  /** Chooses a library item for the session; returns why it does not fit, or null. */
  onPick: (item: LibraryItem) => string | null;
  /** Removes a document from the draft. */
  onRemoveDocument: (key: string) => void;
  /** Called with +n or -n as files start and finish being read. */
  onBusy: (delta: number) => void;
}

/**
 * Formats a character count, for example "12,345".
 *
 * @param n The count.
 * @returns The formatted number.
 */
function count(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Step 1: session details, resume and documents.
 *
 * @param props See DetailsStepProps.
 * @returns The step's fields.
 * Rendered by: SessionWizard.tsx (step 1)
 */
export function DetailsStep({
  draft,
  errors,
  onChange,
  onPick,
  onRemoveDocument,
  onBusy,
}: DetailsStepProps) {
  const used = draftChars(draft);
  // Interviews and mock interviews are about a job; a regular call is about a topic.
  const aboutJob = draft.type !== 'regular';

  /**
   * Fills in what a job link found. An empty field keeps what the user typed.
   *
   * @param fields What was found.
   */
  function applyImport(fields: JobImportFields) {
    onChange({
      ...(fields.company ? { company: fields.company } : {}),
      ...(fields.role ? { role: fields.role } : {}),
      ...(fields.description ? { description: fields.description } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Select
        label="Session type"
        options={SESSION_TYPE_OPTIONS}
        value={draft.type}
        onChange={(type) => onChange({ type })}
      />
      {aboutJob && <JobLinkField onImported={applyImport} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Input
          label="Company"
          value={draft.company}
          onChange={(event) => onChange({ company: event.target.value })}
          error={errors.company}
          placeholder="Who the call is with"
          maxLength={200}
        />
        <Input
          label={aboutJob ? 'Role' : 'Topic'}
          value={draft.role}
          onChange={(event) => onChange({ role: event.target.value })}
          error={errors.role}
          placeholder={aboutJob ? 'The job title' : 'What the call is about'}
          maxLength={200}
        />
      </div>
      <Input
        label="Contact name (optional)"
        value={draft.contactName}
        onChange={(event) => onChange({ contactName: event.target.value })}
        hint="Shown on their lines in the live transcript. Empty: they show as Client 1."
        maxLength={100}
      />
      <Textarea
        label={aboutJob ? 'Job description (optional)' : 'Description (optional)'}
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
        hint={
          aboutJob
            ? 'The job posting, or anything Paramount AI should know about this interview.'
            : 'Anything Paramount AI should know about this call: goals, people, background.'
        }
        rows={4}
        maxLength={5_000}
      />
      {aboutJob && (
        <LibraryPicker
          kind="resume"
          title="Resume (optional)"
          documents={draft.documents}
          onPick={onPick}
          onRemove={onRemoveDocument}
          onBusy={onBusy}
        />
      )}
      <LibraryPicker
        kind="document"
        title="Documents (optional)"
        documents={draft.documents}
        onPick={onPick}
        onRemove={onRemoveDocument}
        onBusy={onBusy}
      />
      <p className="text-[13px] text-ui-muted">
        {count(roomLeft(used))} of {count(MAX_SESSION_CHARS)} characters left in this session
      </p>
    </div>
  );
}
