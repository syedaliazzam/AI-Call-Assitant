/**
 * File: apps/web/src/ui/Sidebar.tsx
 * Purpose: The left navigation shown on every signed-in page: the Kite logo, the "Call assistant"
 *          and "Prepare" groups, Settings and the admin links, a collapse toggle, and the profile
 *          block (initial, name, email, sign out, and whether this is the desktop app or a browser).
 * Used by: app/(app)/layout.tsx
 * Depends on: next/link, next/navigation (to highlight the current page), src/platform
 *             (getDesktopInfo, for the footer label only), src/core/storage/sidebarPrefs.ts,
 *             ./BrandLockup.tsx, ./icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser), §5
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css)
 */
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getSidebarCollapsed, setSidebarCollapsedPref } from '@/core/storage/sidebarPrefs';
import { getDesktopInfo } from '@/platform';
import { BrandLockup } from './BrandLockup';
import {
  BookIcon,
  ChatIcon,
  DocumentIcon,
  GearIcon,
  ListIcon,
  PanelIcon,
  PlusIcon,
  ResumeIcon,
  ShieldIcon,
  ToolIcon,
  WebcamIcon,
} from './icons';

/** The signed-in user, as far as the sidebar needs to know. */
export interface SidebarUser {
  /** Display name shown in the profile block. */
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
  /** Text shown in the sidebar (and the link's name when collapsed). */
  label: string;
  /** Route the link opens. */
  href: string;
  /** The icon beside the label. */
  icon: ReactNode;
  /** True if only admins should see the link. */
  adminOnly?: boolean;
}

/** A named group of links. */
interface NavGroup {
  /** The heading above the links; none for the last group. */
  title?: string;
  /** The links, in display order. */
  items: readonly NavItem[];
}

/** All navigation links, in display order. */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'Call assistant',
    items: [
      { label: 'Create session', href: '/sessions/new', icon: <PlusIcon /> },
      { label: 'Call sessions', href: '/', icon: <ListIcon /> },
      { label: 'Resumes', href: '/resumes', icon: <ResumeIcon /> },
      { label: 'Documents', href: '/documents', icon: <DocumentIcon /> },
      { label: 'Ask Kite', href: '/ask-kite', icon: <ChatIcon /> },
    ],
  },
  {
    title: 'Prepare',
    items: [
      { label: 'Question bank', href: '/question-bank', icon: <BookIcon /> },
      { label: 'Mock interview', href: '/mock', icon: <WebcamIcon /> },
    ],
  },
  {
    items: [
      { label: 'Settings', href: '/settings', icon: <GearIcon /> },
      { label: 'Admin', href: '/admin/users', icon: <ShieldIcon />, adminOnly: true },
      { label: 'Dev Tools', href: '/dev', icon: <ToolIcon />, adminOnly: true },
    ],
  },
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
 * No-op subscription for useSyncExternalStore: these values never change by themselves while a
 * page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * The first letter of a name, for the profile block's circle.
 *
 * @param name The display name.
 * @returns One capital letter, or "?" for an empty name.
 * Called from: Sidebar
 */
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

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
  // The server cannot know whether the page will run in the desktop app, so it renders no
  // label (null); the browser fills it in after hydration. This avoids a hydration mismatch.
  const runtime = useSyncExternalStore(subscribeNever, runtimeLabel, () => null);
  // Narrow screens (below 768 px): a top bar with a Menu button that shows the navigation.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  // From 768 px: the saved choice until the user presses the toggle on this page.
  const savedCollapsed = useSyncExternalStore(subscribeNever, getSidebarCollapsed, () => false);
  const [chosenCollapsed, setChosenCollapsed] = useState<boolean | null>(null);
  const collapsed = chosenCollapsed ?? savedCollapsed;
  // Collapsing applies only from 768 px: the narrow layout always shows the words.
  const hideWhenCollapsed = collapsed ? 'md:hidden' : '';

  return (
    <aside
      data-collapsed={collapsed}
      className={[
        // Stays in view while the page scrolls, so the profile block is always reachable.
        'flex w-full shrink-0 flex-col border-b border-ui-border bg-ui-surface text-ui-text md:sticky md:top-0 md:h-screen md:border-r md:border-b-0',
        collapsed ? 'md:w-16' : 'md:w-60',
      ].join(' ')}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-2 px-4 ${collapsed ? 'md:justify-center md:px-0' : ''}`}
      >
        <span className={hideWhenCollapsed}>
          <BrandLockup tone="light" size="sm" />
        </span>
        {collapsed && (
          <span className="hidden md:block">
            <BrandLockup tone="light" size="sm" byline={false} name="" />
          </span>
        )}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
          className="ml-auto border border-ui-secondary-border px-3 py-1.5 pointer-coarse:min-h-11 text-[13px] font-medium text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] md:hidden"
        >
          {menuOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {/* Always shown from 768 px; below that only while the menu is open. */}
      <div
        id={menuId}
        className={`${menuOpen ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col md:flex`}
      >
        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group, index) => {
            const items = group.items.filter((item) => !item.adminOnly || user?.role === 'admin');
            return (
              <div key={group.title ?? index} className="mb-4">
                {group.title && (
                  <p className={`px-3 pb-1 text-[13px] text-ui-muted ${hideWhenCollapsed}`}>
                    {group.title}
                  </p>
                )}
                <ul className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={pathname === item.href ? 'page' : undefined}
                        // Collapsed, the words are hidden: the name stays for screen readers
                        // (aria-label), and the title for the pointer.
                        {...(collapsed ? { 'aria-label': item.label, title: item.label } : {})}
                        className={[
                          'flex items-center gap-3 rounded-control px-3 py-2 pointer-coarse:min-h-11 text-[15px] transition-colors duration-150',
                          'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
                          collapsed ? 'md:justify-center md:px-0' : '',
                          pathname === item.href
                            ? 'bg-ui-subtle font-medium text-ui-heading'
                            : 'text-ui-text hover:bg-ui-hover',
                        ].join(' ')}
                      >
                        {item.icon}
                        <span className={hideWhenCollapsed}>{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="hidden px-3 pb-2 md:block">
          <button
            type="button"
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            onClick={() => {
              setChosenCollapsed(!collapsed);
              setSidebarCollapsedPref(!collapsed);
            }}
            className={`flex w-full items-center gap-3 px-3 py-2 text-[13px] text-ui-muted hover:bg-ui-hover hover:text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${collapsed ? 'justify-center px-0' : ''}`}
          >
            <PanelIcon />
            {!collapsed && 'Collapse'}
          </button>
        </div>

        {/* Profile block: who is signed in, plus the sign-out button. */}
        <div
          className={`border-t border-ui-border py-4 text-[13px] ${collapsed ? 'px-5 md:flex md:justify-center md:px-0' : 'px-5'}`}
        >
          {user ? (
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                title={collapsed ? user.name : undefined}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ui-subtle text-[13px] font-semibold text-ui-heading"
              >
                {initial(user.name)}
              </span>
              <div className={`min-w-0 flex-1 ${hideWhenCollapsed}`}>
                <p className="truncate font-medium text-ui-heading">{user.name}</p>
                <p className="truncate text-ui-muted">{user.email}</p>
                {userActions && <div className="mt-2 -ml-3">{userActions}</div>}
                {runtime && <p className="mt-2 text-ui-muted">{runtime}</p>}
              </div>
            </div>
          ) : (
            <p className="text-ui-muted">Not signed in</p>
          )}
        </div>
      </div>
    </aside>
  );
}
