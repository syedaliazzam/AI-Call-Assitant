/**
 * File: apps/web/src/ui/BrandLockup.tsx
 * Purpose: Kite's product lockup (UI theme stage U4): the company logo mark, "Kite" in
 *          Inter 600 and, optionally, a small "by Paramount Intelligence". The mark is
 *          shown as the company draws it (apps/web/public/brand/logo-mark.png). It has no light
 *          version, so on dark surfaces it sits on a small white tile (the decision is flagged
 *          for the developer; the company site only shows it on white).
 * Used by: src/ui/Sidebar.tsx, src/ui/AuthCard.tsx, src/features/live/LiveCallLayout.tsx,
 *          src/features/dev/UiGallery.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §7 (brand assets); tokens from src/ui/theme.css
 */

/** The lockup's sizes: the mark's height and the name's size. */
const SIZES = {
  /** Compact window header. */
  xs: { mark: 'h-4', tile: 'p-0.5', name: 'text-[13px]', gap: 'gap-1.5' },
  /** Live view top bar, and the sidebar (where the full byline must fit 240 px). */
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
  /** Show "by Paramount Intelligence" under the name (default true). */
  byline?: boolean;
  /** The product name (default "Kite"; the compact window says "Kite · live"). */
  name?: string;
}

/**
 * The lockup.
 *
 * @param props See BrandLockupProps.
 * @returns The mark and the name.
 * Rendered by: the sidebar, sign-in, the live view, the UI gallery
 */
export function BrandLockup({ tone, size = 'md', byline = true, name = 'Kite' }: BrandLockupProps) {
  const s = SIZES[size];
  // The mark keeps its proportions (216 × 304): only its height is set.
  // eslint-disable-next-line @next/next/no-img-element
  const mark = <img src="/brand/logo-mark.png" alt="" className={`${s.mark} w-auto`} />;
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
        <span className={`font-semibold leading-none text-ui-heading ${s.name}`}>{name}</span>
        {byline && (
          <span className="mt-1 truncate text-[13px] leading-none text-ui-muted">
            by Paramount Intelligence
          </span>
        )}
      </span>
    </span>
  );
}
