/**
 * File: apps/web/src/ui/SegmentedControl.tsx
 * Purpose: A choice of a few options in one grey track, with the selected segment raised (spec S4:
 *          Session type). Arrow keys move the choice, as in any radio group.
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4)
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

/** One segment. */
export interface SegmentOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** The words. */
  label: string;
  /** An icon before the words. */
  icon?: ReactNode;
}

/** Props for SegmentedControl. */
export interface SegmentedControlProps<T extends string> {
  /** The label above the track. */
  label: string;
  /** The segments, in display order. */
  options: readonly SegmentOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the new value. */
  onChange: (value: T) => void;
}

/**
 * The segmented control.
 *
 * @param props See SegmentedControlProps.
 * @returns The label and the track.
 * Rendered by: DetailsStep.tsx
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const labelId = useId();
  const track = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys choose the next or previous segment.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !back) return;
    event.preventDefault();
    const at = options.findIndex((option) => option.value === value);
    const next = options[(at + (forward ? 1 : -1) + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    track.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-label text-ui-heading">
        {label}
      </span>
      <div
        ref={track}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="flex gap-1 rounded-control bg-ui-subtle p-1"
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              data-value={option.value}
              // One tab stop: the arrow keys move within the group.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={[
                'flex h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] text-[15px] font-medium transition-colors duration-150 pointer-coarse:min-h-11',
                'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
                selected
                  ? 'bg-ui-segment text-ui-heading [box-shadow:0_1px_2px_var(--k-segment-shadow)]'
                  : 'text-ui-text hover:text-ui-heading',
              ].join(' ')}
            >
              {option.icon}
              <span className="truncate">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
