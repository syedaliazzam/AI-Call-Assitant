/**
 * File: apps/web/src/features/dashboard/SessionSearch.tsx
 * Purpose: The sessions search box joined to its sort button (v1.3.0, ADR-0057: 39 tall, 14 px text,
 *          the words 32 px in, after the icon): newest first, oldest first or A–Z. ADR-0071: shared by
 *          the sessions page and the desktop app's "Your sessions".
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/home/LauncherSessions.tsx
 * Depends on: lucide-react, src/core/storage/sessions.ts (SessionSort), src/ui/Menu.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3); ADR-0057, ADR-0071
 */
'use client';

import { ArrowUpDown, Search } from 'lucide-react';
import type { SessionSort } from '@/core/storage/sessions';
import { Menu } from '@/ui/Menu';

/** The sort choices, in menu order. */
export const SORT_OPTIONS: readonly { value: SessionSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'company', label: 'A–Z' },
];

/** Props for SessionSearch. */
export interface SessionSearchProps {
  /** The search text. */
  search: string;
  /** Called with the new text on every key. */
  onSearch: (text: string) => void;
  /** The grey hint in the empty box. */
  placeholder: string;
  /** The current order. */
  sort: SessionSort;
  /** Called when another order is chosen. */
  onSort: (sort: SessionSort) => void;
  /** Extra classes for the control (its width). */
  className?: string;
}

/**
 * The search box and the sort button, read as one control.
 *
 * @param props See SessionSearchProps.
 * @returns The control.
 * Rendered by: Dashboard.tsx, LauncherSessions.tsx
 */
export function SessionSearch({
  search,
  onSearch,
  placeholder,
  sort,
  onSort,
  className = '',
}: SessionSearchProps) {
  return (
    <div
      className={`relative flex h-[39px] min-w-0 items-center rounded-control border border-ui-border bg-ui-input shadow-raised focus-within:border-ui-link pointer-coarse:min-h-11 ${className}`}
    >
      <Search
        aria-hidden="true"
        size={16}
        className="pointer-events-none absolute left-2.5 shrink-0 text-ui-muted"
      />
      <input
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={placeholder}
        aria-label="Search sessions"
        className="h-full min-w-0 flex-1 bg-transparent pl-8 pr-2 text-base text-ui-text placeholder:text-ui-muted focus:outline-none md:text-[14px]"
      />
      <div className="h-full border-l border-ui-border">
        <Menu
          label={<ArrowUpDown aria-hidden="true" size={18} strokeWidth={1.75} />}
          ariaLabel="Sort"
          variant="plain"
          size="md"
          fillHeight
          buttonClassName="h-full rounded-l-none px-3"
          items={SORT_OPTIONS.map((option) => ({
            label: option.label,
            selected: option.value === sort,
            onSelect: () => onSort(option.value),
          }))}
        />
      </div>
    </div>
  );
}
