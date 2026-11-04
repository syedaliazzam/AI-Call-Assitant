/**
 * File: apps/web/src/ui/Menu.tsx
 * Purpose: A small dropdown menu: a button that opens a list of rows, with icons, dividers, a muted end
 *          word, disabled "Soon" rows and sub-lists (Theme ›). Arrow keys move through the rows, Escape
 *          closes it and returns to the button, and a click elsewhere closes it. Rows are 40 px tall
 *          and the menu's radius is 14 (spec §1, S12).
 * Used by: src/features/dashboard/SessionMenu.tsx, src/ui/SplitButton.tsx, src/ui/Sidebar.tsx
 * Depends on: React, lucide-react, ./Button.tsx, ./Chip.tsx, ./Tooltip.tsx, ./useAnchoredPopup.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { ArrowLeft, Check, ChevronRight } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './Button';
import { SOON_TOOLTIP, SoonBadge } from './Chip';
import type { PopupPlacement } from './popupPosition';
import { Tooltip } from './Tooltip';
import { useAnchoredPopup } from './useAnchoredPopup';

/** One row of a menu. */
export interface MenuItem {
  /** The words on it. */
  label: string;
  /** What it does. The menu closes first. Not needed with `soon` or `items`. */
  onSelect?: () => void;
  /** An icon before the words. */
  icon?: ReactNode;
  /** True for an action that deletes something. */
  danger?: boolean;
  /** True to grey it out. */
  disabled?: boolean;
  /** True for a feature that is visible but not available yet (spec §5). */
  soon?: boolean;
  /** A muted word at the end of the row, for example the current theme. */
  detail?: string;
  /** True for the current choice in a list of choices: it shows a tick. */
  selected?: boolean;
  /** Rows that replace this list when it is pressed (with a way back). */
  items?: readonly MenuEntry[];
}

/** A line between groups of rows. */
export interface MenuDivider {
  /** Marks a divider. */
  divider: true;
}

/** A row or a divider. */
export type MenuEntry = MenuItem | MenuDivider;

/** Props for MenuRows. */
export interface MenuRowsProps {
  /** The rows. */
  items: readonly MenuEntry[];
  /** Called when the menu should close. */
  onClose: () => void;
  /** Called when a row wants the list swapped for its sub-list. */
  onOpenSub?: (item: MenuItem) => void;
}

/**
 * Tells a divider from a row.
 *
 * @param entry A menu entry.
 * @returns True for a divider.
 * Called from: MenuRows
 */
function isDivider(entry: MenuEntry): entry is MenuDivider {
  return 'divider' in entry;
}

/**
 * The rows of an open menu.
 *
 * @param props See MenuRowsProps.
 * @returns The rows.
 * Rendered by: MenuPopup
 */
export function MenuRows({ items, onClose, onOpenSub }: MenuRowsProps) {
  return items.map((entry, index) => {
    if (isDivider(entry)) {
      return <hr key={`divider-${index}`} className="my-1 border-ui-border" />;
    }
    const unavailable = entry.disabled === true || entry.soon === true;
    const row = (
      <button
        type="button"
        role={entry.selected === undefined ? 'menuitem' : 'menuitemradio'}
        aria-checked={entry.selected}
        disabled={unavailable}
        aria-haspopup={entry.items ? 'menu' : undefined}
        onClick={() => {
          if (entry.items) {
            onOpenSub?.(entry);
            return;
          }
          onClose();
          entry.onSelect?.();
        }}
        className={[
          'flex min-h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-input',
          'hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
          'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent',
          entry.danger ? 'text-ui-danger' : 'text-ui-text',
        ].join(' ')}
      >
        {entry.icon && (
          <span
            aria-hidden="true"
            className={`flex shrink-0 ${entry.danger ? '' : 'text-ui-muted'}`}
          >
            {entry.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.detail && <span className="shrink-0 text-ui-muted">{entry.detail}</span>}
        {entry.soon && <SoonBadge />}
        {entry.selected && (
          <Check aria-hidden="true" size={16} className="shrink-0 text-ui-muted" />
        )}
        {entry.items && (
          <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ui-muted" />
        )}
      </button>
    );
    return entry.soon ? (
      <Tooltip key={entry.label} content={SOON_TOOLTIP} className="w-full">
        {row}
      </Tooltip>
    ) : (
      <div key={entry.label}>{row}</div>
    );
  });
}

/** Props for MenuPopup. */
export interface MenuPopupProps {
  /** The rows of the first list. */
  items: readonly MenuEntry[];
  /** Goes on the popup element. */
  popupRef: React.RefObject<HTMLDivElement | null>;
  /** Called when the menu should close. */
  onClose: () => void;
  /** Called when Escape should close it and return to its button. */
  onEscape: () => void;
}

/**
 * The open list: arrow keys, Escape, and sub-lists.
 *
 * @param props See MenuPopupProps.
 * @returns The popup. Render it only while the menu is open.
 * Rendered by: Menu, SplitButton.tsx
 */
export function MenuPopup({ items, popupRef, onClose, onEscape }: MenuPopupProps) {
  const [sub, setSub] = useState<MenuItem | null>(null);

  // Keyboard users land on the first row, when it opens and when a sub-list replaces the rows.
  useEffect(() => {
    popupRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [sub, popupRef]);

  /**
   * Moves through the rows with the arrow keys; Escape and Tab close the menu.
   *
   * @param event The key press inside the list.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rows = [
      ...(popupRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ??
        []),
    ];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      rows[(at + step + rows.length) % rows.length]?.focus();
    } else if (event.key === 'Escape') {
      // Also stops the key from closing a modal this menu sits in.
      event.preventDefault();
      event.stopPropagation();
      if (sub) setSub(null);
      else onEscape();
    } else if (event.key === 'Tab') {
      onClose();
    }
  }

  return (
    <div
      ref={popupRef}
      popover="manual"
      role="menu"
      onKeyDown={onKeyDown}
      className="fixed inset-auto m-0 flex min-w-52 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-menu border border-ui-border bg-ui-surface p-1.5 text-ui-text shadow-modal"
    >
      {sub && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSub(null)}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-input text-ui-muted hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:outline-none pointer-coarse:min-h-11"
          >
            <ArrowLeft aria-hidden="true" size={16} />
            {sub.label}
          </button>
          <hr className="my-1 border-ui-border" />
        </>
      )}
      <MenuRows items={sub?.items ?? items} onClose={onClose} onOpenSub={setSub} />
    </div>
  );
}

/** Props for Menu. */
export interface MenuProps {
  /** What the button shows. */
  label: ReactNode;
  /** The button's accessible name, when `label` is only an icon. */
  ariaLabel?: string;
  /** The button's style (default 'secondary'). */
  variant?: ButtonVariant;
  /** The button's size (default 'sm'). */
  size?: ButtonSize;
  /** Extra classes for the button. */
  buttonClassName?: string;
  /** The rows. */
  items: readonly MenuEntry[];
  /** Where the list opens against the button (default 'bottom-end'). */
  placement?: PopupPlacement;
}

/**
 * A dropdown menu.
 *
 * @param props See MenuProps.
 * @returns The button and, while open, the list.
 * Rendered by: SessionMenu.tsx, Sidebar.tsx
 */
export function Menu({
  label,
  ariaLabel,
  variant = 'secondary',
  size = 'sm',
  buttonClassName = '',
  items,
  placement = 'bottom-end',
}: MenuProps) {
  const { open, setOpen, anchorRef, popupRef } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>({
    placement,
  });
  return (
    <div className="inline-block">
      <div ref={anchorRef}>
        <Button
          variant={variant}
          size={size}
          className={buttonClassName}
          aria-haspopup="menu"
          aria-expanded={open}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          onClick={() => setOpen(!open)}
        >
          {label}
        </Button>
      </div>
      {open && (
        <MenuPopup
          items={items}
          popupRef={popupRef}
          onClose={() => setOpen(false)}
          onEscape={() => {
            setOpen(false);
            anchorRef.current?.querySelector('button')?.focus();
          }}
        />
      )}
    </div>
  );
}
