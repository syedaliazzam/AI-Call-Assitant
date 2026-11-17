/**
 * File: apps/web/src/features/legal/LegalPage.tsx
 * Purpose: The layout of the public /privacy and /terms pages (Google's OAuth consent screen links to
 *          them): the logo, the title, the "Last updated" date, the text in one card, and the links to
 *          the other page and back to the app. Open to signed-out visitors (proxy.ts PUBLIC_PAGE_PATHS).
 *          Also the shared contact address and date, and the links shown under the sign-in card.
 * Used by: src/features/legal/PrivacyPolicy.tsx, src/features/legal/TermsOfUse.tsx, app/login/page.tsx
 * Depends on: next/link, src/ui/BrandLockup.tsx
 * Architecture: ADR-0072 (Google Drive; the consent screen needs these pages); spec §2 (theme tokens)
 * Theme: tokens from src/ui/tokens/theme.css
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '@/ui/BrandLockup';

/** The address both pages give for questions about privacy and these terms. */
export const LEGAL_CONTACT_EMAIL = 'paramountintelligence.central@gmail.com';

/** When the two pages last changed (shown as "Last updated"). Change it with the text. */
export const LEGAL_LAST_UPDATED = '17 November 2026';

/** The link style used on these pages and under the sign-in card (as DesktopAppLink). */
const LINK =
  'rounded-control text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * The contact address as a mail link.
 *
 * @returns The link.
 * Rendered by: PrivacyPolicy.tsx, TermsOfUse.tsx
 */
export function ContactLink() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={LINK}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}

/**
 * "Privacy · Terms" links, for the sign-in page footer and these pages.
 *
 * @returns The links.
 * Rendered by: app/login/page.tsx (AuthCard's footer), LegalPage
 */
export function LegalLinks() {
  return (
    <nav aria-label="Legal" className="flex items-center gap-3 text-[13px] text-ui-muted">
      <Link href="/privacy" className={LINK}>
        Privacy policy
      </Link>
      <span aria-hidden="true">·</span>
      <Link href="/terms" className={LINK}>
        Terms of use
      </Link>
    </nav>
  );
}

/** Props for LegalSection. */
export interface LegalSectionProps {
  /** The section's heading. */
  title: string;
  /** Its paragraphs or list. */
  children: ReactNode;
}

/**
 * One headed section of a legal page.
 *
 * @param props See LegalSectionProps.
 * @returns The section.
 * Rendered by: PrivacyPolicy.tsx, TermsOfUse.tsx
 */
export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="mt-6 first:mt-0">
      <h2 className="text-[17px] font-medium text-ui-heading">{title}</h2>
      <div className="mt-2 flex flex-col gap-2 text-[15px] leading-6 text-ui-text [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

/** Props for LegalPage. */
export interface LegalPageProps {
  /** The page's heading, for example "Privacy policy". */
  title: string;
  /** The sections. */
  children: ReactNode;
}

/**
 * A full public page: logo, title, date, the text in a card, and the links.
 *
 * @param props See LegalPageProps.
 * @returns The page content.
 * Rendered by: PrivacyPolicy.tsx, TermsOfUse.tsx
 */
export function LegalPage({ title, children }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-ui-bg px-4 py-10 text-ui-text">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
        <BrandLockup tone="auto" size="lg" />
        <article className="rounded-card border border-ui-border bg-ui-surface p-8 shadow-modal max-[420px]:p-6">
          <h1 className="text-[24px] font-medium leading-tight text-ui-heading">{title}</h1>
          <p className="mt-1.5 mb-6 text-[14px] text-ui-muted">Last updated {LEGAL_LAST_UPDATED}</p>
          {children}
        </article>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LegalLinks />
          {/* "/" opens the dashboard when signed in; signed out, the proxy sends it to sign-in. */}
          <Link href="/" className={`${LINK} text-[13px]`}>
            Back to Paramount AI
          </Link>
        </div>
      </div>
    </main>
  );
}
