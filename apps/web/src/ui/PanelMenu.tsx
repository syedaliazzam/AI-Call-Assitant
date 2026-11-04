/**
 * File: apps/web/src/ui/PanelMenu.tsx
 * Purpose: The rows of the desktop panels' ⋮ menus (v1.1.0, ADR-0041): a group of rows, a link row, a
 *          switch with an optional explanation, a + / − / reset row, the theme row and a list that
 *          opens in place. Used by the home panel's and the overlay's menus, so both read the same.
 *          Explanations and lists are drawn inside the page on purpose: a browser's own <select> list
 *          and title tooltip are separate windows that screen-share protection may not reach
 *          (ADR-0042).
 * Used by: src/features/home/HomeMenu.tsx, src/features/live/overlay/LiveMenu.tsx
 * Depends on: src/ui/icons.tsx, src/core/storage/appearancePrefs.ts (ThemeChoice type)
 * Architecture: docs/design/kite-ui-theme.md §5; ADR-0041, ADR-0042
 */
'use client';

import { useId, useState, type ReactNode } from 'react';
import type { ThemeChoice } from '@/core/storage/appearancePrefs';
import {
  ChevronDownIcon,
  InfoIcon,
  MinusIcon,
  MoonIcon,
  OutIcon,
  PlusIcon,
  ResetIcon,
  SunIcon,
  SystemThemeIcon,
} from './icons';

/** The focus ring every control here shares. */
const FOCUS = 'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/** A row's layout. */
const ROW = 'flex min-h-9 items-center gap-2 rounded-control px-2 py-1 text-[14px] text-ui-text';

/** A small round button in a row. */
const ROUND = `inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-ui-border text-ui-text hover:bg-ui-hover disabled:opacity-40 ${FOCUS}`;

/**
 * A block of rows.
 *
 * @param props.children The rows.
 * @returns The block.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuBlock({
  children,
}: {
  /** The rows. */
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col divide-y divide-ui-border rounded-control border border-ui-border">
      {children}
    </div>
  );
}

/**
 * A row that does something when pressed.
 *
 * @param props.label    The words.
 * @param props.icon     An icon before them.
 * @param props.out      True when it opens somewhere else (shows ↗).
 * @param props.danger   True for a destructive action's colour.
 * @param props.disabled True to grey it out.
 * @param props.onSelect What it does.
 * @returns The row.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuAction({
  label,
  icon,
  out = false,
  danger = false,
  disabled = false,
  onSelect,
}: {
  /** The words. */
  label: string;
  /** An icon before them. */
  icon?: ReactNode;
  /** True when it opens somewhere else (shows ↗). */
  out?: boolean;
  /** True for a destructive action's colour. */
  danger?: boolean;
  /** True to grey it out. */
  disabled?: boolean;
  /** What it does. */
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`${ROW} w-full text-left hover:bg-ui-hover disabled:opacity-50 ${FOCUS} ${danger ? 'text-ui-danger' : ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {out && <OutIcon />}
    </button>
  );
}

/**
 * A switch, with an explanation that opens under the row while the info button has the pointer or the
 * keyboard. In the page, not a title tooltip (see the file header).
 *
 * @param props.label    The words.
 * @param props.info     The explanation, if any.
 * @param props.checked  True when on.
 * @param props.disabled True to grey it out.
 * @param props.onChange Called with the new state.
 * @returns The row.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuSwitch({
  label,
  info,
  checked,
  disabled = false,
  onChange,
}: {
  /** The words. */
  label: string;
  /** The explanation, if any. */
  info?: string;
  /** True when on. */
  checked: boolean;
  /** True to grey it out. */
  disabled?: boolean;
  /** Called with the new state. */
  onChange: (checked: boolean) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const hintId = useId();
  return (
    <div>
      <div className={ROW}>
        <span className="truncate">{label}</span>
        {info && (
          <button
            type="button"
            aria-label={`About ${label}`}
            aria-expanded={showInfo}
            aria-controls={hintId}
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full text-ui-muted hover:text-ui-text ${FOCUS}`}
            onPointerEnter={() => setShowInfo(true)}
            onPointerLeave={() => setShowInfo(false)}
            onFocus={() => setShowInfo(true)}
            onBlur={() => setShowInfo(false)}
          >
            <InfoIcon size={14} />
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`inline-flex shrink-0 rounded-full disabled:opacity-50 ${FOCUS}`}
        >
          <span
            aria-hidden="true"
            className={`relative inline-flex h-5 w-9 rounded-full border transition-colors duration-150 ${checked ? 'border-ui-primary bg-ui-primary' : 'border-ui-border bg-ui-subtle'}`}
          >
            <span
              className={`absolute top-[1px] size-4 rounded-full transition-transform duration-150 ${checked ? 'translate-x-4 bg-ui-on-primary' : 'translate-x-[1px] bg-ui-muted'}`}
            />
          </span>
        </button>
      </div>
      {info && showInfo && (
        <p id={hintId} role="note" className="px-2 pb-2 text-[12px] leading-snug text-ui-muted">
          {info}
        </p>
      )}
    </div>
  );
}

/**
 * A row with + / − / reset.
 *
 * @param props.label   The words.
 * @param props.value   The value, in words, for screen readers and at a glance.
 * @param props.onMore  Makes it larger.
 * @param props.onLess  Makes it smaller.
 * @param props.onReset Goes back to the default.
 * @param props.canMore False at the top of its range.
 * @param props.canLess False at the bottom of its range.
 * @returns The row.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuStepper({
  label,
  value,
  onMore,
  onLess,
  onReset,
  canMore = true,
  canLess = true,
}: {
  /** The words. */
  label: string;
  /** The value, in words. */
  value: string;
  /** Makes it larger. */
  onMore: () => void;
  /** Makes it smaller. */
  onLess: () => void;
  /** Goes back to the default. */
  onReset: () => void;
  /** False at the top of its range. */
  canMore?: boolean;
  /** False at the bottom of its range. */
  canLess?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={ROW}>
      <span className="truncate">{label}</span>
      <span aria-live="polite" className="text-[12px] tabular-nums text-ui-muted">
        {value}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className={ROUND}
        aria-label={`${label}: more`}
        disabled={!canMore}
        onClick={onMore}
      >
        <PlusIcon size={14} />
      </button>
      <button
        type="button"
        className={ROUND}
        aria-label={`${label}: less`}
        disabled={!canLess}
        onClick={onLess}
      >
        <MinusIcon size={14} />
      </button>
      <button type="button" className={ROUND} aria-label={`${label}: reset`} onClick={onReset}>
        <ResetIcon size={14} />
      </button>
    </div>
  );
}

/** The theme choices, in the order shown. */
const THEMES: readonly { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light theme', icon: <SunIcon size={14} /> },
  { value: 'dark', label: 'Dark theme', icon: <MoonIcon size={14} /> },
  { value: 'system', label: 'Follow the system', icon: <SystemThemeIcon size={14} /> },
];

/**
 * The theme row.
 *
 * @param props.value    The current choice.
 * @param props.onChange Called with the new choice.
 * @returns The row.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuTheme({
  value,
  onChange,
}: {
  /** The current choice. */
  value: ThemeChoice;
  /** Called with the new choice. */
  onChange: (theme: ThemeChoice) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Theme" className={ROW}>
      <span className="truncate">Theme</span>
      <span className="flex-1" />
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          role="radio"
          aria-checked={value === theme.value}
          aria-label={theme.label}
          onClick={() => onChange(theme.value)}
          className={`${ROUND} ${value === theme.value ? 'bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover' : ''}`}
        >
          {theme.icon}
        </button>
      ))}
    </div>
  );
}

/**
 * A list that opens in place under its row: the choices stay inside the page (see the file header).
 *
 * @param props.label    What it chooses, for screen readers.
 * @param props.icon     An icon before the value.
 * @param props.value    The current choice's value.
 * @param props.options  The choices.
 * @param props.onChange Called with the chosen value.
 * @returns The row and, while open, its choices.
 * Rendered by: LiveMenu.tsx, src/features/live/overlay/*
 */
export function MenuList<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  /** What it chooses, for screen readers. */
  label: string;
  /** An icon before the value. */
  icon?: ReactNode;
  /** The current choice's value. */
  value: T;
  /** The choices. */
  options: readonly { value: T; label: string }[];
  /** Called with the chosen value. */
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <div>
      <button
        type="button"
        aria-label={`${label}: ${current}`}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={`${ROW} w-full text-left hover:bg-ui-hover ${FOCUS}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{current}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="flex flex-col pb-1">
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  setOpen(false);
                  onChange(option.value);
                }}
                className={`w-full rounded-control px-4 py-1 text-left text-[13px] hover:bg-ui-hover ${FOCUS} ${option.value === value ? 'font-semibold text-ui-text' : 'text-ui-muted'}`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
