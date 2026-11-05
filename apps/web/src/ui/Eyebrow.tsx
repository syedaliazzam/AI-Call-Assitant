/**
 * File: apps/web/src/ui/Eyebrow.tsx
 * Purpose: The small uppercase mono label (UI theme stage U1) used for eyebrows, "YOU" / "THEM",
 *          timestamps, latency ("ANSWER · 0.9 S"), keyboard shortcuts and status.
 * Used by: src/ui/Card.tsx, src/ui/Badge.tsx, src/features/dev/UiGallery.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §4 (Eyebrow / label; tokens from src/ui/tokens/theme.css)
 */
import type { ReactNode } from 'react';

/** Props for Eyebrow. */
export interface EyebrowProps {
  /** The label text (shown in capitals by CSS; screen readers read it as written). */
  children: ReactNode;
  /** Extra classes, appended (for example a colour such as text-ui-you). */
  className?: string;
}

/**
 * A small label: Inter, 13 px, medium weight, muted colour.
 *
 * @param props See EyebrowProps.
 * @returns A <span>, shown as a block above titles by the caller when needed.
 * Rendered by: Card, Badge and pages
 */
export function Eyebrow({ children, className = '' }: EyebrowProps) {
  return (
    <span className={`block text-[13px] font-medium text-ui-muted ${className}`}>{children}</span>
  );
}
