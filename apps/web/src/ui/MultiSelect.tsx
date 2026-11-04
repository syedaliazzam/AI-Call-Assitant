/**
 * File: apps/web/src/ui/MultiSelect.tsx
 * Purpose: A labelled drop-down that picks several items: rows with check boxes, an action such as
 *          "+ Add a document", and a footer with Select all and Clear (spec S4). Empty, the field says
 *          what is missing ("No documents yet").
 * Used by: src/features/session-setup/DetailsStep.tsx
 * Depends on: React, lucide-react, ./listNavigation.ts, ./useAnchoredPopup.ts, ./Select.tsx (types)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4); ADR-0042
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { nextEnabled } from './listNavigation';
import type { SelectAction } from './Select';
import { useAnchoredPopup } from './useAnchoredPopup';

/** One choice in the list. */
export interface MultiSelectOption {
  /** Value reported to onChange. */
  value: string;
  /** Text shown for it; long names wrap. */
  label: string;
}

/** Props for MultiSelect. */
export interface MultiSelectProps {
  /** The label above the field. */
  label: string;
  /** The choices, in display order. */
  options: readonly MultiSelectOption[];
  /** The selected values. */
  values: readonly string[];
  /** Called with the new selection. */
  onChange: (values: string[]) => void;
  /** Shown on the field when nothing is selected. */
  placeholder?: string;
  /** Shown on the field when there is nothing to select (default: `placeholder`). */
  emptyLabel?: string;
  /** Actions above the footer, for example "+ Add a document". */
  actions?: readonly SelectAction[];
  /** True to show it greyed out. */
  disabled?: boolean;
}

/**
 * What the closed field says.
 *
 * @param options     The choices.
 * @param values      The selected values.
 * @param placeholder Said when nothing is selected.
 * @param emptyLabel  Said when there is nothing to select.
 * @returns The words, and whether they are a placeholder.
 * Called from: MultiSelect; tests
 */
export function multiSelectSummary(
  options: readonly MultiSelectOption[],
  values: readonly string[],
  placeholder: string,
  emptyLabel: string,
): { text: string; muted: boolean } {
  if (options.length === 0) return { text: emptyLabel, muted: true };
  const chosen = options.filter((option) => values.includes(option.value));
  if (chosen.length === 0) return { text: placeholder, muted: true };
  if (chosen.length === 1) return { text: chosen[0]!.label, muted: false };
  return { text: `${chosen.length} selected`, muted: false };
}

/**
 * A drop-down that picks several items. Arrow keys move, Space or Enter tick a row, Escape closes.
 *
 * @param props See MultiSelectProps.
 * @returns The label, the field and the list while open.
 * Rendered by: DetailsStep.tsx
 */
export function MultiSelect({
  label,
  options,
  values,
  onChange,
  placeholder = 'None selected',
  emptyLabel,
  actions = [],
  disabled = false,
}: MultiSelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const listId = `${id}-list`;
  const { open, setOpen, anchorRef, popupRef } = useAnchoredPopup<
    HTMLButtonElement,
    HTMLDivElement
  >({ matchWidth: true });
  const [highlight, setHighlight] = useState(-1);
  const summary = multiSelectSummary(options, values, placeholder, emptyLabel ?? placeholder);

  // When it opens, the keyboard goes to the list.
  useEffect(() => {
    if (open) popupRef.current?.focus();
  }, [open, popupRef]);

  /** Opens the list on its first row. */
  function openList() {
    setHighlight(options.length > 0 ? 0 : -1);
    setOpen(true);
  }

  /**
   * Ticks or unticks a row.
   *
   * @param value The row's value.
   */
  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  /**
   * The list's keys.
   *
   * @param event The key press.
   */
  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((from) => nextEnabled(options, from, event.key === 'ArrowDown' ? 1 : -1));
    } else if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target === event.currentTarget
    ) {
      event.preventDefault();
      const option = options[highlight];
      if (option) toggle(option.value);
    } else if (event.key === 'Escape') {
      // Also stops the key from closing a modal this list sits in.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      anchorRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label id={labelId} htmlFor={id} className="text-label text-ui-heading">
        {label}
      </label>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-control border border-ui-border bg-ui-input px-3 text-left text-base text-ui-text transition-colors hover:bg-ui-hover focus-visible:border-ui-link focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11 md:text-input"
      >
        <span className={`min-w-0 flex-1 truncate ${summary.muted ? 'text-ui-muted' : ''}`}>
          {summary.text}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          className={`shrink-0 text-ui-muted transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          ref={popupRef}
          popover="manual"
          tabIndex={-1}
          onKeyDown={onListKey}
          aria-activedescendant={highlight >= 0 ? `${id}-option-${highlight}` : undefined}
          className="fixed inset-auto m-0 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-menu border border-ui-border bg-ui-surface p-0 text-ui-text shadow-modal outline-none"
        >
          {options.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-labelledby={labelId}
              aria-multiselectable="true"
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
            >
              {options.map((option, index) => {
                const selected = values.includes(option.value);
                return (
                  <li
                    key={option.value}
                    id={`${id}-option-${index}`}
                    role="option"
                    aria-selected={selected}
                    onPointerMove={() => setHighlight(index)}
                    onClick={() => toggle(option.value)}
                    className={`flex min-h-10 cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-1.5 text-input ${index === highlight ? 'bg-ui-subtle' : ''}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border ${selected ? 'border-ui-accent-fill bg-ui-accent-fill text-ui-on-accent' : 'border-ui-control-strong'}`}
                    >
                      {selected && <Check size={14} />}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {actions.length > 0 && (
            <div
              className={`flex flex-col gap-0.5 p-1.5 ${options.length > 0 ? 'border-t border-ui-border' : ''}`}
            >
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className="flex min-h-10 items-center gap-2 rounded-control px-2.5 text-left text-input hover:bg-ui-subtle focus-visible:bg-ui-subtle focus-visible:outline-none"
                >
                  {action.icon}
                  {action.label}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1 border-t border-ui-border p-1.5">
            <button
              type="button"
              disabled={options.length === 0}
              onClick={() => onChange(options.map((option) => option.value))}
              className="h-10 rounded-control text-input hover:bg-ui-subtle focus-visible:bg-ui-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={values.length === 0}
              onClick={() => onChange([])}
              className="h-10 rounded-control text-input hover:bg-ui-subtle focus-visible:bg-ui-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
