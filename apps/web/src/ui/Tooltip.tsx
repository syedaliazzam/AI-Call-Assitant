/**
 * File: apps/web/src/ui/Tooltip.tsx
 * Purpose: A small explanation shown while its target has the pointer or the keyboard. Drawn in the
 *          page, not a title attribute: a browser's title tooltip is a separate window, which
 *          screen-share protection may not reach (ADR-0042).
 * Used by: "Soon" items (src/ui/Sidebar.tsx, Menu.tsx, PanelMenu.tsx), the call bars
 * Depends on: React, ./useAnchoredPopup.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §5; ADR-0042
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { useId, type ReactNode } from 'react';
import { useAnchoredPopup } from './useAnchoredPopup';

/** Props for Tooltip. */
export interface TooltipProps {
  /** The words shown. */
  content: string;
  /** The target. */
  children: ReactNode;
  /** Extra classes for the wrapper around the target. */
  className?: string;
}

/**
 * Wraps a target and explains it on hover and focus. A disabled button fires no pointer events, so the
 * wrapper listens instead.
 *
 * @param props See TooltipProps.
 * @returns The target and, while showing, the tooltip.
 * Rendered by: the sidebar's "Soon" items, menus and call bars
 */
export function Tooltip({ content, children, className = '' }: TooltipProps) {
  const tipId = useId();
  const { open, setOpen, anchorRef, popupRef } = useAnchoredPopup<HTMLSpanElement, HTMLDivElement>({
    placement: 'top-center',
    closeOnOutside: false,
  });
  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      aria-describedby={open ? tipId : undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div
          ref={popupRef}
          id={tipId}
          popover="manual"
          role="tooltip"
          className="pointer-events-none fixed inset-auto m-0 max-w-64 rounded-control border-0 bg-ui-primary px-2.5 py-1.5 text-[12px] font-medium text-ui-on-primary shadow-modal"
        >
          {content}
        </div>
      )}
    </span>
  );
}
