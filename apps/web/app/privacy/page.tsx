/**
 * File: apps/web/app/privacy/page.tsx
 * Purpose: The /privacy route: the public privacy policy (no sign-in; proxy.ts lets it through), linked
 *          from Google's OAuth consent screen and the sign-in page.
 * Used by: Next.js App Router
 * Depends on: src/features/legal/PrivacyPolicy.tsx, src/ui/brand.ts
 * Architecture: ADR-0072
 */
import type { Metadata } from 'next';
import { PrivacyPolicy } from '@/features/legal/PrivacyPolicy';
import { BRAND_NAME } from '@/ui/brand';

/** The browser tab's title. */
export const metadata: Metadata = { title: `Privacy policy · ${BRAND_NAME}` };

/**
 * The privacy policy page.
 *
 * @returns The page.
 */
export default function PrivacyRoute() {
  return <PrivacyPolicy />;
}
