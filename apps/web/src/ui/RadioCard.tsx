/**
 * File: apps/web/src/ui/RadioCard.tsx
 * Purpose: Radio choices drawn as cards (spec S6): a 1 px border, a 1.5 px dark border when selected,
 *          and an accent radio dot, with a title and a line of explanation.
 * Used by: src/features/session-setup/AnswerPreferencesDialog.tsx
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S6)
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { useRef, type KeyboardEvent } from 'react';

/** One card. */
export interface RadioCardOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** The title. */
  label: string;
  /** The line under the title. */
  description: string;
}

/** Props for RadioCards. */
export interface RadioCardsProps<T extends string> {
  /** The group's name, for screen readers. */
  label: string;
  /** The cards, in display order. */
  options: readonly RadioCardOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the new value. */
  onChange: (value: T) => void;
}

/**
 * The group of radio cards. Arrow keys move the choice, as in any radio group.
 *
 * @param props See RadioCardsProps.
 * @returns The cards.
 * Rendered by: AnswerPreferencesDialog.tsx
 */
export function RadioCards<T extends string>({
  label,
  options,
  value,
  onChange,
}: RadioCardsProps<T>) {
  const group = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys choose the next or previous card.
   *
   * @param event The key press.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const back = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    if (!forward && !back) return;
    event.preventDefault();
    const at = options.findIndex((option) => option.value === value);
    const next = options[(at + (forward ? 1 : -1) + options.length) % options.length];
    if (!next) return;
    onChange(next.value);
    group.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
  }

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-2.5"
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
              'flex items-center gap-3.5 rounded-card bg-ui-bg px-4 py-3 text-left transition-colors duration-150 hover:bg-ui-hover',
              'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]',
              // The selected border is drawn as an inset ring, so the card's size never changes.
              selected
                ? 'border border-transparent [box-shadow:inset_0_0_0_1.5px_var(--ui-selected)]'
                : 'border border-ui-border',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={`flex size-[18px] shrink-0 items-center justify-center rounded-full border ${selected ? 'border-ui-accent-fill' : 'border-ui-control-strong'}`}
            >
              {selected && <span className="size-2.5 rounded-full bg-ui-accent-fill" />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-label text-ui-heading">{option.label}</span>
              <span className="text-helper text-ui-muted">{option.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
