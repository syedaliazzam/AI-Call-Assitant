/**
 * File: apps/web/src/ui/BrandLockup.tsx
 * Purpose: The product's lockup: the logo (src/ui/brand.ts), the name in Inter 600 and, optionally,
 *          a small "by Paramount Intelligence". The logo has no dark version, so on dark surfaces it
 *          sits on a small white tile. v1.3.2 (ADR-0060): the green logo already shows the name, so
 *          the name is kept for screen readers only (BRAND_LOGO_HAS_NAME).
 * Used by: src/ui/Sidebar.tsx, src/ui/AuthCard.tsx, src/features/home/HomePanel.tsx,
 *          src/features/live/LiveCallLayout.tsx, src/features/dev/UiGallery.tsx
 * Depends on: React, ./brand.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { BRAND_LOGO_HAS_NAME, BRAND_LOGO_SRC, BRAND_NAME } from './brand';

/** The lockup's sizes for a mark-only logo: the mark's height and the name's size. */
const SIZES = {
  /** Compact window header. */
  xs: { mark: 'h-4', tile: 'p-0.5', auto: 'theme-dark:p-0.5', name: 'text-[13px]', gap: 'gap-1.5' },
  /** Live view top bar, and the sidebar. */
  sm: { mark: 'h-6', tile: 'p-1', auto: 'theme-dark:p-1', name: 'text-[15px]', gap: 'gap-2' },
  /** The UI gallery (and any larger header). */
  md: { mark: 'h-7', tile: 'p-1', auto: 'theme-dark:p-1', name: 'text-[18px]', gap: 'gap-2.5' },
  /** Sign-in hero. */
  lg: { mark: 'h-9', tile: 'p-1.5', auto: 'theme-dark:p-1.5', name: 'text-[18px]', gap: 'gap-3' },
} as const;

/**
 * v1.3.2 (ADR-0060): the heights of a logo that contains the name (the green logo, about 3.8 : 1).
 * Taller than a mark, because its words must stay readable; the name is not printed beside it.
 */
const WORDMARK_HEIGHTS: Record<keyof typeof SIZES, string> = {
  xs: 'h-5',
  sm: 'h-8',
  md: 'h-9',
  lg: 'h-12',
};

/** Props for BrandLockup. */
export interface BrandLockupProps {
  /**
   * 'light' (the mark as is), 'dark' (the mark on a white tile), or 'auto' (follows the document's
   * theme, in CSS, so there is no flash while the page loads).
   */
  tone: 'light' | 'dark' | 'auto';
  /** Size (default 'md'). */
  size?: keyof typeof SIZES;
  /** Show "by Paramount Intelligence" under the name (default false). */
  byline?: boolean;
  /** The product name (default BRAND_NAME; the compact window adds "· live"). */
  name?: string;
}

/**
 * The lockup.
 *
 * @param props See BrandLockupProps.
 * @returns The mark and the name.
 * Rendered by: the sidebar, sign-in, the live view, the UI gallery
 */
export function BrandLockup({
  tone,
  size = 'md',
  byline = false,
  name = BRAND_NAME,
}: BrandLockupProps) {
  const s = SIZES[size];
  // The mark keeps its proportions: only its height is set. The green logo is on white with no
  // transparency: multiply blends that white into a light page (on the dark theme's white tile it
  // changes nothing).
  const height = BRAND_LOGO_HAS_NAME ? WORDMARK_HEIGHTS[size] : s.mark;
  const mark = (
    // A plain img: the logo is a small static file that needs no optimising, and multiply blending
    // applies to the img itself.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={BRAND_LOGO_SRC} alt="" className={`${height} w-auto mix-blend-multiply`} />
  );
  return (
    <span className={`flex min-w-0 items-center ${s.gap}`}>
      {tone === 'dark' && (
        <span
          aria-hidden="true"
          className={`flex shrink-0 rounded-control bg-ui-logo-tile ${s.tile}`}
        >
          {mark}
        </span>
      )}
      {tone === 'light' && (
        <span aria-hidden="true" className="flex shrink-0">
          {mark}
        </span>
      )}
      {tone === 'auto' && (
        <span
          aria-hidden="true"
          className={`flex shrink-0 rounded-control theme-dark:bg-ui-logo-tile ${s.auto}`}
        >
          {mark}
        </span>
      )}
      {/* The name: beside a mark-only logo; for screen readers only when the logo shows it. */}
      <span className={BRAND_LOGO_HAS_NAME ? 'sr-only' : 'flex min-w-0 flex-col'}>
        <span className={`truncate font-semibold leading-none text-ui-heading ${s.name}`}>
          {name}
        </span>
        {byline && (
          <span className="mt-1 truncate text-[13px] leading-none text-ui-muted">
            by Paramount Intelligence
          </span>
        )}
      </span>
    </span>
  );
}
