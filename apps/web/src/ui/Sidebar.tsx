/**
 * File: apps/web/src/ui/Sidebar.tsx
 * Purpose: The left navigation shown on every signed-in page: Kite name, page links, the
 *          signed-in user box, and a footer saying whether this is the desktop app or a browser.
 * Used by: app/(app)/layout.tsx
 * Depends on: next/link, next/navigation (to highlight the current page),
 *             src/platform (getDesktopInfo, for the footer label only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser), §5
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getDesktopInfo } from '@/platform';
import { BrandLockup } from './BrandLockup';

/** The signed-in user, as far as the sidebar needs to know. */
export interface SidebarUser {
  /** Display name shown in the user box. */
  name: string;
  /** Email shown under the name. */
  email: string;
  /** 'admin' users also see the Admin and Dev Tools links. */
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
  { label: 'Resumes', href: '/resumes' },
  { label: 'Documents', href: '/documents' },
  { label: 'Settings', href: '/settings' },
  { label: 'Admin', href: '/admin/users', adminOnly: true },
  { label: 'Dev Tools', href: '/dev', adminOnly: true },
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
  // Narrow screens (below 768 px): a top bar with a Menu button that shows the navigation.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();

  return (
    <aside className="k-dark flex w-full shrink-0 flex-col bg-ui-nav text-ui-text md:w-60">
      {/* px-4 and the small lockup: the full byline fits the 240 px column. */}
      <div className="flex h-16 items-center gap-2 px-4">
        <BrandLockup tone="dark" size="sm" />
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
          className="ml-auto border border-ui-secondary-border px-3 py-1.5 pointer-coarse:min-h-11 font-mono text-[11px] uppercase tracking-[0.08em] text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] md:hidden"
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {/* Always shown from 768 px; below that only while the menu is open. */}
      <div id={menuId} className={`${menuOpen ? 'flex' : 'hidden'} flex-1 flex-col md:flex`}>
        <nav aria-label="Main" className="flex-1 py-2">
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.href}>
                {item.disabledNote ? (
                  <span
                    aria-disabled="true"
                    className="flex cursor-not-allowed items-center justify-between border-l-[3px] border-transparent px-5 py-2.5 text-sm text-ui-muted"
                  >
                    {item.label}
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em]">
                      {item.disabledNote}
                    </span>
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={pathname === item.href ? 'page' : undefined}
                    className={[
                      'flex items-center border-l-[3px] px-5 py-2.5 pointer-coarse:min-h-11 text-sm font-semibold transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
                      pathname === item.href
                        ? 'border-ui-accent text-ui-heading'
                        : 'border-transparent text-ui-text hover:bg-ui-hover hover:text-ui-heading',
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
        <div className="border-t border-ui-border px-5 py-4 text-sm">
          {user ? (
            <>
              <p className="font-semibold text-ui-heading">{user.name}</p>
              <p className="truncate text-ui-muted">{user.email}</p>
              {userActions && <div className="mt-2 -ml-3">{userActions}</div>}
            </>
          ) : (
            <p className="text-ui-muted">Not signed in</p>
          )}
          {runtime && (
            <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-ui-muted">
              {runtime}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
