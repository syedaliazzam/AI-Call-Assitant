/**
 * File: apps/web/src/ui/Chip.tsx
 * Purpose: A small pill label (spec §1: 12/500, 1 px border, 24 px tall, 14 px icon), and the muted
 *          "Soon" badge on features that are visible but not available yet (spec §5).
 * Used by: the session card, the sidebar and the menus
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §5
 * Theme: tokens from src/ui/tokens/theme.css
 */
import type { ReactNode } from 'react';

/** Props for Chip. */
export interface ChipProps {
  /** A 14 px icon before the words. */
  icon?: ReactNode;
  /** The words. */
  children: ReactNode;
  /** Extra classes, appended. */
  className?: string;
}

/**
 * A pill label.
 *
 * @param props See ChipProps.
 * @returns The chip.
 * Rendered by: the session card and SoonBadge
 */
export function Chip({ icon, children, className = '' }: ChipProps) {
  return (
    <span
      className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-ui-border bg-ui-bg px-2.5 text-chip text-ui-muted ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}

/** The words every "Soon" item shows when pointed at (spec §5). */
export const SOON_TOOLTIP = 'Coming soon';

/**
 * The "Soon" chip on a feature that is visible but disabled.
 *
 * @returns The chip.
 * Rendered by: the sidebar, Menu, PanelMenu and the modals' disabled rows
 */
export function SoonBadge() {
  return <Chip>Soon</Chip>;
}
