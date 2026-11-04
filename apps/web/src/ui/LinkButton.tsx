/**
 * File: apps/web/src/ui/LinkButton.tsx
 * Purpose: A link that looks exactly like a Button (UI theme stage U2), for navigation that
 *          reads as an action: Create session, Review, Edit, Dashboard.
 * Used by: src/features/dashboard (Dashboard, SessionCard), src/features/review/SessionReview.tsx
 * Depends on: next/link, src/ui/Button.tsx (buttonClasses)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §5 (buttons; tokens from src/ui/tokens/theme.css)
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button';

/** Props for LinkButton. */
export interface LinkButtonProps {
  /** Where it goes (an app route). */
  href: string;
  /** The label. */
  children: ReactNode;
  /** Visual style (default 'secondary': one primary action per view). */
  variant?: ButtonVariant;
  /** Size (default 'md'). */
  size?: ButtonSize;
  /** Extra classes, appended. */
  className?: string;
}

/**
 * A button-looking link.
 *
 * @param props See LinkButtonProps.
 * @returns A Next.js Link.
 * Rendered by: dashboard and review pages
 */
export function LinkButton({
  href,
  children,
  variant = 'secondary',
  size = 'md',
  className = '',
}: LinkButtonProps) {
  return (
    <Link href={href} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
