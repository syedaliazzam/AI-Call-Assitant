/**
 * File: apps/web/src/ui/brand.ts
 * Purpose: The product's name and logo, each in one place. To change the logo, overwrite the file at
 *          images/green-logo.png and run scripts/make-brand.ts (it writes BRAND_LOGO_SRC): no code changes. A different file
 *          name needs only this constant changed. The favicons and the desktop icons are separate
 *          files (scripts/make-brand.ts and apps/desktop/build/).
 * Used by: src/ui/BrandLockup.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2 (rename, display strings only)
 */

/** The product's name wherever a person reads it (identifiers keep "kite": spec §2). */
export const BRAND_NAME = 'Paramount AI';

/**
 * The logo: the one image every lockup shows. Served from apps/web/public. v1.3.2 (ADR-0060): the
 * green logo, which already contains the words "Paramount AI" (made from images/green-logo.png by
 * scripts/make-brand.ts, its white margins trimmed). Before: the "P" mark (images/logo-mark.png).
 */
export const BRAND_LOGO_SRC = '/images/green-logo-lockup.png';

/**
 * True when the logo image already shows the product's name, so the lockup does not print the name
 * beside it a second time (it stays in the page for screen readers). False for a mark-only logo.
 */
export const BRAND_LOGO_HAS_NAME = true;
