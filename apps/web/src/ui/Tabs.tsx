/**
 * File: apps/web/src/ui/Tabs.tsx
 * Purpose: A row of filter tabs (one selected), for example All / Interview / Regular / Mock on
 *          the dashboard. They filter a list; they do not switch panels.
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1 filter by type), §9.1
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/tokens/theme.css)
 */

/** One tab. */
export interface TabOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** Text on the tab. */
  label: string;
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
}

/**
 * Filter tabs: toggle buttons in a group, the selected one marked with aria-pressed (a filter
 * is a choice of what the list shows, so buttons fit better than ARIA tab panels).
 *
 * @param props See TabsProps.
 * @returns The group of buttons.
 * Rendered by: Dashboard.tsx
 */
export function Tabs<T extends string>({ label, options, value, onChange }: TabsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 border-b border-ui-border">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={[
              '-mb-px rounded-none border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150',
              'pointer-coarse:min-h-11',
              'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
              selected
                ? 'border-ui-primary text-ui-heading'
                : 'border-transparent text-ui-muted hover:text-ui-heading',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
