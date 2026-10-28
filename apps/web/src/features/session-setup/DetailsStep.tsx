/**
 * File: apps/web/src/features/session-setup/DetailsStep.tsx
 * Purpose: Step 1 of the Create/Edit session wizard: session type, company, role or topic,
 *          description, and documents (drag-and-drop or picker, each with its size or error, and
 *          the room left against the session's character cap).
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: src/ui (Input, Select, Textarea, Button), src/core/documents/limits.ts,
 *             ./draft.ts, ./labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2), §5 (Create session);
 *               day-03-sessions.md Stage 3
 *
 * Reading the files happens in SessionWizard (it calls core/documents); this component only
 * shows the result. Document text is never logged.
 */
'use client';

import { useRef, useState, type DragEvent } from 'react';
import { MAX_SESSION_CHARS, roomLeft } from '@/core/documents/limits';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Textarea } from '@/ui/Textarea';
import { draftChars, type DetailsErrors, type SessionDraft } from './draft';
import { SESSION_TYPE_OPTIONS } from './labels';

/** A file that could not be added, shown under the document list. */
export interface DocumentProblem {
  /** Key for React lists. */
  key: string;
  /** The message for the user (names the file; never contains its text). */
  message: string;
}

/** Props for DetailsStep. */
export interface DetailsStepProps {
  /** The wizard's draft. */
  draft: SessionDraft;
  /** Problems with required fields (shown once the user tried to continue). */
  errors: DetailsErrors;
  /** Applies changes to the draft. */
  onChange: (changes: Partial<SessionDraft>) => void;
  /** Reads and adds the chosen or dropped files. */
  onAddFiles: (files: File[]) => void;
  /** Removes a document from the draft. */
  onRemoveDocument: (key: string) => void;
  /** Number of files still being read (0 = none). */
  readingCount: number;
  /** Files that could not be added. */
  problems: readonly DocumentProblem[];
  /** Hides one problem message. */
  onDismissProblem: (key: string) => void;
}

/** File types the picker offers (extensions and MIME types; extract.ts checks again). */
const ACCEPT =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

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
 * Step 1: session details and documents.
 *
 * @param props See DetailsStepProps.
 * @returns The step's fields.
 * Rendered by: SessionWizard.tsx (step 1)
 */
export function DetailsStep({
  draft,
  errors,
  onChange,
  onAddFiles,
  onRemoveDocument,
  readingCount,
  problems,
  onDismissProblem,
}: DetailsStepProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const used = draftChars(draft);

  /**
   * Adds files dropped on the drop zone.
   *
   * @param event The drop event.
   */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Without preventDefault the browser would open the dropped file instead.
    event.preventDefault();
    setDragging(false);
    onAddFiles([...event.dataTransfer.files]);
  }

  return (
    <div className="flex flex-col gap-5">
      <Select
        label="Session type"
        options={SESSION_TYPE_OPTIONS}
        value={draft.type}
        onChange={(type) => onChange({ type })}
      />
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
          label={draft.type === 'interview' ? 'Role' : 'Topic'}
          value={draft.role}
          onChange={(event) => onChange({ role: event.target.value })}
          error={errors.role}
          placeholder={draft.type === 'interview' ? 'The job title' : 'What the call is about'}
          maxLength={200}
        />
      </div>
      <Textarea
        label="Description (optional)"
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
        hint="Anything Kite should know about this call: goals, people, background."
        rows={4}
        maxLength={5_000}
      />

      <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="documents-heading" className="text-sm font-medium text-slate-800">
            Documents (optional)
          </h3>
          <span className="text-xs text-slate-500">
            {count(roomLeft(used))} of {count(MAX_SESSION_CHARS)} characters left
          </span>
        </div>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center',
            dragging ? 'border-brand-600 bg-brand-50' : 'border-slate-300 bg-white',
          ].join(' ')}
        >
          <p className="text-sm text-slate-700">Drop PDF, Word (.docx) or text files here</p>
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            Choose files
          </Button>
          <p className="text-xs text-slate-500">
            Read on this computer; only their text is kept. Up to 20 MB per file.
          </p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
              onAddFiles([...(event.target.files ?? [])]);
              // Clear it, so choosing the same file again still fires onChange.
              event.target.value = '';
            }}
          />
        </div>

        {readingCount > 0 && (
          <p role="status" className="text-sm text-slate-500">
            Reading {readingCount} file{readingCount === 1 ? '' : 's'}…
          </p>
        )}

        {draft.documents.length > 0 && (
          <ul className="flex flex-col divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
            {draft.documents.map((document) => (
              <li key={document.key} className="flex items-center justify-between gap-4 px-4 py-2">
                <span className="truncate text-sm text-slate-800">{document.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-500">{count(document.chars)} characters</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveDocument(document.key)}
                    aria-label={`Remove ${document.name}`}
                  >
                    Remove
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {problems.length > 0 && (
          <ul className="flex flex-col gap-2">
            {problems.map((problem) => (
              <li
                key={problem.key}
                role="alert"
                className="flex items-start justify-between gap-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-800"
              >
                <span>{problem.message}</span>
                <button
                  type="button"
                  onClick={() => onDismissProblem(problem.key)}
                  aria-label="Dismiss"
                  className="text-red-500 hover:text-red-800"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
