/**
 * File: apps/web/src/features/library/useLibraryUpload.ts
 * Purpose: Reads uploaded files into a library (one at a time, on this computer), and keeps the
 *          problems to show for those that could not be read. Shared by the library pages and the
 *          wizard's pickers, so an upload behaves the same in both.
 * Used by: src/features/library/LibraryPage.tsx, src/features/session-setup/ContextFields.tsx
 * Depends on: src/core/documents/extract.ts, src/core/storage/library.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 *
 * File text is the user's content and is never logged. Problem messages name the file only.
 */
'use client';

import { useState } from 'react';
import { extractText } from '@/core/documents/extract';
import { addLibraryItem } from '@/core/storage/library';
import type { LibraryItem, LibraryKind } from '@/core/storage/types';

/** A file that could not be added, shown under the list. */
export interface UploadProblem {
  /** Key for React lists. */
  key: string;
  /** The message for the user (names the file; never contains its text). */
  message: string;
}

/** File types the pickers offer (extensions and MIME types; extract.ts checks again). */
export const UPLOAD_ACCEPT =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

/**
 * Uploads to one library.
 *
 * @param kind Which library.
 * @returns upload(), how many files are still being read, the problems, and addProblem/dismiss.
 * Called from: LibraryPage.tsx, ContextFields.tsx
 */
export function useLibraryUpload(kind: LibraryKind) {
  const [reading, setReading] = useState(0);
  const [problems, setProblems] = useState<UploadProblem[]>([]);

  /**
   * Shows a problem.
   *
   * @param message The message.
   */
  function addProblem(message: string) {
    setProblems((current) => [...current, { key: crypto.randomUUID(), message }]);
  }

  /**
   * Reads files and stores the ones that work.
   *
   * @param files The chosen or dropped files.
   * @returns The stored items, in order.
   */
  async function upload(files: readonly File[]): Promise<LibraryItem[]> {
    setReading((n) => n + files.length);
    const added: LibraryItem[] = [];
    for (const file of files) {
      const result = await extractText(file);
      setReading((n) => n - 1);
      if (!result.ok) {
        addProblem(result.error.message);
        continue;
      }
      try {
        added.push(await addLibraryItem(kind, result.document.name, result.document.text));
      } catch {
        addProblem(`${file.name}: could not be saved on this computer. Is the disk full?`);
      }
    }
    return added;
  }

  return {
    upload,
    reading,
    problems,
    addProblem,
    /**
     * Hides one problem.
     *
     * @param key The problem's key.
     * @returns Nothing.
     */
    dismiss: (key: string) =>
      setProblems((current) => current.filter((problem) => problem.key !== key)),
  };
}
