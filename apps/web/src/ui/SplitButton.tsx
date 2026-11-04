/**
 * File: apps/web/src/ui/SplitButton.tsx
 * Purpose: One button in two parts, divided by a 1 px line: the main action, and a ▾ part that opens a
 *          menu of its variations (spec S1: "Create session"). Accent by default.
 * Used by: src/ui/AppHeader.tsx (Phase 2), the empty sessions list
 * Depends on: React, lucide-react, ./Button.tsx, ./Menu.tsx, ./useAnchoredPopup.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S1)
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonClasses, type ButtonVariant } from './Button';
import { MenuPopup, type MenuEntry } from './Menu';
import { useAnchoredPopup } from './useAnchoredPopup';

/** Props for SplitButton. */
export interface SplitButtonProps {
  /** The main part's words. */
  children: ReactNode;
  /** What the main part does. */
  onClick: () => void;
  /** The rows of the ▾ part's menu. */
  items: readonly MenuEntry[];
  /** The ▾ part's accessible name. */
  menuLabel: string;
  /** The look (default 'accent'). */
  variant?: ButtonVariant;
}

/**
 * The split button.
 *
 * @param props See SplitButtonProps.
 * @returns The two parts and, while open, the menu.
 * Rendered by: the app header and the empty sessions list
 */
export function SplitButton({
  children,
  onClick,
  items,
  menuLabel,
  variant = 'accent',
}: SplitButtonProps) {
  const { open, setOpen, anchorRef, popupRef } = useAnchoredPopup<HTMLDivElement, HTMLDivElement>({
    placement: 'bottom-end',
  });
  return (
    <div ref={anchorRef} className="inline-flex">
      <button
        type="button"
        onClick={onClick}
        className={buttonClasses(variant, 'md', 'rounded-r-none')}
      >
        {children}
      </button>
      <button
        type="button"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={buttonClasses(
          variant,
          'md',
          'rounded-l-none border-l border-ui-on-accent/30 px-2.5',
        )}
      >
        <ChevronDown
          aria-hidden="true"
          size={18}
          className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <MenuPopup
          items={items}
          popupRef={popupRef}
          onClose={() => setOpen(false)}
          onEscape={() => {
            setOpen(false);
            anchorRef.current?.querySelectorAll('button')[1]?.focus();
          }}
        />
      )}
    </div>
  );
}
