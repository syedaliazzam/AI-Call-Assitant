/**
 * File: apps/web/src/ui/AuthCard.tsx
 * Purpose: The sign-in and change-password layout. ADR-0071: a light left panel (the session cards'
 *          inner grey with their faint dot grid and a soft white glow) with the logo, the page's hero
 *          (passed in) and a privacy line; on the right, the form card. Below 900 px the left panel is
 *          hidden and the logo sits above the card. Both halves follow the light or dark theme.
 * Used by: app/login/page.tsx, app/change-password/page.tsx
 * Depends on: React, ./BrandLockup.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Sign in, Change password); ADR-0071
 * Theme: tokens from src/ui/tokens/theme.css (.k-auth-hero)
 */
import type { ReactNode } from 'react';
import { BrandLockup } from './BrandLockup';

/** The privacy line at the bottom of the left panel (ADR-0071: sessions sync to the account). */
export const AUTH_PRIVACY_LINE = 'Sessions sync to your account · Audio never leaves your computer';

/** Props for AuthCard. */
export interface AuthCardProps {
  /** Heading inside the card, for example "Sign in to Paramount AI". */
  title: string;
  /** One line under the heading explaining what to do. */
  subtitle: string;
  /** The form (and anything else) inside the card. */
  children: ReactNode;
  /** Optional content under the card, for example a sign-out button or the desktop app link. */
  footer?: ReactNode;
  /** The middle of the left panel (src/features/auth/SignInHero.tsx); the panel's logo and line stay. */
  hero?: ReactNode;
}

/**
 * A full-height page: the left panel and the centred form card.
 *
 * @param props See AuthCardProps.
 * @returns The page content.
 * Rendered by: app/login/page.tsx, app/change-password/page.tsx
 */
export function AuthCard({ title, subtitle, children, footer, hero }: AuthCardProps) {
  return (
    <main className="grid min-h-screen bg-ui-bg text-ui-text min-[900px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        aria-label="About Paramount AI"
        className="k-auth-hero hidden min-h-screen flex-col gap-10 border-r border-ui-border px-10 py-10 min-[900px]:flex xl:px-16 xl:py-12"
      >
        <BrandLockup tone="auto" size="lg" />
        <div className="flex flex-1 flex-col justify-center">{hero}</div>
        <p className="text-[13px] text-ui-muted">{AUTH_PRIVACY_LINE}</p>
      </section>
      <div className="flex flex-col items-center justify-center gap-5 px-4 py-10">
        {/* Below 900 px the left panel is hidden, so the logo comes here. */}
        <div className="mb-1 min-[900px]:hidden">
          <BrandLockup tone="auto" size="lg" />
        </div>
        <div className="w-full max-w-[420px] rounded-card border border-ui-border bg-ui-surface p-8 shadow-modal max-[420px]:p-6">
          <h1 className="text-[24px] font-medium leading-tight text-ui-heading">{title}</h1>
          <p className="mt-1.5 mb-6 text-[15px] text-ui-muted">{subtitle}</p>
          {children}
        </div>
        {footer}
      </div>
    </main>
  );
}
