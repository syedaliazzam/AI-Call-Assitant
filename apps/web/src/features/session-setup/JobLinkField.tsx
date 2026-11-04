/**
 * File: apps/web/src/features/session-setup/JobLinkField.tsx
 * Purpose: "Paste a job link" in the wizard (spec S4, §6): a full-width button that opens a box for the
 *          address, asks the server to read that public job page, fills in what it found, and says what
 *          was imported, so the user can check and change it.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: lucide-react, src/core/session/jobImport.ts, src/ui (Button, Input)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4), §6;
 *               docs/architecture/kite-architecture-v3.1.md §2 (F2), §7.2; ADR-0029
 */
'use client';

import { JOB_LINK_FAILED, type JobImportFields } from '@kite/shared';
import { Sparkles } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { importJobLink } from '@/core/session/jobImport';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

/** Props for JobLinkField. */
export interface JobLinkFieldProps {
  /** Takes what was found. */
  onImported: (fields: JobImportFields) => void;
}

/**
 * Which fields an import found, in words.
 *
 * @param fields What was found.
 * @returns For example "company, role and job description", or '' when nothing was.
 * Called from: JobLinkField; tests through the harness
 */
function foundWords(fields: JobImportFields): string {
  const found = [
    ...(fields.company ? ['company'] : []),
    ...(fields.role ? ['role'] : []),
    ...(fields.description ? ['job description'] : []),
  ];
  if (found.length < 2) return found.join('');
  return `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}`;
}

/**
 * The job link field.
 *
 * @param props See JobLinkFieldProps.
 * @returns The helper line and the button, or the box with its button, and the result.
 * Rendered by: DetailsStep.tsx
 */
export function JobLinkField({ onImported }: JobLinkFieldProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null);

  /** Reads the link and fills in what it found. */
  async function run() {
    if (!url.trim() || busy) return;
    setBusy(true);
    setResult(null);
    const outcome = await importJobLink(url.trim());
    setBusy(false);
    if (!outcome.ok) {
      setResult({ good: false, text: outcome.message });
      return;
    }
    const words = foundWords(outcome.fields);
    if (!words) {
      setResult({ good: false, text: JOB_LINK_FAILED });
      return;
    }
    onImported(outcome.fields);
    setResult({
      good: true,
      text: `Imported the ${words} from ${outcome.host}. Check them below and change anything.`,
    });
  }

  /**
   * Enter reads the link instead of doing nothing.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void run();
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {open ? (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="Job post link"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="https://…"
              inputMode="url"
              maxLength={2_000}
              autoFocus
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => void run()}
            disabled={busy || url.trim() === ''}
          >
            {busy ? 'Reading…' : 'Import'}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-helper text-ui-muted">
            Got a job post link? We’ll fill in the details for you.
          </p>
          <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
            <Sparkles aria-hidden="true" size={16} />
            Paste a job link
          </Button>
        </>
      )}
      {result && (
        <p
          role={result.good ? 'status' : 'alert'}
          className={
            result.good
              ? 'rounded-control border border-ui-accent bg-ui-pale px-3 py-2 text-helper text-ui-text'
              : 'rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-helper text-ui-text'
          }
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
