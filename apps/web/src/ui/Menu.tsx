/**
 * File: apps/web/src/ui/Menu.tsx
 * Purpose: A small dropdown menu: a button that opens a list of actions. Arrow keys move through
 *          the actions, Escape closes it and returns to the button, and a click elsewhere closes
 *          it.
 * Used by: src/features/dashboard/Dashboard.tsx (Create session),
 *          src/features/dashboard/SessionCard.tsx (the ⋮ menu)
 * Depends on: React, src/ui/Button.tsx (its focus and touch sizes)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui)
 * Theme: docs/design/kite-ui-theme.md
 */
'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, type ButtonVariant } from './Button';

/** One action in a menu. */
export interface MenuItem {
  /** The words on it. */
  label: string;
  /** What it does. The menu closes first. */
  onSelect: () => void;
  /** True for an action that deletes something. */
  danger?: boolean;
}

/** Props for Menu. */
export interface MenuProps {
  /** What the button shows. */
  label: ReactNode;
  /** The button's accessible name, when `label` is only an icon. */
  ariaLabel?: string;
  /** The button's style (default 'secondary'). */
  variant?: ButtonVariant;
  /** The actions. */
  items: readonly MenuItem[];
}

/**
 * A dropdown menu.
 *
 * @param props See MenuProps.
 * @returns The button and, while open, the list.
 * Rendered by: Dashboard.tsx, SessionCard.tsx
 */
export function Menu({ label, ariaLabel, variant = 'secondary', items }: MenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  // Keyboard users land on the first action when the menu opens.
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  /**
   * Moves through the actions with the arrow keys; Escape and Tab close the menu.
   *
   * @param event The key press inside the list.
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const actions = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = actions.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      actions[(at + step + actions.length) % actions.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      button.current?.querySelector('button')?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative inline-block">
      <div ref={button}>
        <Button
          variant={variant}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          onClick={() => setOpen((current) => !current)}
        >
          {label}
        </Button>
      </div>
      {open && (
        <div
          ref={list}
          role="menu"
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-20 mt-1 flex min-w-44 flex-col border border-ui-border bg-ui-surface py-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={[
                'px-4 py-2 text-left text-[14px] hover:bg-ui-band focus-visible:bg-ui-band focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11',
                item.danger ? 'text-ui-danger' : 'text-ui-text',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
