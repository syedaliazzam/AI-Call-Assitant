/**
 * File: apps/web/src/ui/BrandLockup.tsx
 * Purpose: The product's lockup: the logo mark (src/ui/brand.ts), the name in Inter 600 and, optionally,
 *          a small "by Paramount Intelligence". The mark has no light version, so on dark surfaces it
 *          sits on a small white tile.
 * Used by: src/ui/Sidebar.tsx, src/ui/AuthCard.tsx, src/features/home/HomePanel.tsx,
 *          src/features/live/LiveCallLayout.tsx, src/features/dev/UiGallery.tsx
 * Depends on: React, ./brand.ts
 * Architecture: docs/design/paramount-ai-ui-spec.md §0 (logo), §2; docs/architecture/kite-architecture-v3.1.md §9.1
 * Theme: tokens from src/ui/tokens/theme.css
 */
import { BRAND_LOGO_SRC, BRAND_NAME } from './brand';

/** The lockup's sizes: the mark's height and the name's size. */
const SIZES = {
  /** Compact window header. */
  xs: { mark: 'h-4', tile: 'p-0.5', name: 'text-[13px]', gap: 'gap-1.5' },
  /** Live view top bar, and the sidebar. */
  sm: { mark: 'h-6', tile: 'p-1', name: 'text-[15px]', gap: 'gap-2' },
  /** The UI gallery (and any larger header). */
  md: { mark: 'h-7', tile: 'p-1', name: 'text-[18px]', gap: 'gap-2.5' },
  /** Sign-in hero. */
  lg: { mark: 'h-9', tile: 'p-1.5', name: 'text-[18px]', gap: 'gap-3' },
} as const;

/** Props for BrandLockup. */
export interface BrandLockupProps {
  /** 'light' (the mark as is) or 'dark' (the mark on a white tile). */
  tone: 'light' | 'dark';
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
  // The mark keeps its proportions: only its height is set.
  // eslint-disable-next-line @next/next/no-img-element
  const mark = <img src={BRAND_LOGO_SRC} alt="" className={`${s.mark} w-auto`} />;
  return (
    <span className={`flex min-w-0 items-center ${s.gap}`}>
      {tone === 'dark' ? (
        <span
          aria-hidden="true"
          className={`flex shrink-0 rounded-control bg-ui-logo-tile ${s.tile}`}
        >
          {mark}
        </span>
      ) : (
        <span aria-hidden="true" className="flex shrink-0">
          {mark}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
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
