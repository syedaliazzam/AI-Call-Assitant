/**
 * File: apps/web/src/ui/Tabs.tsx
 * Purpose: A row of filter tabs (one selected, with an underline; spec S3), for example All / Interview
 *          / Regular / Mock on the sessions page, with room for a note at the right. They filter a list;
 *          they do not switch panels.
 * Used by: src/features/dashboard/Dashboard.tsx, src/features/review/ConversationSection.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3); docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import type { ReactNode } from 'react';

/** One tab. */
export interface TabOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** Text on the tab. */
  label: string;
  /** An icon before the text. */
  icon?: ReactNode;
}

/** Props for Tabs. */
export interface TabsProps<T extends string> {
  /** Accessible name of the group, for example "Session type". */
  label: string;
  /** The tabs, in display order. */
  options: readonly TabOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the new value when a tab is clicked. */
  onChange: (value: T) => void;
  /** Something at the right of the row, for example the number of sessions. */
  end?: ReactNode;
  /** True when the row runs to the page's edges, so its contents need the page's side margin. */
  inset?: boolean;
}

/**
 * Filter tabs: toggle buttons in a group, the selected one marked with aria-pressed (a filter
 * is a choice of what the list shows, so buttons fit better than ARIA tab panels).
 *
 * @param props See TabsProps.
 * @returns The group of buttons.
 * Rendered by: Dashboard.tsx, ConversationSection.tsx
 */
export function Tabs<T extends string>({
  label,
  options,
  value,
  onChange,
  end,
  inset = false,
}: TabsProps<T>) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 border-b border-ui-border ${inset ? 'px-5 max-sm:px-3' : ''}`}
    >
      <div role="group" aria-label={label} className="flex min-w-0 flex-wrap gap-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={[
                '-mb-px inline-flex h-11 items-center gap-2 rounded-none border-b-2 px-4 text-[15px] font-medium transition-colors duration-150 max-sm:px-2.5',
                'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
                selected
                  ? 'border-ui-primary text-ui-heading'
                  : 'border-transparent text-ui-muted hover:text-ui-heading',
              ].join(' ')}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
      </div>
      {end}
    </div>
  );
}
