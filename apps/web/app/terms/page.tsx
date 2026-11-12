/**
 * File: apps/web/app/terms/page.tsx
 * Purpose: The /terms route: the public terms of use (no sign-in; proxy.ts lets it through), linked
 *          from Google's OAuth consent screen and the sign-in page.
 * Used by: Next.js App Router
 * Depends on: src/features/legal/TermsOfUse.tsx, src/ui/brand.ts
 * Architecture: ADR-0072
 */
import type { Metadata } from 'next';
import { TermsOfUse } from '@/features/legal/TermsOfUse';
import { BRAND_NAME } from '@/ui/brand';

/** The browser tab's title. */
export const metadata: Metadata = { title: `Terms of use · ${BRAND_NAME}` };

/**
 * The terms of use page.
 *
 * @returns The page.
 */
export default function TermsRoute() {
  return <TermsOfUse />;
}
