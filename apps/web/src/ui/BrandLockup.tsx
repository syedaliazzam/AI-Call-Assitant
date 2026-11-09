/**
 * File: apps/web/src/ui/BrandLockup.tsx
 * Purpose: The product's lockup: the final logo (parrot and "Paramount AI", src/ui/brand.ts) as one
 *          image and, optionally, a small "by Paramount Intelligence" under it. The wordmark is dark and
 *          has no light version, so on dark surfaces the logo sits on a small white tile.
 * Used by: src/ui/Sidebar.tsx, src/ui/AuthCard.tsx, src/ui/ErrorScreen.tsx, src/features/home/HomePanel.tsx,
 *          src/features/home/DesktopFrame.tsx, src/features/live/LiveCallLayout.tsx,
 *          src/features/live/BrowserCallLayout.tsx, src/features/shell/AppHeader.tsx,
 *          src/features/dev/UiGallery.tsx
 * Depends on: React, ./brand.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { BRAND_LOGO_RATIO, BRAND_LOGO_SRC, BRAND_NAME } from './brand';

/** The lockup's sizes: the logo's height in CSS px, and the white tile's padding on dark surfaces. */
const SIZES = {
  /** Compact window header. */
  xs: { height: 18, tile: 'px-1 py-0.5', auto: 'theme-dark:px-1 theme-dark:py-0.5' },
  /** Live view top bar, and the sidebar. */
  sm: { height: 24, tile: 'px-1.5 py-1', auto: 'theme-dark:px-1.5 theme-dark:py-1' },
  /** The desktop app's window frame (reference: about as tall as its 40 px buttons), the UI gallery. */
  md: { height: 34, tile: 'px-1.5 py-1', auto: 'theme-dark:px-1.5 theme-dark:py-1' },
  /** Sign-in hero. */
  lg: { height: 40, tile: 'px-2 py-1.5', auto: 'theme-dark:px-2 theme-dark:py-1.5' },
} as const;

/** Props for BrandLockup. */
export interface BrandLockupProps {
  /**
   * 'light' (the logo as is), 'dark' (the logo on a white tile), or 'auto' (follows the document's
   * theme, in CSS, so there is no flash while the page loads).
   */
  tone: 'light' | 'dark' | 'auto';
  /** Size (default 'md'). */
  size?: keyof typeof SIZES;
  /** Show "by Paramount Intelligence" under the logo (default false). */
  byline?: boolean;
}

/**
 * The lockup.
 *
 * @param props See BrandLockupProps.
 * @returns The logo (its alt text is the product name), and the byline when asked.
 * Rendered by: the sidebar, sign-in, the desktop window frame, the live view, the UI gallery
 */
export function BrandLockup({ tone, size = 'md', byline = false }: BrandLockupProps) {
  const s = SIZES[size];
  // Width and height are given, so the layout does not move while the image loads.
  const logo = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_LOGO_SRC}
      alt={BRAND_NAME}
      width={Math.round(s.height * BRAND_LOGO_RATIO)}
      height={s.height}
      style={{ height: s.height, width: 'auto' }}
      draggable={false}
    />
  );
  const tile =
    tone === 'dark'
      ? `rounded-control bg-ui-logo-tile ${s.tile}`
      : tone === 'auto'
        ? `rounded-control theme-dark:bg-ui-logo-tile ${s.auto}`
        : '';
  return (
    <span className="flex min-w-0 flex-col">
      <span className={`flex shrink-0 self-start ${tile}`}>{logo}</span>
      {byline && (
        <span className="mt-1 truncate text-[13px] leading-none text-ui-muted">
          by Paramount Intelligence
        </span>
      )}
    </span>
  );
}
