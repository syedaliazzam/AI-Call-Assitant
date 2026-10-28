/**
 * File: apps/web/src/ui/AuthCard.tsx
 * Purpose: Centered card with the Kite name, a title and a subtitle, used by the signed-out
 *          screens (sign in, change password).
 * Used by: app/login/page.tsx, app/change-password/page.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in, Change password)
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
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white"
          >
            K
          </span>
          <span className="text-lg font-semibold text-slate-900">Kite</span>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        <p className="mt-1 mb-6 text-sm text-slate-500">{subtitle}</p>
        {children}
      </div>
      {footer}
    </main>
  );
}
