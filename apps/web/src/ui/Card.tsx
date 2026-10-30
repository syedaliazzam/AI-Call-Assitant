/**
 * File: apps/web/src/ui/Card.tsx
 * Purpose: A flat, square content card (UI theme stage U1): surface background, 1 px border,
 *          24 px padding, no shadow, with an optional mono eyebrow and a section title.
 * Used by: src/features/dev/UiGallery.tsx (and the pages restyled in UI stage U2)
 * Depends on: React, src/ui/Eyebrow.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (Card; tokens from src/ui/theme.css; square corners)
 */
import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';

/** Props for Card. */
export interface CardProps {
  /** The section title (20 px, the subheading colour), or none. */
  title?: string;
  /** A small mono label above the title, for example "STEP 1 OF 2", or none. */
  eyebrow?: string;
  /** The card's content. */
  children: ReactNode;
  /** Extra classes, appended. */
  className?: string;
}

/**
 * A content card. It is a <section> named by its title when it has one.
 *
 * @param props See CardProps.
 * @returns The card.
 * Rendered by: the gallery and pages
 */
export function Card({ title, eyebrow, children, className = '' }: CardProps) {
  return (
    <section
      aria-label={title}
      className={`border border-ui-border bg-ui-surface p-6 text-ui-text ${className}`}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      {title && <h2 className="mb-3 text-[20px] font-normal text-ui-subheading">{title}</h2>}
      {children}
    </section>
  );
}
