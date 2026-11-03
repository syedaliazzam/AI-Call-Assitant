/**
 * File: apps/web/src/features/settings/DataTransfer.tsx
 * Purpose: Settings → Local data: "Export my data" (one JSON file with sessions, documents,
 *          saved transcripts, answers, notes and lessons; no audio), after a warning that the
 *          file is private, and "Import data" (checks the file, then merges it without
 *          duplicates), Day 6. Moves a user's Kite data between the browser and the desktop app,
 *          or to another computer.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/exportData.ts, src/ui/Button.tsx, src/ui/Dialog.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4 (local storage); ADR-0024
 */
'use client';

import { useRef, useState } from 'react';
import {
  exportData,
  exportFileName,
  importData,
  parseExport,
  type ImportSummary,
} from '@/core/storage/exportData';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/** The warning shown before the export is saved (developer's wording, Day 6). */
export const EXPORT_WARNING =
  'This file contains your session documents and transcripts — keep it private.';

/** What the section shows after an action. */
type Outcome = Exported | Imported | Failed;

/** The export was handed to the browser. */
interface Exported {
  /** Which outcome. */
  kind: 'exported';
  /** How many sessions it holds. */
  sessions: number;
}

/** A file was imported. */
interface Imported {
  /** Which outcome. */
  kind: 'imported';
  /** What was added and kept. */
  summary: ImportSummary;
}

/** Export or import failed. */
interface Failed {
  /** Which outcome. */
  kind: 'error';
  /** What to tell the user. */
  message: string;
}

/**
 * Describes an import in one sentence.
 *
 * @param summary What the import added and kept.
 * @returns The sentence.
 * Called from: DataTransfer (status line)
 */
export function importSentence(summary: ImportSummary): string {
  const added = `Added ${summary.sessions.added} sessions, ${summary.documents.added} documents, ${summary.utterances.added} transcript lines, ${summary.answers.added} answers, ${summary.notes.added} notes and ${summary.lessons.added} lessons.`;
  const kept =
    summary.sessions.skipped > 0
      ? ` ${summary.sessions.skipped} sessions were already on this computer and were kept as they are.`
      : '';
  const documents =
    summary.documentsToReattach > 0
      ? ` This older export lists ${summary.documentsToReattach} documents by name only: attach the files again to use them in answers.`
      : '';
  return added + kept + documents;
}

/**
 * The export and import buttons with their status line.
 *
 * @returns The controls.
 * Rendered by: Settings.tsx (Local data section)
 */
export function DataTransfer() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [warning, setWarning] = useState(false);

  /** Builds the export and hands it to the browser as a download (after the warning). */
  async function handleExport() {
    setWarning(false);
    setBusy(true);
    try {
      const file = await exportData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName(file.exportedAt);
      link.click();
      // The download has started; the URL is no longer needed.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setOutcome({ kind: 'exported', sessions: file.sessions.length });
    } catch {
      setOutcome({ kind: 'error', message: 'Kite could not export your data. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reads the chosen file, checks it, and merges it.
   *
   * @param file The file the user picked.
   */
  async function handleImport(file: File) {
    setBusy(true);
    try {
      const parsed = parseExport(await file.text());
      if (!parsed.ok) {
        setOutcome({ kind: 'error', message: parsed.error });
        return;
      }
      setOutcome({ kind: 'imported', summary: await importData(parsed.file) });
    } catch {
      setOutcome({
        kind: 'error',
        message: 'Kite could not import this file. Nothing was changed.',
      });
    } finally {
      setBusy(false);
      // The same file can be picked again.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  return (
    <div className="mb-6">
      <p className="mb-4 text-[13px] text-ui-muted">
        Export saves your sessions, documents, saved transcripts, answers, notes and lessons in one
        file (never audio). Import adds a file&rsquo;s data here; anything already on this computer
        stays as it is.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setWarning(true)} disabled={busy}>
          Export my data
        </Button>
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>
          Import data
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Kite export file to import"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
          }}
        />
      </div>
      <Dialog
        open={warning}
        onClose={() => setWarning(false)}
        title="Export my data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWarning(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleExport()}>Save file</Button>
          </>
        }
      >
        <p className="text-[13px] text-ui-text">{EXPORT_WARNING}</p>
      </Dialog>
      {outcome?.kind === 'exported' && (
        <p role="status" className="mt-3 text-[13px] text-ui-success">
          Exported {outcome.sessions} sessions. Keep the file somewhere safe: it holds your call
          transcripts and answers.
        </p>
      )}
      {outcome?.kind === 'imported' && (
        <p role="status" className="mt-3 text-[13px] text-ui-success">
          {importSentence(outcome.summary)}
        </p>
      )}
      {outcome?.kind === 'error' && (
        <p role="alert" className="mt-3 text-[13px] text-ui-danger">
          {outcome.message}
        </p>
      )}
    </div>
  );
}
