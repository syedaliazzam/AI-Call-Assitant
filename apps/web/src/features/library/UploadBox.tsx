/**
 * File: apps/web/src/features/library/UploadBox.tsx
 * Purpose: The upload area shared by the library pages and the wizard's pickers: drop files or
 *          press the button, see what is being read, and see any file that could not be read.
 * Used by: src/features/library/LibraryPage.tsx, src/features/session-setup/LibraryPicker.tsx
 * Depends on: src/ui/Button.tsx, ./useLibraryUpload.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 */
'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/ui/Button';
import { UPLOAD_ACCEPT, type UploadProblem } from './useLibraryUpload';

/** Props for UploadBox. */
export interface UploadBoxProps {
  /** The button's words, for example "Upload a resume". */
  label: string;
  /** True to allow several files at once. */
  multiple: boolean;
  /** Takes the chosen or dropped files. */
  onFiles: (files: File[]) => void;
  /** How many files are still being read. */
  reading: number;
  /** Files that could not be added. */
  problems: readonly UploadProblem[];
  /** Hides one problem. */
  onDismiss: (key: string) => void;
}

/**
 * The upload area.
 *
 * @param props See UploadBoxProps.
 * @returns The drop zone, status and problems.
 * Rendered by: LibraryPage.tsx, LibraryPicker.tsx
 */
export function UploadBox({
  label,
  multiple,
  onFiles,
  reading,
  problems,
  onDismiss,
}: UploadBoxProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /**
   * Takes files dropped on the zone.
   *
   * @param event The drop event.
   */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Without preventDefault the browser would open the dropped file instead.
    event.preventDefault();
    setDragging(false);
    onFiles([...event.dataTransfer.files]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          'flex flex-col items-center gap-2 border border-dashed px-4 py-5 text-center',
          dragging ? 'border-ui-accent bg-ui-pale' : 'border-ui-border bg-ui-surface',
        ].join(' ')}
      >
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
          {label}
        </Button>
        <p className="text-[13px] text-ui-muted">
          Or drop a PDF, Word (.docx) or text file here. Read on this computer; only the text is
          kept. Up to 20 MB per file.
        </p>
        <input
          ref={input}
          type="file"
          multiple={multiple}
          accept={UPLOAD_ACCEPT}
          aria-label={label}
          className="hidden"
          onChange={(event) => {
            onFiles([...(event.target.files ?? [])]);
            // Clear it, so choosing the same file again still fires onChange.
            event.target.value = '';
          }}
        />
      </div>
      {reading > 0 && (
        <p role="status" className="text-sm text-ui-muted">
          Reading {reading} file{reading === 1 ? '' : 's'}…
        </p>
      )}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {problems.map((problem) => (
            <li
              key={problem.key}
              role="alert"
              className="flex items-start justify-between gap-4 border-l-[3px] border-ui-danger bg-ui-danger-bg px-4 py-2 text-[15px] text-ui-danger"
            >
              <span>{problem.message}</span>
              <button
                type="button"
                onClick={() => onDismiss(problem.key)}
                aria-label="Dismiss"
                className="px-2 text-ui-danger focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
