/**
 * File: apps/web/src/ui/AuthCard.tsx
 * Purpose: Centered card with the Kite name, a title and a subtitle, used by the signed-out
 *          screens (sign in, change password).
 * Used by: app/login/page.tsx, app/change-password/page.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in, Change password)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css; square corners)
 */
import type { ReactNode } from 'react';

/** Props for AuthCard. */
export interface AuthCardProps {
  /** Heading inside the card, for example "Sign in to Kite". */
  title: string;
  /** One line under the heading explaining what to do. */
  subtitle: string;
  /** The form (and anything else) inside the card. */
  children: ReactNode;
  /** Optional content under the card, for example a sign-out button. */
  footer?: ReactNode;
}

/**
 * A full-height page with one centered card.
 *
 * @param props See AuthCardProps.
 * @returns The page content.
 * Rendered by: app/login/page.tsx, app/change-password/page.tsx
 */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <div className="w-full max-w-sm border border-ui-border bg-ui-surface p-8">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center bg-ui-nav text-sm font-bold text-ui-accent"
          >
            K
          </span>
          <span className="text-lg font-bold text-ui-heading">Kite</span>
        </div>
        <h1 className="text-[28px] font-bold text-ui-heading">{title}</h1>
        <p className="mt-1 mb-6 text-[15px] text-ui-muted">{subtitle}</p>
        {children}
      </div>
      {footer}
    </main>
  );
}
