/**
 * File: apps/web/src/ui/Tabs.tsx
 * Purpose: A row of filter tabs (one selected), for example All / Interview / Sales / Support /
 *          Internal on the dashboard. They filter a list; they do not switch panels.
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1 filter by type), §9.1
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
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 border-b border-slate-200">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={[
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              selected
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
