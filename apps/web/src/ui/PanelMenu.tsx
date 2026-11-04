/**
 * File: apps/web/src/ui/PanelMenu.tsx
 * Purpose: The rows of the desktop panels' ⋮ menus (spec S12, S16): a group of rows 40 px tall with
 *          dividers (radius 14), a link row, a switch with an optional explanation, a + / − / ⟲ row, a
 *          row of icon buttons (Theme), "Soon" rows and a list that opens in place. Used by the home
 *          panel's and the overlay's menus, so both read the same.
 *          Explanations and lists are drawn inside the page on purpose: a browser's own <select> list
 *          and title tooltip are separate windows that screen-share protection may not reach
 *          (ADR-0042).
 * Used by: src/features/home/HomeMenu.tsx, src/features/live/overlay/LiveMenu.tsx
 * Depends on: src/ui/icons.tsx, ./Chip.tsx, ./Toggle.tsx, ./Tooltip.tsx,
 *             src/core/storage/appearancePrefs.ts (ThemeChoice type)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S12, S16); ADR-0041, ADR-0042
 */
'use client';

import { useId, useState, type ReactNode } from 'react';
import type { ThemeChoice } from '@/core/storage/appearancePrefs';
import { SOON_TOOLTIP, SoonBadge } from './Chip';
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
import { Switch } from './Toggle';
import { Tooltip } from './Tooltip';

/** The focus ring every control here shares. */
const FOCUS = 'focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/** A row's layout. */
const ROW = 'flex min-h-10 items-center gap-2.5 px-3 py-1 text-input text-ui-text';

/** A small square button's shape in a row, without its colours. */
const SQUARE_SHAPE = `inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] disabled:opacity-40 ${FOCUS}`;

/** A small square button in a row. */
const SQUARE = `${SQUARE_SHAPE} text-ui-text hover:bg-ui-hover`;

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
    <div className="flex flex-col divide-y divide-ui-border overflow-hidden rounded-menu border border-ui-border">
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
 * @param props.soon     True for a feature that is visible but not available yet (spec §5).
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
  soon = false,
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
  /** True for a feature that is visible but not available yet. */
  soon?: boolean;
  /** What it does. */
  onSelect?: () => void;
}) {
  const row = (
    <button
      type="button"
      disabled={disabled || soon}
      onClick={onSelect}
      className={`${ROW} w-full text-left hover:bg-ui-hover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${FOCUS} ${danger ? 'text-ui-danger' : ''}`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {soon && <SoonBadge />}
      {out && <OutIcon />}
    </button>
  );
  return soon ? (
    <Tooltip content={SOON_TOOLTIP} className="w-full">
      {row}
    </Tooltip>
  ) : (
    row
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
 * @param props.soon     True for a feature that is visible but not available yet (spec §5).
 * @param props.onChange Called with the new state.
 * @returns The row.
 * Rendered by: HomeMenu.tsx, LiveMenu.tsx
 */
export function MenuSwitch({
  label,
  info,
  checked,
  disabled = false,
  soon = false,
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
  /** True for a feature that is visible but not available yet. */
  soon?: boolean;
  /** Called with the new state. */
  onChange: (checked: boolean) => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const hintId = useId();
  return (
    <div>
      <div className={`${ROW} ${soon ? 'opacity-60' : ''}`}>
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
        {soon ? (
          <Tooltip content={SOON_TOOLTIP}>
            <SoonBadge />
          </Tooltip>
        ) : (
          <Switch checked={checked} ariaLabel={label} disabled={disabled} onChange={onChange} />
        )}
      </div>
      {info && showInfo && (
        <p id={hintId} role="note" className="px-3 pb-2 text-[12px] leading-snug text-ui-muted">
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
        className={SQUARE}
        aria-label={`${label}: more`}
        disabled={!canMore}
        onClick={onMore}
      >
        <PlusIcon size={14} />
      </button>
      <button
        type="button"
        className={SQUARE}
        aria-label={`${label}: less`}
        disabled={!canLess}
        onClick={onLess}
      >
        <MinusIcon size={14} />
      </button>
      <button type="button" className={SQUARE} aria-label={`${label}: reset`} onClick={onReset}>
        <ResetIcon size={14} />
      </button>
    </div>
  );
}

/** The theme choices, in the order shown. */
const THEMES: readonly { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light theme', icon: <SunIcon /> },
  { value: 'dark', label: 'Dark theme', icon: <MoonIcon /> },
  { value: 'system', label: 'Follow the system', icon: <SystemThemeIcon /> },
];

/**
 * A row with a label and a group of icon buttons, one of them chosen.
 *
 * @param props.label    The words.
 * @param props.value    The current choice.
 * @param props.options  The choices.
 * @param props.onChange Called with the new choice.
 * @returns The row.
 * Rendered by: MenuTheme
 */
export function MenuIconGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** The words. */
  label: string;
  /** The current choice. */
  value: T;
  /** The choices: each one's value, accessible name and icon. */
  options: readonly { value: T; label: string; icon: ReactNode }[];
  /** Called with the new choice. */
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={ROW}>
      <span className="truncate">{label}</span>
      <span className="flex-1" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          onClick={() => onChange(option.value)}
          className={`${SQUARE_SHAPE} ${value === option.value ? 'bg-ui-primary text-ui-on-primary hover:bg-ui-primary-hover' : 'text-ui-text hover:bg-ui-hover'}`}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

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
  return <MenuIconGroup label="Theme" value={value} options={THEMES} onChange={onChange} />;
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
