/**
 * File: apps/web/src/features/library/UploadBox.tsx
 * Purpose: The upload control shared by the library pages and the wizard's pickers: a button that
 *          opens a drag-and-drop window (drop files or browse), then what is being read and any
 *          file that could not be read, on the page behind it. Files can also be dropped straight
 *          on the row, without opening the window.
 * Used by: src/features/library/LibraryPage.tsx, src/features/session-setup/LibraryPicker.tsx
 * Depends on: src/ui (Button, Dialog, icons), ./useLibraryUpload.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029;
 *               docs/design/kite-ui-theme.md §6
 */
'use client';

import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { UploadIcon } from '@/ui/icons';
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
 * The upload control.
 *
 * @param props See UploadBoxProps.
 * @returns The row with its button, the upload window, status and problems.
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
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  /**
   * Passes on the files and closes the window; progress and problems show on the page behind it.
   *
   * @param files The chosen or dropped files.
   */
  function take(files: File[]) {
    setOpen(false);
    if (files.length > 0) onFiles(files);
  }

  /**
   * Takes files dropped on the row or in the window.
   *
   * @param event The drop event.
   */
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    // Without preventDefault the browser would open the dropped file instead.
    event.preventDefault();
    setDragging(false);
    take([...event.dataTransfer.files]);
  }

  /** The handlers that make an element a drop target. */
  const dropTarget = {
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: handleDrop,
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        {...dropTarget}
        className={[
          'flex flex-wrap items-center gap-3 rounded-control border border-dashed px-4 py-3',
          dragging && !open ? 'border-ui-accent bg-ui-subtle' : 'border-ui-border bg-ui-surface',
        ].join(' ')}
      >
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <UploadIcon />
          {label}
        </Button>
        <p className="min-w-0 flex-1 basis-48 text-[13px] text-ui-muted">
          PDF, Word (.docx) or text, up to 20 MB each. Or drop files here.
        </p>
      </div>

      {/* Not the same words as `label`: the file input below is found by that label. */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={multiple ? 'Choose files' : 'Choose a file'}
      >
        <div
          {...dropTarget}
          className={[
            'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center',
            dragging ? 'border-ui-accent bg-ui-subtle' : 'border-ui-border',
          ].join(' ')}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-ui-subtle text-ui-heading">
            <UploadIcon size={20} />
          </span>
          <p className="font-medium text-ui-heading">
            Drag and drop {multiple ? 'files' : 'a file'} here
          </p>
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
            Browse files
          </Button>
          <p className="text-[13px] text-ui-muted">
            PDF, Word (.docx) or text, up to 20 MB each. Read on this computer; only the text is
            kept.
          </p>
          <input
            ref={input}
            type="file"
            multiple={multiple}
            accept={UPLOAD_ACCEPT}
            aria-label={label}
            className="hidden"
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Clear it, so choosing the same file again still fires onChange.
              event.target.value = '';
              take(files);
            }}
          />
        </div>
      </Dialog>

      {reading > 0 && (
        <p role="status" className="text-[13px] text-ui-muted">
          Reading {reading} file{reading === 1 ? '' : 's'}…
        </p>
      )}
      {problems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {problems.map((problem) => (
            <li
              key={problem.key}
              role="alert"
              className="flex items-start justify-between gap-4 rounded-control border border-ui-danger bg-ui-danger-bg px-4 py-2 text-[15px] text-ui-danger"
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
