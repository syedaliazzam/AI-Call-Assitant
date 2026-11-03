/**
 * File: apps/web/src/ui/AuthCard.tsx
 * Purpose: The sign-in and change-password layout (UI theme stage U2): a dark hero panel in
 *          the company site's voice beside a white card holding the form.
 * Used by: app/login/page.tsx, app/change-password/page.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in, Change password)
 * Theme: docs/design/kite-ui-theme.md §5 (tokens from src/ui/theme.css)
 */
import type { ReactNode } from 'react';
import { BrandLockup } from './BrandLockup';

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
    // Sign-in layout (theme §6): a dark hero in the site's voice beside a white form card;
    // stacked on narrow screens, the hero first and shorter.
    <main className="grid min-h-screen bg-ui-band md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        aria-label="About Kite"
        className="k-dark flex flex-col justify-between gap-10 bg-ui-bg px-6 py-8 text-ui-text sm:px-10 md:py-12"
      >
        <BrandLockup tone="dark" size="lg" />
        <div className="max-w-md">
          <p className="text-[13px] text-ui-muted">Live call assistant</p>
          <p className="mt-3 text-[24px] font-semibold leading-tight text-ui-heading">
            Answers while you talk.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-ui-text">
            Kite listens to both sides of your call and writes a short answer you can say right
            away, from your own session details and documents.
          </p>
        </div>
        <p className="hidden text-[13px] text-ui-muted md:block">
          Sessions are saved on this computer · Audio never leaves it
        </p>
      </section>
      <div className="flex flex-col items-center justify-center gap-4 px-4 py-10">
        <div className="w-full max-w-sm border border-ui-border rounded-card bg-ui-surface shadow-card p-8">
          <h1 className="text-[24px] font-semibold text-ui-heading">{title}</h1>
          <p className="mt-1 mb-6 text-[15px] text-ui-muted">{subtitle}</p>
          {children}
        </div>
        {footer}
      </div>
    </main>
  );
}
