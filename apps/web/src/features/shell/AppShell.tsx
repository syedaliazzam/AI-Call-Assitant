/**
 * File: apps/web/src/features/shell/AppShell.tsx
 * Purpose: The frame of every signed-in page: the header across the top, the sidebar and the page below
 *          (spec S1, S2). It holds the sidebar's state: collapsed to icons (remembered) from 768 px, a
 *          slide-over drawer below that. The page scrolls by itself, so the header and sidebar stay in
 *          view. The live screen fills the window, so it has no header.
 *          ADR-0055: a desktop app (with the home panel) and account sync has no dashboard. Its windows
 *          keep only the call page, with no header and no sidebar; any other page opens in the browser
 *          (DesktopAway.tsx). Before this, the Connect card and the desktop live view were drawn inside
 *          the full sidebar, which is how the old dashboard appeared in the desktop app.
 * Used by: app/(app)/layout.tsx
 * Depends on: next/navigation, src/core/storage/sidebarPrefs.ts, src/platform, src/ui/Sidebar.tsx,
 *             src/features/sync/SyncScope.tsx, ./AppHeader.tsx, ./DesktopAppCard.tsx, ./DesktopAway.tsx,
 *             ./desktopPages.ts, ./pageTitles.ts, ./UserMenu.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S2); ADR-0051, ADR-0055
 */
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSidebarCollapsed, setSidebarCollapsedPref } from '@/core/storage/sidebarPrefs';
import { getPlatform } from '@/platform';
import { useSyncAccount } from '@/features/sync/SyncScope';
import { Sidebar } from '@/ui/Sidebar';
import { AppHeader } from './AppHeader';
import { DesktopAppCard } from './DesktopAppCard';
import { DesktopAway } from './DesktopAway';
import { desktopKeepsPage } from './desktopPages';
import { isCallPage } from './pageTitles';
import { UserMenu, type ShellUser } from './UserMenu';

/** Props for AppShell. */
export interface AppShellProps {
  /** The signed-in user. */
  user: ShellUser;
  /** The page. */
  children: ReactNode;
}

/**
 * Nothing to subscribe to: these values change only through this component, which holds that in state.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this is a browser: the desktop app card is only for there.
 *
 * @returns True in a browser.
 * Called from: AppShell
 */
const inBrowser = () => getPlatform().offersPlatformChoice;

/**
 * Whether this is a desktop app with the home panel (1.1.0 and later): with account sync it has no
 * dashboard of its own (ADR-0055).
 *
 * @returns True in such a desktop app.
 * Called from: AppShell
 */
const inPanelApp = () => getPlatform().hasHomePanel();

/**
 * The frame.
 *
 * @param props See AppShellProps.
 * @returns The header, the sidebar and the page.
 * Rendered by: app/(app)/layout.tsx
 */
export function AppShell({ user, children }: AppShellProps) {
  const pathname = usePathname();
  const savedCollapsed = useSyncExternalStore(subscribeNever, getSidebarCollapsed, () => false);
  const [chosenCollapsed, setChosenCollapsed] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const browser = useSyncExternalStore(subscribeNever, inBrowser, () => false);
  const collapsed = chosenCollapsed ?? savedCollapsed;
  // ADR-0055: one dashboard, in the browser. Server render: not a desktop app.
  const panelApp = useSyncExternalStore(subscribeNever, inPanelApp, () => false);
  const synced = useSyncAccount() !== null;
  const desktopNoDashboard = panelApp && synced;

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    /**
     * Closes on Escape.
     *
     * @param event The key press.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  if (desktopNoDashboard) {
    // The call fills the window with no header and no sidebar; anything else goes to the browser.
    return desktopKeepsPage(pathname) ? (
      <main className="relative h-dvh min-w-0 overflow-y-auto bg-ui-bg">{children}</main>
    ) : (
      <DesktopAway pathname={pathname} />
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {!isCallPage(pathname) && (
        <AppHeader
          collapsed={collapsed}
          onToggleCollapsed={() => {
            setChosenCollapsed(!collapsed);
            setSidebarCollapsedPref(!collapsed);
          }}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close the menu"
            tabIndex={-1}
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-30 bg-ui-overlay md:hidden"
          />
        )}
        <Sidebar
          collapsed={collapsed}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          card={browser ? <DesktopAppCard /> : undefined}
          footer={<UserMenu user={user} collapsed={collapsed} />}
        />
        {/* relative: absolutely positioned content (for example screen-reader-only labels) stays
            inside main instead of widening the page. */}
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-ui-bg">{children}</main>
      </div>
    </div>
  );
}
