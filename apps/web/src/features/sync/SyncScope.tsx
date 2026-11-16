/**
 * File: apps/web/src/features/sync/SyncScope.tsx
 * Purpose: Selects the signed-in account's own database on this device and runs account sync
 *          (ADR-0049). Every account has account sync (ADR-0092 removed the accountSync switch), so the
 *          database is always the account's cache ('kite-u-<id>'). The old shared database 'kite' and an
 *          account's old local database ('kite-l-<id>') are never selected by a signed-in page. The
 *          choice is made while rendering, before any child loads data. It also records the page's
 *          account for the account-tied stored values (core/storage/accountScope.ts) and reloads the
 *          page when another account signed in since it opened, so nothing of the previous account
 *          stays on screen or in memory. In the desktop app it keeps every page's popups inside its
 *          window (ADR-0085).
 * Used by: app/(app)/layout.tsx, app/home/page.tsx, app/compact/[id]/page.tsx, app/player/[id]/page.tsx
 * Depends on: src/core/storage/db.ts (selectAccountDatabase), src/core/storage/accountScope.ts,
 *             src/core/sync/client.ts, src/platform (keepPopupsInWindow, ADR-0055)
 * Architecture: ADR-0049, ADR-0092
 */
'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  enterAccount,
  reloadForAccountSwitch,
  watchOtherAccountSignIn,
} from '@/core/storage/accountScope';
import { selectAccountDatabase } from '@/core/storage/db';
import { startAccountSync } from '@/core/sync/client';
import { getPlatform } from '@/platform';

/** Props for SyncScope. */
export interface SyncScopeProps {
  /** The signed-in account's id (decided on the server). It chooses the account's database. */
  accountId: string;
  /**
   * Whether this page runs sync itself. False for the overlay window: its changes go into the
   * shared outbox and the main window pushes them (no extra pulls from a small window).
   */
  runEngine?: boolean;
  /** The signed-in account's email, shown where the app names the account (the one-time upload). */
  email?: string;
  /** The page. */
  children: ReactNode;
}

/** The signed-in account, for the components inside a SyncScope. */
export interface SyncAccount {
  /** The account's id. */
  userId: string;
  /** Its email ('' when the page did not pass it). */
  email: string;
}

/** The account of this page; null only outside a SyncScope (tests and harnesses). */
const SyncAccountContext = createContext<SyncAccount | null>(null);

/**
 * The signed-in account of this page.
 *
 * @returns The account, or null outside a SyncScope (tests and harnesses).
 * Called from: LegacyUploadCard.tsx
 */
export function useSyncAccount(): SyncAccount | null {
  return useContext(SyncAccountContext);
}

/**
 * Selects the signed-in account's database and runs account sync.
 *
 * @param props See SyncScopeProps.
 * @returns The children; nothing while the page reloads after an account switch.
 * Rendered by: the layouts and pages listed above, around everything that reads call data
 */
export function SyncScope({ accountId, runEngine = true, email = '', children }: SyncScopeProps) {
  // Before any child renders or loads: the page's account (the previous account's stored values are
  // removed when a different account signs in), then the account's own database. Both are idempotent,
  // so React rendering this more than once is harmless.
  const entry = enterAccount(accountId);
  const switched = entry === 'switched';
  // After a sign-out and a sign-in as someone else without a reload, this page's memory (and any work
  // still running) belongs to the previous account: keep its database selected, show nothing and
  // reload, so no new screen ever mixes the two accounts.
  if (!switched) selectAccountDatabase(accountId);

  useEffect(() => {
    if (switched) reloadForAccountSwitch();
  }, [switched]);
  // Another window of this browser profile signed in as a different account: this one reloads too.
  useEffect(() => watchOtherAccountSignIn(reloadForAccountSwitch), []);
  useEffect(() => {
    if (switched || !runEngine) return;
    return startAccountSync();
  }, [switched, runEngine]);
  // ADR-0055, ADR-0085: in the desktop app every popup (a <select>'s list, a title tooltip) stays
  // inside its window, where screen-share protection reaches. Nothing changes in a browser.
  useEffect(() => {
    getPlatform().keepPopupsInWindow();
  }, []);
  const account = useMemo(() => ({ userId: accountId, email }), [accountId, email]);
  if (switched) return null;
  return <SyncAccountContext.Provider value={account}>{children}</SyncAccountContext.Provider>;
}
