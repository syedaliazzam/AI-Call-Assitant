/**
 * File: apps/web/src/features/shell/AccountName.tsx
 * Purpose: The signed-in account's display name for the components inside a page (v1.3.2): the user's
 *          own transcript turns show it instead of "You" (Review, the downloads, the live panels). The
 *          server page passes the name it already has; nothing is fetched.
 * Used by: app/(app)/layout.tsx, app/home/page.tsx, app/compact/[id]/page.tsx (provider);
 *          src/features/review/ConversationSection.tsx, src/features/dashboard/SessionMenu.tsx,
 *          src/features/live/LiveAnswers.tsx, src/features/live/LivePage.tsx (useAccountName)
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S17 Review); v1.3.2
 */
'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** The account's display name, or null outside a provider (tests, rigs): turns then say "You". */
const AccountNameContext = createContext<string | null>(null);

/**
 * Gives the components inside it the account's display name.
 *
 * @param props.name     The display name (from the server's session).
 * @param props.children The page.
 * @returns The children, with the name available.
 * Rendered by: the layouts and pages listed in the file header
 */
export function AccountNameProvider({
  name,
  children,
}: {
  /** The display name. */
  name: string | null | undefined;
  /** The page. */
  children: ReactNode;
}) {
  return (
    <AccountNameContext.Provider value={name?.trim() || null}>
      {children}
    </AccountNameContext.Provider>
  );
}

/**
 * The signed-in account's display name.
 *
 * @returns The name, or null when the page did not give one.
 * Called from: ConversationSection.tsx, SessionMenu.tsx, LiveAnswers.tsx, LivePage.tsx
 */
export function useAccountName(): string | null {
  return useContext(AccountNameContext);
}
