/**
 * File: apps/web/src/features/shell/AppShell.tsx
 * Purpose: The frame of every signed-in page: the header across the top, the sidebar and the page below
 *          (spec S1, S2). It holds the sidebar's state: collapsed to icons (remembered) from 768 px, a
 *          slide-over drawer below that. The page scrolls by itself, so the header and sidebar stay in
 *          view. The live screen fills the window, so it has no header.
 * Used by: app/(app)/layout.tsx
 * Depends on: next/navigation, src/core/storage/sidebarPrefs.ts, src/platform, src/ui/Sidebar.tsx,
 *             ./AppHeader.tsx, ./DesktopAppCard.tsx, ./pageTitles.ts, ./UserMenu.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1, S2)
 */
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSidebarCollapsed, setSidebarCollapsedPref } from '@/core/storage/sidebarPrefs';
import { getPlatform } from '@/platform';
import { Sidebar } from '@/ui/Sidebar';
import { AppHeader } from './AppHeader';
import { DesktopAppCard } from './DesktopAppCard';
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
