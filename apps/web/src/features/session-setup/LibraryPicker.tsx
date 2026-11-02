/**
 * File: apps/web/src/features/session-setup/LibraryPicker.tsx
 * Purpose: The wizard's Resume picker (one) and Documents picker (several): choose from the library
 *          or upload a new file, which joins the library and is chosen straight away. Also shows
 *          what a session already holds that is no longer in the library: its copy stays until it
 *          is removed here.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: src/core/storage/library.ts, src/features/library (upload), ./draft.ts, src/ui/Button
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F2), §5, §7.4; ADR-0029
 */
'use client';

import { useEffect, useId, useState } from 'react';
import { listLibrary } from '@/core/storage/library';
import type { LibraryItem, LibraryKind } from '@/core/storage/types';
import { UploadBox } from '@/features/library/UploadBox';
import { useLibraryUpload } from '@/features/library/useLibraryUpload';
import { Button } from '@/ui/Button';
import type { DraftDocument } from './draft';
import { documentKind } from './draft';

/** Props for LibraryPicker. */
export interface LibraryPickerProps {
  /** Which library. */
  kind: LibraryKind;
  /** The heading, for example "Resume (optional)". */
  title: string;
  /** The session's documents. */
  documents: readonly DraftDocument[];
  /**
   * Chooses a library item for the session.
   *
   * @returns A message when it does not fit in the session, otherwise null.
   */
  onPick: (item: LibraryItem) => string | null;
  /** Removes a document from the session, by its list key. */
  onRemove: (key: string) => void;
  /** Called with +n or -n as files start and finish being read (Next waits for them). */
  onBusy: (delta: number) => void;
}

/**
 * One pickable row: a button that says whether it is chosen, so it is keyboard-reachable and tall
 * enough to tap.
 *
 * @param props.role     'radio' for one choice, 'checkbox' for several.
 * @param props.checked  Whether it is chosen.
 * @param props.name     What it is called.
 * @param props.detail   Its size.
 * @param props.onToggle Chooses it or takes it away.
 * @returns The row.
 * Rendered by: LibraryPicker
 */
function PickRow({
  role,
  checked,
  name,
  detail,
  onToggle,
}: {
  /** 'radio' for one choice, 'checkbox' for several. */
  role: 'radio' | 'checkbox';
  /** Whether it is chosen. */
  checked: boolean;
  /** What it is called. */
  name: string;
  /** Its size, or null. */
  detail: string | null;
  /** Chooses it or takes it away. */
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={checked}
      aria-label={name}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ui-band focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${role === 'radio' ? 'rounded-full' : ''} ${checked ? 'border-ui-primary bg-ui-primary' : 'border-ui-border'}`}
      >
        {checked && <span className="h-1.5 w-1.5 bg-ui-surface" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] text-ui-text">{name}</span>
      {detail && <span className="shrink-0 text-[13px] text-ui-muted">{detail}</span>}
    </button>
  );
}

/**
 * A character count for a row.
 *
 * @param chars The count.
 * @returns For example "12,345 characters".
 */
function size(chars: number): string {
  return `${chars.toLocaleString('en-US')} characters`;
}

/**
 * The picker.
 *
 * @param props See LibraryPickerProps.
 * @returns The section.
 * Rendered by: DetailsStep.tsx
 */
export function LibraryPicker({
  kind,
  title,
  documents,
  onPick,
  onRemove,
  onBusy,
}: LibraryPickerProps) {
  const headingId = useId();
  const { upload, reading, problems, addProblem, dismiss } = useLibraryUpload(kind);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [version, setVersion] = useState(0);
  const mine = documents.filter((document) => documentKind(document) === kind);
  const known = new Set(items.map((item) => item.id));
  // Held by the session but not in the library: uploaded before libraries, or since deleted there.
  const onlyHere = mine.filter((document) => !document.sourceId || !known.has(document.sourceId));
  const single = kind === 'resume';

  useEffect(() => {
    let cancelled = false;
    listLibrary(kind)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, version]);

  /**
   * Chooses an item, showing why when it does not fit.
   *
   * @param item The library item.
   */
  function pick(item: LibraryItem) {
    const problem = onPick(item);
    if (problem) addProblem(`${item.name}: ${problem}`);
  }

  /**
   * Uploads files, then chooses them.
   *
   * @param files The chosen or dropped files.
   */
  async function take(files: File[]) {
    onBusy(files.length);
    const added = await upload(files);
    onBusy(-files.length);
    setVersion((n) => n + 1);
    // One resume: the last one uploaded. Documents: all of them.
    for (const item of single ? added.slice(-1) : added) pick(item);
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-[13px] font-medium text-ui-muted">
        {title}
      </h3>
      {(items.length > 0 || onlyHere.length > 0) && (
        <div
          role={single ? 'radiogroup' : 'group'}
          aria-labelledby={headingId}
          className="flex flex-col divide-y divide-ui-border overflow-hidden rounded-card border border-ui-border bg-ui-surface"
        >
          {items.map((item) => {
            const chosen = mine.find((document) => document.sourceId === item.id);
            return (
              <PickRow
                key={item.id}
                role={single ? 'radio' : 'checkbox'}
                checked={chosen !== undefined}
                name={item.name}
                detail={size(item.chars)}
                onToggle={() => (chosen ? onRemove(chosen.key) : pick(item))}
              />
            );
          })}
          {onlyHere.map((document) => (
            <div
              key={document.key}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2"
            >
              <span className="min-w-0 flex-1 basis-40 truncate text-[15px] text-ui-text">
                {document.name}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-[13px] text-ui-muted">{size(document.chars)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(document.key)}
                  aria-label={`Remove ${document.name}`}
                >
                  Remove
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
      <UploadBox
        label={single ? 'Upload a resume' : 'Upload a document'}
        multiple={!single}
        onFiles={(files) => void take(files)}
        reading={reading}
        problems={problems}
        onDismiss={dismiss}
      />
    </section>
  );
}
