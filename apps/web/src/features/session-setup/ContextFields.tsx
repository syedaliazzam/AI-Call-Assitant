/**
 * File: apps/web/src/features/session-setup/ContextFields.tsx
 * Purpose: The wizard's "Context" pickers (spec S4). CV / Resume is a select: None, the library's
 *          resumes with a tick on the chosen one, and "+ Upload a resume". Documents is a multi-select:
 *          the library's documents with check boxes, "+ Add a document", Select all and Clear. An upload
 *          joins the library and is chosen straight away. What a session holds that is no longer in the
 *          library stays listed: its copy stays until it is taken away here.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: lucide-react, src/core/storage/library.ts, src/features/library/useLibraryUpload.ts,
 *             ./draft.ts, src/ui (MultiSelect, Select)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4); ADR-0029
 *
 * Document text is the user's content and is never logged.
 */
'use client';

import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { listLibrary } from '@/core/storage/library';
import type { LibraryItem, LibraryKind } from '@/core/storage/types';
import { UPLOAD_ACCEPT, useLibraryUpload } from '@/features/library/useLibraryUpload';
import { MultiSelect } from '@/ui/MultiSelect';
import { Select } from '@/ui/Select';
import { documentKind, type DraftDocument } from './draft';

/** The select's value for "no resume". */
const NONE = 'none';

/** Marks a choice that is the session's own copy, not a library item. */
const COPY_PREFIX = 'copy:';

/** Props for LibraryField. */
export interface LibraryFieldProps {
  /** Which library: a resume is one choice, documents are several. */
  kind: LibraryKind;
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
 * One picker, with its hidden file input, what is being read, and files that could not be added.
 *
 * @param props See LibraryFieldProps.
 * @returns The field.
 * Rendered by: DetailsStep.tsx
 */
export function LibraryField({ kind, documents, onPick, onRemove, onBusy }: LibraryFieldProps) {
  const { upload, reading, problems, addProblem, dismiss } = useLibraryUpload(kind);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [version, setVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const single = kind === 'resume';
  const mine = documents.filter((document) => documentKind(document) === kind);
  const known = new Set(items.map((item) => item.id));
  // Held by the session but not in the library: uploaded before libraries, or since deleted there.
  const onlyHere = mine.filter((document) => !document.sourceId || !known.has(document.sourceId));
  const uploadLabel = single ? 'Upload a resume' : 'Add a document';

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
   * @param files The chosen files.
   */
  async function take(files: File[]) {
    onBusy(files.length);
    const added = await upload(files);
    onBusy(-files.length);
    setVersion((n) => n + 1);
    // One resume: the last one uploaded. Documents: all of them.
    for (const item of single ? added.slice(-1) : added) pick(item);
  }

  /**
   * The picker's value for a document the session holds.
   *
   * @param document The document.
   * @returns Its library item's id, or a value marking the session's own copy.
   */
  const valueOf = (document: DraftDocument) =>
    document.sourceId && known.has(document.sourceId)
      ? document.sourceId
      : `${COPY_PREFIX}${document.key}`;

  const options = [
    ...items.map((item) => ({ value: item.id, label: item.name })),
    ...onlyHere.map((document) => ({
      value: `${COPY_PREFIX}${document.key}`,
      label: document.name,
    })),
  ];
  const addAction = {
    label: uploadLabel,
    icon: <Plus aria-hidden="true" size={18} className="text-ui-muted" />,
    onSelect: () => input.current?.click(),
  };

  /**
   * Applies a resume choice.
   *
   * @param value The chosen value.
   */
  function chooseResume(value: string) {
    if (value === NONE) {
      for (const document of mine) onRemove(document.key);
      return;
    }
    const item = items.find((candidate) => candidate.id === value);
    if (item) pick(item);
  }

  /**
   * Applies a change of ticks: what was added is chosen, and what was removed is taken away.
   *
   * @param values The ticked values.
   */
  function chooseDocuments(values: string[]) {
    const current = mine.map(valueOf);
    for (const item of items) {
      if (values.includes(item.id) && !current.includes(item.id)) pick(item);
    }
    for (const document of mine) {
      if (!values.includes(valueOf(document))) onRemove(document.key);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {single ? (
        <Select
          label="CV / Resume"
          options={[{ value: NONE, label: 'None' }, ...options]}
          value={mine[0] ? valueOf(mine[0]) : NONE}
          onChange={chooseResume}
          actions={[addAction]}
        />
      ) : (
        <MultiSelect
          label="Documents"
          options={options}
          values={mine.map(valueOf)}
          onChange={chooseDocuments}
          emptyLabel="No documents yet"
          actions={[addAction]}
        />
      )}
      {/* Found by its label in tests; the visible way in is the list's action. */}
      <input
        ref={input}
        type="file"
        multiple={!single}
        accept={UPLOAD_ACCEPT}
        aria-label={uploadLabel}
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Clear it, so choosing the same file again still fires onChange.
          event.target.value = '';
          if (files.length > 0) void take(files);
        }}
      />
      {reading > 0 && (
        <p role="status" className="text-helper text-ui-muted">
          Reading {reading} file{reading === 1 ? '' : 's'}…
        </p>
      )}
      {problems.map((problem) => (
        <p
          key={problem.key}
          role="alert"
          className="flex items-start justify-between gap-2 rounded-control border border-ui-danger bg-ui-danger-bg px-3 py-2 text-helper text-ui-danger"
        >
          <span className="min-w-0 break-words">{problem.message}</span>
          <button
            type="button"
            onClick={() => dismiss(problem.key)}
            aria-label="Dismiss"
            className="shrink-0 rounded-[4px] focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </p>
      ))}
    </div>
  );
}
