/**
 * File: apps/web/src/ui/Sidebar.tsx
 * Purpose: The left navigation shown on every signed-in page: Kite name, page links, the
 *          signed-in user box, and a footer saying whether this is the desktop app or a browser.
 * Used by: app/(app)/layout.tsx
 * Depends on: next/link, next/navigation (to highlight the current page),
 *             src/platform (getDesktopInfo, for the footer label only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser), §5
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore, type ReactNode } from 'react';
import { getDesktopInfo } from '@/platform';

/** The signed-in user, as far as the sidebar needs to know. */
export interface SidebarUser {
  /** Display name shown in the user box. */
  name: string;
  /** Email shown under the name. */
  email: string;
  /** 'admin' users also see the Admin and Dev tools links. */
  role: 'admin' | 'user';
}

/** Props for Sidebar. */
export interface SidebarProps {
  /** The signed-in user; undefined shows "Not signed in". */
  user?: SidebarUser;
  /**
   * Buttons under the user's name, for example the sign-out button. Passed in by the layout
   * so this shared UI piece contains no sign-in logic itself.
   */
  userActions?: ReactNode;
}

/** One entry in the navigation list. */
interface NavItem {
  /** Text shown in the sidebar. */
  label: string;
  /** Route the link opens. */
  href: string;
  /** When set, the link is shown greyed out with this note instead of being clickable. */
  disabledNote?: string;
  /** True if only admins should see the link. */
  adminOnly?: boolean;
}

/** All navigation links, in display order. */
const NAV_ITEMS: NavItem[] = [
  { label: 'Call Sessions', href: '/' },
  { label: 'Settings', href: '/settings', disabledNote: 'Day 3' },
  { label: 'Admin', href: '/admin/users', adminOnly: true },
  { label: 'Dev tools', href: '/dev', adminOnly: true },
];

/**
 * Builds the footer label: "Desktop app v0.1" (major.minor of the shell version) inside the
 * desktop app, otherwise "Browser". Display only; behaviour differences live in src/platform.
 *
 * @returns The label text.
 * Called from: Sidebar (as the useSyncExternalStore snapshot)
 */
export function runtimeLabel(): string {
  const desktop = getDesktopInfo();
  if (!desktop) return 'Browser';
  const [major = '0', minor = '0'] = desktop.version.split('.');
  return `Desktop app v${major}.${minor}`;
}

/**
 * No-op subscription for useSyncExternalStore: the label never changes while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * The signed-in app's left sidebar.
 * Admin-only links are hidden unless `user.role` is 'admin'. This only tidies the menu;
 * the real access check happens on the server (requireAdmin() in src/server/guard.ts).
 *
 * @param props.user        The signed-in user, or undefined when nobody is signed in.
 * @param props.userActions Buttons shown under the user's name (sign out).
 * @returns The <aside> navigation element.
 * Rendered by: app/(app)/layout.tsx
 */
export function Sidebar({ user, userActions }: SidebarProps) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin');
  // The server cannot know whether the page will run in the desktop app, so it renders no
  // label (null); the browser fills it in after hydration. This avoids a hydration mismatch.
  const runtime = useSyncExternalStore(subscribeNever, runtimeLabel, () => null);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex h-16 items-center gap-2 px-5">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white"
        >
          K
        </span>
        <span className="text-lg font-semibold text-slate-900">Kite</span>
      </div>

      <nav aria-label="Main" className="flex-1 px-3 py-2">
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.href}>
              {item.disabledNote ? (
                <span
                  aria-disabled="true"
                  className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-slate-400"
                >
                  {item.label}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                    {item.disabledNote}
                  </span>
                </span>
              ) : (
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? 'page' : undefined}
                  className={[
                    'block rounded-md px-3 py-2 text-sm font-medium',
                    pathname === item.href
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* User box: who is signed in, plus the sign-out button. */}
      <div className="border-t border-slate-200 px-5 py-4 text-sm">
        {user ? (
          <>
            <p className="font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-slate-500">{user.email}</p>
            {userActions && <div className="mt-2 -ml-3">{userActions}</div>}
          </>
        ) : (
          <p className="text-slate-400">Not signed in</p>
        )}
        {runtime && <p className="mt-3 text-xs text-slate-400">{runtime}</p>}
      </div>
    </aside>
  );
}
