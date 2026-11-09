/**
 * File: apps/web/src/features/session-setup/DetailsStep.tsx
 * Purpose: Step 1 of the Create/Edit session wizard (spec S4): session type, "Paste a job link", company,
 *          role or topic, job description, then Context: CV / Resume and Documents, with the room left
 *          against the session's character cap, and a collapsed Advanced section with Key terms at the
 *          bottom. Switching type keeps the fields they share. v1.3.0 (ADR-0057): Contact name is no
 *          longer asked for or shown; a session that has one keeps it unchanged.
 * Used by: src/features/session-setup/SessionWizard.tsx
 * Depends on: lucide-react, src/ui (Input, SegmentedControl, Textarea), src/core/documents/limits.ts,
 *             ./CompanyField.tsx, ./ContextFields.tsx, ./draft.ts, ./JobLinkField.tsx,
 *             ./KeyTermsInput.tsx, ./labels.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4); docs/architecture/kite-architecture-v3.1.md
 *               §2 (F2), §5; ADR-0029
 *
 * Document text is never logged.
 */
'use client';

import type { JobImportFields } from '@kite/shared';
import { Bot, Briefcase, ChevronRight, Phone } from 'lucide-react';
import { MAX_SESSION_CHARS, roomLeft } from '@/core/documents/limits';
import type { LibraryItem, SessionType } from '@/core/storage/types';
import { Input } from '@/ui/Input';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Textarea } from '@/ui/Textarea';
import { CompanyField } from './CompanyField';
import { LibraryField } from './ContextFields';
import { draftChars, type DetailsErrors, type SessionDraft } from './draft';
import { JobLinkField } from './JobLinkField';
import { KeyTermsInput } from './KeyTermsInput';
import { SESSION_TYPE_LABELS } from './labels';

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

/** The segment icons' size and stroke. */
const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The session types as segments. */
const TYPE_OPTIONS: readonly { value: SessionType; label: string; icon: React.ReactNode }[] = [
  { value: 'interview', label: SESSION_TYPE_LABELS.interview, icon: <Briefcase {...ICON} /> },
  { value: 'regular', label: SESSION_TYPE_LABELS.regular, icon: <Phone {...ICON} /> },
  { value: 'mock', label: SESSION_TYPE_LABELS.mock, icon: <Bot {...ICON} /> },
];

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
 * Step 1: session details and context.
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
      // A name from a job page has no known domain, whatever was picked before.
      ...(fields.company ? { company: fields.company, companyDomain: '' } : {}),
      ...(fields.role ? { role: fields.role } : {}),
      ...(fields.description ? { description: fields.description } : {}),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Leaves room for the window's ✕ at the top right. */}
      <div className="pr-8">
        <SegmentedControl
          label="Session type"
          options={TYPE_OPTIONS}
          value={draft.type}
          onChange={(type) => onChange({ type })}
        />
      </div>
      {aboutJob && <JobLinkField onImported={applyImport} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <CompanyField
          value={draft.company}
          error={errors.company}
          onChange={(company, companyDomain) => onChange({ company, companyDomain })}
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
      <Textarea
        label={aboutJob ? 'Job description' : 'Description'}
        value={draft.description}
        onChange={(event) => onChange({ description: event.target.value })}
        placeholder={aboutJob ? 'Paste the job description' : 'Goals, people, background'}
        rows={5}
        maxLength={5_000}
      />

      <section aria-label="Context" className="flex flex-col gap-3">
        <h2 className="text-section text-ui-muted">Context</h2>
        <div className={aboutJob ? 'grid gap-4 sm:grid-cols-2' : 'flex flex-col gap-4'}>
          {aboutJob && (
            <LibraryField
              kind="resume"
              documents={draft.documents}
              onPick={onPick}
              onRemove={onRemoveDocument}
              onBusy={onBusy}
            />
          )}
          <LibraryField
            kind="document"
            documents={draft.documents}
            onPick={onPick}
            onRemove={onRemoveDocument}
            onBusy={onBusy}
          />
        </div>
        <p className="text-[13px] text-ui-muted">
          {count(roomLeft(used))} of {count(MAX_SESSION_CHARS)} characters left in this session
        </p>
      </section>

      {/* v1.3.0 (ADR-0057): Key terms, collapsed until opened. */}
      <details className="group rounded-control border border-ui-border">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-label text-ui-text [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-ui-muted transition-transform duration-150 group-open:rotate-90"
          />
          Advanced
          {draft.preferences.keyTerms.trim() && (
            <span className="text-[13px] font-normal text-ui-muted">Key terms added</span>
          )}
        </summary>
        <div className="px-3 pb-3">
          <KeyTermsInput
            value={draft.preferences.keyTerms}
            onChange={(keyTerms) => onChange({ preferences: { ...draft.preferences, keyTerms } })}
          />
        </div>
      </details>
    </div>
  );
}
