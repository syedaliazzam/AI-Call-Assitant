/**
 * File: apps/web/src/ui/Sidebar.tsx
 * Purpose: The left navigation on every signed-in page (spec S2): the main links, the "Prepare" group
 *          with its "Soon" items, a card slot, Help and a footer slot. From 768 px it sits beside the page,
 *          about 252 px wide or icons only; below that it is a slide-over drawer. Knows no sign-in or
 *          platform logic: the shell passes the card and the footer in.
 * Used by: src/features/shell/AppShell.tsx
 * Depends on: next/link, next/navigation (to highlight the current page), lucide-react, src/platform
 *             (getDesktopInfo, for runtimeLabel only), ./BrandLockup.tsx, ./Chip.tsx, ./Tooltip.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S2), §5
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import {
  AudioLines,
  BookOpen,
  Bot,
  FilePen,
  FileText,
  IdCard,
  ImageUp,
  LifeBuoy,
  MessageSquare,
  Plus,
  Video,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { getDesktopInfo } from '@/platform';
import { BrandLockup } from './BrandLockup';
import { SOON_TOOLTIP, SoonBadge } from './Chip';
import { Tooltip } from './Tooltip';

/** Every sidebar icon's size and stroke (spec §1: 20 px). */
const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** One entry in the navigation. */
interface NavItem {
  /** The words. */
  label: string;
  /** The route it opens; none for a "Soon" item. */
  href?: string;
  /** The icon beside the words. */
  icon: ReactNode;
}

/** The main links, in display order. */
const MAIN_ITEMS: readonly NavItem[] = [
  { label: 'Call Sessions', href: '/', icon: <AudioLines {...ICON} /> },
  // Desktop 1.5.0 (ADR-0068): the recorded meetings (the recordings stay on the computer that made them).
  { label: 'Meetings', href: '/meetings', icon: <Video {...ICON} /> },
  { label: 'Resumes', href: '/resumes', icon: <IdCard {...ICON} /> },
  { label: 'Documents', href: '/documents', icon: <FileText {...ICON} /> },
  { label: 'Ask AI', href: '/ask-kite', icon: <MessageSquare {...ICON} /> },
];

/** The "Prepare" group, in display order. */
const PREPARE_ITEMS: readonly NavItem[] = [
  { label: 'Mock Interview', href: '/mock', icon: <Bot {...ICON} /> },
  { label: 'Question bank', href: '/question-bank', icon: <BookOpen {...ICON} /> },
  { label: 'Resume Maker', icon: <FilePen {...ICON} /> },
  { label: 'Headshots', icon: <ImageUp {...ICON} /> },
];

/** Props for Sidebar. */
export interface SidebarProps {
  /** True for icons only (from 768 px). */
  collapsed: boolean;
  /** True while the drawer is open (below 768 px). */
  drawerOpen: boolean;
  /** Closes the drawer. */
  onCloseDrawer: () => void;
  /** The card above Help (the desktop app card), if any. */
  card?: ReactNode;
  /** The footer: who is signed in, and their menu. */
  footer: ReactNode;
}

/**
 * Builds the label for what this app is running in: "Desktop app v1.2" (major.minor of the shell
 * version) inside the desktop app, otherwise "Browser". Display only.
 *
 * @returns The label text.
 * Called from: src/features/profile/ProfileDetails.tsx; tests
 */
export function runtimeLabel(): string {
  const desktop = getDesktopInfo();
  if (!desktop) return 'Browser';
  const [major = '0', minor = '0'] = desktop.version.split('.');
  return `Desktop app v${major}.${minor}`;
}

/** A row's shape: 40 px tall, 12 px between icon and words, radius 10 (spec §1). */
const ROW =
  'flex h-10 w-full items-center gap-3 rounded-control px-2.5 text-nav transition-colors duration-(--k-dur) focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11';

/**
 * One link, with its name in a tooltip when only the icon shows.
 *
 * @param props.href      The route.
 * @param props.label     The words.
 * @param props.icon      The icon.
 * @param props.active    True on its own page.
 * @param props.collapsed True for icons only.
 * @param props.onClick   Called when it is pressed.
 * @returns The link.
 * Rendered by: Sidebar
 */
function NavLink({
  href,
  label,
  icon,
  active,
  collapsed,
  onClick,
}: {
  /** The route. */
  href: string;
  /** The words. */
  label: string;
  /** The icon. */
  icon: ReactNode;
  /** True on its own page. */
  active: boolean;
  /** True for icons only. */
  collapsed: boolean;
  /** Called when it is pressed. */
  onClick: () => void;
}) {
  const link = (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      {...(collapsed ? { 'aria-label': label } : {})}
      className={[
        ROW,
        collapsed ? 'md:justify-center md:px-0' : '',
        active ? 'bg-ui-subtle text-ui-heading' : 'text-ui-text hover:bg-ui-hover',
      ].join(' ')}
    >
      {icon}
      <span className={collapsed ? 'truncate md:hidden' : 'truncate'}>{label}</span>
    </Link>
  );
  return collapsed ? (
    <Tooltip content={label} className="w-full">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

/**
 * A feature that is visible but not available yet: pressing it does nothing (spec §5).
 *
 * @param props.label     The words.
 * @param props.icon      The icon.
 * @param props.collapsed True for icons only.
 * @returns The disabled row.
 * Rendered by: Sidebar
 */
function SoonRow({
  label,
  icon,
  collapsed,
}: {
  /** The words. */
  label: string;
  /** The icon. */
  icon: ReactNode;
  /** True for icons only. */
  collapsed: boolean;
}) {
  return (
    <Tooltip content={SOON_TOOLTIP} className="w-full">
      <button
        type="button"
        disabled
        aria-label={`${label} (coming soon)`}
        className={`${ROW} cursor-not-allowed text-ui-muted ${collapsed ? 'md:justify-center md:px-0' : ''}`}
      >
        {icon}
        <span
          className={
            collapsed ? 'flex-1 truncate text-left md:hidden' : 'flex-1 truncate text-left'
          }
        >
          {label}
        </span>
        <span className={collapsed ? 'md:hidden' : ''}>
          <SoonBadge />
        </span>
      </button>
    </Tooltip>
  );
}

/**
 * The signed-in app's sidebar.
 *
 * @param props See SidebarProps.
 * @returns The <aside> navigation element.
 * Rendered by: src/features/shell/AppShell.tsx
 */
export function Sidebar({ collapsed, drawerOpen, onCloseDrawer, card, footer }: SidebarProps) {
  const pathname = usePathname();

  /**
   * One group of links.
   *
   * @param items The links.
   * @returns The list.
   */
  const list = (items: readonly NavItem[]) => (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.label}>
          {item.href ? (
            <NavLink
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={pathname === item.href}
              collapsed={collapsed}
              onClick={onCloseDrawer}
            />
          ) : (
            <SoonRow label={item.label} icon={item.icon} collapsed={collapsed} />
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <aside
      data-collapsed={collapsed}
      className={[
        'flex shrink-0 flex-col border-r border-ui-border bg-ui-sidebar text-ui-text',
        // Below 768 px: a drawer over the page; invisible when shut, so it is out of the tab order.
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-[280px] max-md:max-w-[85vw] max-md:shadow-modal max-md:transition-transform max-md:duration-(--k-dur-slow)',
        drawerOpen ? '' : 'max-md:invisible max-md:-translate-x-full',
        collapsed ? 'md:w-16' : 'md:w-[252px]',
      ].join(' ')}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-ui-border px-4 md:hidden">
        {/* The logo goes to Call Sessions (/), and the drawer closes, as for the links below. */}
        <Link
          href="/"
          aria-label="Paramount AI: go to Call Sessions"
          onClick={onCloseDrawer}
          className="min-w-0 rounded-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          <BrandLockup tone="auto" size="sm" />
        </Link>
        <button
          type="button"
          aria-label="Close the menu"
          onClick={onCloseDrawer}
          className="flex size-8 items-center justify-center rounded-control hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11"
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      {/* v1.3.2: only the links scroll. The desktop app card and Help stay pinned above the footer,
          so on a short laptop window the card is never sliced off by the footer. */}
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-3">
          <div className="flex flex-col gap-0.5">
            <NavLink
              href="/sessions/new"
              label="Create session"
              // The 28 px accent-tinted tile (spec S2). It hangs a little left, so the words line up.
              icon={
                <span className="-mx-1 flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-ui-accent-tint text-ui-accent-fill">
                  <Plus aria-hidden="true" size={18} strokeWidth={2} />
                </span>
              }
              active={pathname === '/sessions/new'}
              collapsed={collapsed}
              onClick={onCloseDrawer}
            />
            {list(MAIN_ITEMS)}
          </div>
          <div className="flex flex-col gap-1">
            {!collapsed && <p className="px-2.5 text-section text-ui-muted">Prepare</p>}
            {collapsed && <p className="px-2.5 text-section text-ui-muted md:hidden">Prepare</p>}
            {list(PREPARE_ITEMS)}
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 px-3 pb-3">
          {/* Below 560 px of height the card would leave no room for the links: it hides. */}
          {!collapsed && card && <div className="[@media(max-height:559px)]:hidden">{card}</div>}
          <NavLink
            href="/help"
            label="Help"
            icon={<LifeBuoy {...ICON} />}
            active={pathname === '/help'}
            collapsed={collapsed}
            onClick={onCloseDrawer}
          />
        </div>
      </nav>

      <div className="shrink-0 border-t border-ui-border p-3">{footer}</div>
    </aside>
  );
}
