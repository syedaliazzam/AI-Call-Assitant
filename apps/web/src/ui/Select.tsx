/**
 * File: apps/web/src/ui/Select.tsx
 * Purpose: A labelled drop-down drawn in the page: optional search box, a check mark on the current
 *          choice, a tag at the end of a row, and footer actions under a divider ("+ Upload a resume").
 *          Not a native <select>: its list is a separate window, which cannot be styled and which
 *          screen-share protection may not reach (ADR-0042).
 * Used by: src/features/session-setup/*, src/features/settings/*, src/features/prepare/*
 * Depends on: React, lucide-react, ./listNavigation.ts, ./useAnchoredPopup.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S4, S5); ADR-0042
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { filterOptions, nextEnabled, typeAhead } from './listNavigation';
import { useAnchoredPopup } from './useAnchoredPopup';

/** One choice in the list. */
export interface SelectOption<T extends string> {
  /** Value reported to onChange. */
  value: T;
  /** Text shown for it; long names wrap. */
  label: string;
  /** A muted word at the end of the row, for example "Recommended". */
  tag?: string;
  /** An icon before the label, in the list and on the closed field. */
  icon?: ReactNode;
  /** True when it cannot be chosen. */
  disabled?: boolean;
}

/** An action under the list, for example "+ Upload a resume". */
export interface SelectAction {
  /** The words. */
  label: string;
  /** An icon before the words. */
  icon?: ReactNode;
  /** What it does; the list closes first. */
  onSelect: () => void;
}

/** Props for Select. */
export interface SelectProps<T extends string> {
  /** The label above the field. */
  label: string;
  /** True to keep the label for screen readers only (the control sits at the end of a row). */
  hideLabel?: boolean;
  /** The choices, in display order. */
  options: readonly SelectOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the new value. */
  onChange: (value: T) => void;
  /** Optional help text under the field. */
  hint?: string;
  /** True to show it greyed out. */
  disabled?: boolean;
  /** True to show a search box at the top of the list. */
  searchable?: boolean;
  /** The search box's placeholder (default "Search"). */
  searchPlaceholder?: string;
  /** Shown on the field when `value` matches no option. */
  placeholder?: string;
  /** Actions under the list, after a divider. */
  actions?: readonly SelectAction[];
  /** The closed field's alignment against the list: 'start' (default) or 'end' (a row's right edge). */
  align?: 'start' | 'end';
  /** Extra classes for the closed field, for example a fixed width. */
  className?: string;
}

/**
 * A labelled drop-down. The closed field is a combobox button; arrow keys move, Enter chooses, Escape
 * closes and returns to the field, and without a search box typing jumps to a matching option.
 *
 * @param props See SelectProps.
 * @returns The label, the field, the list while open and the hint.
 * Rendered by: DetailsStep.tsx, PreferencesStep.tsx, Settings.tsx, OverlaySetting.tsx
 */
export function Select<T extends string>({
  label,
  hideLabel = false,
  options,
  value,
  onChange,
  hint,
  disabled = false,
  searchable = false,
  searchPlaceholder = 'Search',
  placeholder = 'Choose',
  actions = [],
  align = 'start',
  className = '',
}: SelectProps<T>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const listId = `${id}-list`;
  const labelId = `${id}-label`;
  const { open, setOpen, anchorRef, popupRef } = useAnchoredPopup<
    HTMLButtonElement,
    HTMLDivElement
  >({ matchWidth: true, placement: align === 'end' ? 'bottom-end' : 'bottom-start' });
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(-1);
  const typed = useRef({ letters: '', at: 0 });
  const searchRef = useRef<HTMLInputElement>(null);

  const shown = searchable ? filterOptions(options, query) : options;
  const current = options.find((option) => option.value === value);

  // When it opens, the keyboard goes to the search box or the list.
  useEffect(() => {
    if (!open) return;
    if (searchable) searchRef.current?.focus();
    else popupRef.current?.focus();
  }, [open, searchable, popupRef]);

  /** Opens the list, starting on the current choice with an empty search. */
  function openList() {
    setQuery('');
    setHighlight(options.findIndex((option) => option.value === value));
    setOpen(true);
  }

  // The highlighted row stays in view as the keys move through a long list.
  useEffect(() => {
    if (!open || highlight < 0) return;
    popupRef.current
      ?.querySelector(`[data-index="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, highlight, popupRef]);

  /** Closes the list and returns the keyboard to the field. */
  function close() {
    setOpen(false);
    anchorRef.current?.focus();
  }

  /**
   * Chooses an option and closes.
   *
   * @param option The option.
   */
  function choose(option: SelectOption<T>) {
    if (option.disabled) return;
    onChange(option.value);
    close();
  }

  /**
   * The list's keys.
   *
   * @param event The key press.
   */
  function onListKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((from) => nextEnabled(shown, from, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setHighlight(
        nextEnabled(shown, event.key === 'Home' ? -1 : 0, event.key === 'Home' ? 1 : -1),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = shown[highlight];
      if (option) choose(option);
    } else if (event.key === 'Escape') {
      // Also stops the key from closing a modal this list sits in.
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (!searchable && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      // Type-ahead: letters typed within a second count as one word.
      const now = event.timeStamp;
      const letters = now - typed.current.at < 1000 ? typed.current.letters + event.key : event.key;
      typed.current = { letters, at: now };
      const found = typeAhead(shown, letters.length > 1 ? highlight - 1 : highlight, letters);
      if (found !== -1) setHighlight(found);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        id={labelId}
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'text-label text-ui-heading'}
      >
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
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openList();
          }
        }}
        className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-control border border-ui-border bg-ui-input px-3 text-left text-base text-ui-text transition-colors hover:bg-ui-hover focus-visible:border-ui-link focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] disabled:cursor-not-allowed disabled:opacity-60 pointer-coarse:min-h-11 md:text-input ${className}`}
      >
        {current?.icon}
        <span className={`min-w-0 flex-1 truncate ${current ? '' : 'text-ui-muted'}`}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          className={`shrink-0 text-ui-muted transition-transform duration-(--k-dur) ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          ref={popupRef}
          popover="manual"
          tabIndex={-1}
          onKeyDown={onListKey}
          aria-activedescendant={highlight >= 0 ? `${id}-option-${highlight}` : undefined}
          className="k-anim-menu fixed inset-auto m-0 flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-menu border border-ui-border bg-ui-surface p-0 text-ui-text shadow-modal outline-none"
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-ui-border p-1.5">
              <div className="flex h-9 flex-1 items-center gap-2 rounded-control border border-ui-border px-2.5 focus-within:border-ui-link">
                <Search aria-hidden="true" size={16} className="shrink-0 text-ui-muted" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlight(-1);
                  }}
                  className="min-w-0 flex-1 bg-transparent text-input text-ui-text placeholder:text-ui-muted focus:outline-none"
                />
              </div>
            </div>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
          >
            {shown.map((option, index) => {
              const selected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={`${id}-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled ? true : undefined}
                  onPointerMove={() => setHighlight(index)}
                  onClick={() => choose(option)}
                  className={[
                    'flex min-h-10 cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-input',
                    option.disabled ? 'cursor-not-allowed opacity-50' : '',
                    index === highlight || selected ? 'bg-ui-subtle' : '',
                  ].join(' ')}
                >
                  {option.icon}
                  <span className="min-w-0 flex-1 break-words">{option.label}</span>
                  {option.tag && <span className="shrink-0 text-ui-muted">{option.tag}</span>}
                  {selected && (
                    <Check aria-hidden="true" size={16} className="shrink-0 text-ui-muted" />
                  )}
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="px-2.5 py-2 text-helper text-ui-muted">No matches</li>
            )}
          </ul>
          {actions.length > 0 && (
            <div className="flex flex-col gap-0.5 border-t border-ui-border p-1.5">
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
        </div>
      )}
      {hint && (
        <p id={hintId} className="text-helper text-ui-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
