/**
 * File: apps/web/src/features/library/LibraryPage.tsx
 * Purpose: The Resumes and Documents pages: files uploaded once and reused in any session, with
 *          upload and delete. Deleting never changes a past session: each session keeps its own
 *          copy of what it used.
 * Used by: app/(app)/resumes/page.tsx, app/(app)/documents/page.tsx
 * Depends on: src/core/storage/library.ts, ./useLibraryUpload.ts, ./UploadBox.tsx, src/ui (Button,
 *             Dialog, PageShell)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.4; ADR-0029
 *
 * Library text is the user's content, stored on this device and never logged.
 */
'use client';

import { useEffect, useState } from 'react';
import { listLibrary, removeLibraryItem } from '@/core/storage/library';
import type { LibraryItem, LibraryKind } from '@/core/storage/types';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { PageShell } from '@/ui/PageShell';
import { UploadBox } from './UploadBox';
import { useLibraryUpload } from './useLibraryUpload';

/** The words that differ between the two pages. */
const WORDS: Record<LibraryKind, { title: string; upload: string; one: string; empty: string }> = {
  resume: {
    title: 'Resumes',
    upload: 'Upload a resume',
    one: 'resume',
    empty: 'Upload your resume once, then pick it for any session.',
  },
  document: {
    title: 'Documents',
    upload: 'Upload a document',
    one: 'document',
    empty: 'Upload price lists, notes or product sheets once, then pick them for any session.',
  },
};

/** Date format for the list (for example "28 Oct 2026"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * One library page.
 *
 * @param props.kind Which library.
 * @returns The page.
 * Rendered by: app/(app)/resumes/page.tsx, app/(app)/documents/page.tsx
 */
export function LibraryPage({
  kind,
}: {
  /** Which library. */
  kind: LibraryKind;
}) {
  const words = WORDS[kind];
  const { upload, reading, problems, dismiss } = useLibraryUpload(kind);
  // null while loading.
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);
  // Bumped to reload the list after an upload or delete.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listLibrary(kind)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, version]);

  /** Deletes the item being confirmed, then reloads the list. */
  async function confirmDelete() {
    if (deleting) await removeLibraryItem(deleting.id).catch(() => undefined);
    setDeleting(null);
    setVersion((n) => n + 1);
  }

  return (
    <PageShell
      title={words.title}
      description="Saved on this computer. A session keeps its own copy of what it uses, so deleting here never changes a past session."
    >
      <section aria-label={words.title}>
        <div className="flex flex-col gap-6">
          <UploadBox
            label={words.upload}
            multiple
            onFiles={(files) => {
              void upload(files).then(() => setVersion((n) => n + 1));
            }}
            reading={reading}
            problems={problems}
            onDismiss={dismiss}
          />
          {failed && (
            <p role="alert" className="text-[13px] text-ui-danger">
              Paramount AI could not open its local storage. Reload the page to try again.
            </p>
          )}
          {items && items.length === 0 && (
            <p className="border border-ui-border rounded-card bg-ui-surface shadow-card px-6 py-10 text-center text-[15px] text-ui-muted">
              {words.empty}
            </p>
          )}
          {items && items.length > 0 && (
            <ul className="flex flex-col divide-y divide-ui-border overflow-hidden rounded-card border border-ui-border bg-ui-surface">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
                >
                  <span className="min-w-0 flex-1 basis-40 truncate text-[15px] text-ui-text">
                    {item.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-[13px] text-ui-muted">
                      {item.chars.toLocaleString('en-US')} characters ·{' '}
                      {DATE_FORMAT.format(item.addedAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleting(item)}
                      aria-label={`Delete ${item.name}`}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete this ${words.one}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          “{deleting?.name}” leaves this library. Sessions that already use it keep their own copy.
        </p>
      </Dialog>
    </PageShell>
  );
}
