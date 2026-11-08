/**
 * File: apps/web/src/features/sync/SyncScope.tsx
 * Purpose: Chooses where a page's call data lives and runs account sync (ADR-0049). For an account
 *          with the accountSync switch, the storage modules use the account's cache and sync runs;
 *          for everyone else nothing changes ('kite', this device's own data). The choice is made
 *          while rendering, before any child loads data.
 * Used by: app/(app)/layout.tsx, app/home/page.tsx, app/compact/[id]/page.tsx
 * Depends on: src/core/storage/db.ts (selectAccountDatabase), src/core/sync/client.ts
 * Architecture: ADR-0049 (rollout: KITE_SYNC_USERS)
 */
'use client';

import { useEffect, type ReactNode } from 'react';
import { selectAccountDatabase } from '@/core/storage/db';
import { startAccountSync } from '@/core/sync/client';

/** Props for SyncScope. */
export interface SyncScopeProps {
  /** The signed-in account's id when it has account sync, else null (decided on the server). */
  syncUserId: string | null;
  /**
   * Whether this page runs sync itself. False for the overlay window: its changes go into the
   * shared outbox and the main window pushes them (no extra pulls from a small window).
   */
  runEngine?: boolean;
  /** The page. */
  children: ReactNode;
}

/**
 * Selects the account's cache (or this device's own data) and runs account sync.
 *
 * @param props See SyncScopeProps.
 * @returns The children.
 * Rendered by: the layouts and pages listed above, around everything that reads call data
 */
export function SyncScope({ syncUserId, runEngine = true, children }: SyncScopeProps) {
  // Before any child renders or loads: every storage call on this page then uses the right database.
  // Idempotent, so React rendering this more than once is harmless.
  selectAccountDatabase(syncUserId);
  useEffect(() => {
    if (!syncUserId || !runEngine) return;
    return startAccountSync();
  }, [syncUserId, runEngine]);
  return <>{children}</>;
}
