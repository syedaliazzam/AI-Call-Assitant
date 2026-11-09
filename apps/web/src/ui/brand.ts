/**
 * File: apps/web/src/ui/brand.ts
 * Purpose: The product's name and logo, each in one place. The logo comes from the developer's final
 *          logo, apps/web/public/images/final-logo.png (the parrot and the "Paramount AI" wordmark).
 *          scripts/make-brand.ts turns it into the files named here (trimmed, transparent, small) and
 *          into the favicons and the desktop icons. To change the logo, replace final-logo.png and run
 *          `pnpm --filter web make-brand`: no code changes.
 * Used by: src/ui/BrandLockup.tsx; tests/integration (shell.spec.ts, handoff.spec.ts)
 * Depends on: nothing
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2 (rename, display strings only)
 */

/** The product's name wherever a person reads it (identifiers keep "kite": spec §2). */
export const BRAND_NAME = 'Paramount AI';

/**
 * The logo: the whole lockup (parrot and wordmark), made from images/final-logo.png by make-brand
 * (a 160 px tall, about 80 KB copy of the 1.1 MB original, which pages show at 18–40 px).
 */
export const BRAND_LOGO_SRC = '/brand/logo-lockup.png';

/** The lockup's width ÷ height (make-brand keeps the source's proportions: 2021 × 520). */
export const BRAND_LOGO_RATIO = 2021 / 520;

/** The parrot alone, square and transparent (for small tiles; the favicons are made from it). */
export const BRAND_MARK_SRC = '/brand/logo-mark.png';
