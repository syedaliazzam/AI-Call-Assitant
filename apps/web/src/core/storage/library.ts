/**
 * File: apps/web/src/core/storage/library.ts
 * Purpose: The Resume library and Document library: files uploaded once (their extracted text)
 *          and reused in any session. A session gets its own copy when it is saved, so deleting
 *          a library item never changes a past session.
 * Used by: src/features/library/LibraryPage.tsx, src/features/session-setup/LibraryPicker.tsx,
 *          src/core/storage/exportData.ts
 * Depends on: src/core/storage/db.ts, src/core/storage/types.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0029
 *
 * Library text is the user's content and is never logged. The size limits are checked by
 * core/documents (the same ones a session's documents have) before an item is added.
 */
import { getDb } from './db';
import type { LibraryItem, LibraryKind } from './types';

/**
 * Stores a file's text in a library.
 *
 * @param kind Which library.
 * @param name Original file name.
 * @param text The extracted plain text.
 * @param now  Time added, in Unix ms (tests pass a fixed time).
 * @returns The stored item.
 * Called from: LibraryPage.tsx, LibraryPicker.tsx (uploads); tests
 */
export async function addLibraryItem(
  kind: LibraryKind,
  name: string,
  text: string,
  now = Date.now(),
): Promise<LibraryItem> {
  const item: LibraryItem = {
    id: crypto.randomUUID(),
    kind,
    name,
    text,
    chars: text.length,
    addedAt: now,
  };
  await getDb().library.add(item);
  return item;
}

/**
 * Lists one library, newest first.
 *
 * @param kind Which library.
 * @returns Its items ([] when empty).
 * Called from: LibraryPage.tsx, LibraryPicker.tsx; tests
 */
export async function listLibrary(kind: LibraryKind): Promise<LibraryItem[]> {
  const items = await getDb().library.where('kind').equals(kind).toArray();
  return items.sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Deletes one library item. Sessions that used it keep their own copy.
 *
 * @param id The item's id.
 * @returns Nothing.
 * Called from: LibraryPage.tsx; tests
 */
export async function removeLibraryItem(id: string): Promise<void> {
  await getDb().library.delete(id);
}
