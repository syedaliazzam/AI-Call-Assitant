/**
 * File: apps/web/src/ui/brand.ts
 * Purpose: The product's name and logo, each in one place. To change the logo, overwrite the file at
 *          BRAND_LOGO_SRC (apps/web/public/images/logo-mark.png): no code changes. A different file
 *          name needs only this constant changed. The favicons and the desktop icons are separate
 *          files (scripts/make-brand.ts and apps/desktop/build/).
 * Used by: src/ui/BrandLockup.tsx
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2 (rename, display strings only)
 */

/** The product's name wherever a person reads it (identifiers keep "kite": spec §2). */
export const BRAND_NAME = 'Paramount AI';

/** The logo mark: the one image every lockup shows. Served from apps/web/public. */
export const BRAND_LOGO_SRC = '/images/logo-mark.png';
