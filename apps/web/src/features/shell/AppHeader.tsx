/**
 * File: apps/web/src/features/shell/AppHeader.tsx
 * Purpose: The bar across the top of every signed-in page (spec S1). Left, at the sidebar's width: the
 *          logo, the wordmark and the sidebar's button. Then the page's title and line, and the "Create
 *          session" split button at the far right (on Admin → Users: Usage and "Add user" instead).
 *          On a phone the title takes a second row.
 * Used by: src/features/shell/AppShell.tsx
 * Depends on: next/navigation, lucide-react, src/ui/BrandLockup.tsx, ./CreateSessionButton.tsx,
 *             src/features/admin/AddUserButton.tsx, ./pageTitles.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S1)
 */
'use client';

import { PanelLeft } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AddUserButton } from '@/features/admin/AddUserButton';
import { BrandLockup } from '@/ui/BrandLockup';
import { CreateSessionButton } from './CreateSessionButton';
import { pageTitleFor } from './pageTitles';

/** Props for AppHeader. */
export interface AppHeaderProps {
  /** True when the sidebar shows icons only. */
  collapsed: boolean;
  /** Collapses or expands the sidebar (from 768 px). */
  onToggleCollapsed: () => void;
  /** Opens the sidebar's drawer (below 768 px). */
  onOpenDrawer: () => void;
}

/**
 * The header.
 *
 * @param props See AppHeaderProps.
 * @returns The <header>.
 * Rendered by: AppShell.tsx
 */
export function AppHeader({ collapsed, onToggleCollapsed, onOpenDrawer }: AppHeaderProps) {
  const pathname = usePathname();
  const { title, subtitle, action } = pageTitleFor(pathname);
  return (
    <header className="flex shrink-0 flex-wrap items-center border-b border-ui-border bg-ui-sidebar md:h-[76px] md:flex-nowrap">
      <div
        className={[
          'flex h-14 min-w-0 items-center gap-2 pl-4 md:h-full md:shrink-0 md:border-r md:border-ui-border',
          collapsed
            ? 'md:w-16 md:justify-center md:pl-0'
            : 'md:w-[252px] md:justify-between md:pr-3',
        ].join(' ')}
      >
        {/* The logo goes to Call Sessions (/), as the sidebar's first link does. */}
        <Link
          href="/"
          aria-label="Paramount AI: go to Call Sessions"
          className={`min-w-0 rounded-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${collapsed ? 'md:hidden' : ''}`}
        >
          <BrandLockup tone="auto" size="sm" />
        </Link>
        {/* One button: it collapses the sidebar on a computer and opens the drawer on a phone. */}
        <button
          type="button"
          aria-label="Open the menu"
          onClick={onOpenDrawer}
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11 md:hidden"
        >
          <PanelLeft aria-hidden="true" size={20} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          onClick={onToggleCollapsed}
          className="hidden size-8 shrink-0 items-center justify-center rounded-control text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] md:flex"
        >
          <PanelLeft aria-hidden="true" size={20} strokeWidth={1.75} />
        </button>
      </div>
      <div className="order-last w-full min-w-0 px-4 pb-3 md:order-none md:w-auto md:flex-1 md:px-5 md:pb-0">
        {/* Not a heading: each page keeps its own <h1>, so a screen reader hears one title. */}
        <p className="truncate text-page-title text-ui-heading">{title}</p>
        {subtitle && <p className="truncate text-page-subtitle text-ui-muted">{subtitle}</p>}
      </div>
      <div className="ml-auto shrink-0 pr-4 md:pr-6">
        {/* Admin → Users has its own buttons; every other page offers Create session. */}
        {action === 'add-user' ? <AddUserButton /> : <CreateSessionButton />}
      </div>
    </header>
  );
}
