/**
 * File: apps/web/src/features/session-setup/JobLinkField.tsx
 * Purpose: "Paste a job link" in the wizard: asks the server to read a public job page, fills in
 *          what it found, and says what was imported, so the user can check and change it.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: src/core/session/jobImport.ts, src/ui (Button, Input)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2), §7.2; ADR-0029
 */
'use client';

import { useState, type KeyboardEvent } from 'react';
import type { JobImportFields } from '@kite/shared';
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
 * @returns The field, its button and the result.
 * Rendered by: DetailsStep.tsx
 */
export function JobLinkField({ onImported }: JobLinkFieldProps) {
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
      setResult({
        good: false,
        text: `No job details found on ${outcome.host}. Type them below instead.`,
      });
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
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            label="Paste a job link (optional)"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="https://…"
            inputMode="url"
            maxLength={2_000}
          />
        </div>
        <Button variant="secondary" onClick={() => void run()} disabled={busy || url.trim() === ''}>
          {busy ? 'Reading…' : 'Import'}
        </Button>
      </div>
      {result && (
        <p
          role={result.good ? 'status' : 'alert'}
          className={
            result.good
              ? 'border-l-[3px] border-ui-accent bg-ui-pale px-3 py-2 text-sm text-ui-text'
              : 'border-l-[3px] border-ui-warning bg-ui-warning-bg px-3 py-2 text-sm text-ui-text'
          }
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
