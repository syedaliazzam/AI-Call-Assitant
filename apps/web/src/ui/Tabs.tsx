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
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Where the underline sits, in px from the group's top-left corner. */
interface IndicatorBox {
  /** Distance from the group's left edge. */
  left: number;
  /** Distance from the group's top edge to the underline. */
  top: number;
  /** The selected tab's width. */
  width: number;
}

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
 * v1.3.1 (ADR-0058): one underline slides to the selected tab over 200 ms (--k-dur-slow; instant
 * under "reduce motion"). It is measured from the selected button, and measured again when the row
 * changes size (the tabs wrap on narrow screens).
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
  const group = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<IndicatorBox | null>(null);

  // Measure before paint, so the underline never shows under the old tab for a frame.
  useLayoutEffect(() => {
    const row = group.current;
    if (!row) return undefined;
    const measure = () => {
      const button = row.querySelector<HTMLElement>('button[aria-pressed="true"]');
      setIndicator(
        button
          ? {
              left: button.offsetLeft,
              top: button.offsetTop + button.offsetHeight - 2,
              width: button.offsetWidth,
            }
          : null,
      );
    };
    measure();
    // jsdom (unit tests) has no ResizeObserver; the first measurement is enough there.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 border-b border-ui-border ${inset ? 'px-5 max-sm:px-3' : ''}`}
    >
      <div
        ref={group}
        role="group"
        aria-label={label}
        className="relative flex min-w-0 flex-wrap gap-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={[
                // v1.3.0 (ADR-0057): 44 tall, padding 12 × 16, radius 14; the selected one at 600.
                // The transparent bottom border keeps the height; the sliding underline is drawn below.
                '-mb-px inline-flex h-11 items-center gap-2 rounded-t-tab border-b-2 border-transparent px-4 py-3 text-[16px] transition-colors duration-(--k-dur) max-sm:px-2.5',
                'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
                selected
                  ? 'font-semibold text-ui-heading'
                  : 'font-medium text-ui-muted hover:bg-ui-hover hover:text-ui-heading',
              ].join(' ')}
            >
              {option.icon}
              {option.label}
            </button>
          );
        })}
        {indicator && (
          <span
            aria-hidden="true"
            data-testid="tab-indicator"
            className="pointer-events-none absolute h-0.5 bg-ui-primary transition-[left,top,width] duration-(--k-dur-slow) ease-(--k-ease-out)"
            style={{
              left: indicator.left,
              top: indicator.top,
              width: indicator.width,
            }}
          />
        )}
      </div>
      {end}
    </div>
  );
}
