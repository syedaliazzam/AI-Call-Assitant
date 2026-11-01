/**
 * File: apps/web/src/ui/Badge.tsx
 * Purpose: A status label (UI theme stage U1): mono uppercase text with a 6 px square dot, for
 *          example green "CONNECTED", amber "WARMING", red "ERROR".
 * Used by: src/features/dev/UiGallery.tsx (and the pages restyled in UI stages U2–U3)
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (Badge / status; tokens from src/ui/theme.css)
 */
import type { ReactNode } from 'react';

/** What a badge reports. */
export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral';

/** Props for Badge. */
export interface BadgeProps {
  /** The tone: the dot's colour and the text's colour. */
  tone: BadgeTone;
  /** The label, for example "Connected". */
  children: ReactNode;
}

/** The dot colour per tone (the brand green and amber; red is a Kite addition). */
const DOT_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-ui-dot-success',
  warning: 'bg-ui-dot-warning',
  danger: 'bg-ui-dot-danger',
  neutral: 'bg-ui-muted',
};

/** The text colour per tone (the readable text tokens, which differ on light and dark). */
const TEXT_CLASSES: Record<BadgeTone, string> = {
  success: 'text-ui-success',
  warning: 'text-ui-warning',
  danger: 'text-ui-danger',
  neutral: 'text-ui-muted',
};

/**
 * A status badge.
 *
 * @param props See BadgeProps.
 * @returns The badge.
 * Rendered by: the gallery and pages
 */
export function Badge({ tone, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] ${TEXT_CLASSES[tone]}`}
    >
      {/* Square, like every corner in the theme. */}
      <span aria-hidden="true" className={`size-1.5 ${DOT_CLASSES[tone]}`} />
      {children}
    </span>
  );
}
