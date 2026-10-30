/**
 * File: apps/web/src/ui/PageShell.tsx
 * Purpose: The light page layout (UI theme stage U2): a white header band (mono eyebrow, page
 *          title, one line, actions) over a grey-band body that holds white cards, so long
 *          pages alternate white and band sections like the company site.
 * Used by: src/features/settings/Settings.tsx, app/(app)/admin/users/page.tsx,
 *          src/features/review/SessionReview.tsx
 * Depends on: React, src/ui/Eyebrow.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §9.1 (src/ui: shared UI pieces)
 * Theme: docs/design/kite-ui-theme.md §4 (type), §5 (Section band; tokens from src/ui/theme.css)
 */
import type { ReactNode } from 'react';
import { Eyebrow } from './Eyebrow';

/** Props for PageShell. */
export interface PageShellProps {
  /** The page title (28 px, bold). */
  title: string;
  /** The small mono label above the title, or none. */
  eyebrow?: string;
  /** One line under the title, or none. */
  description?: ReactNode;
  /** Buttons at the right of the header (they wrap below the title on narrow screens). */
  actions?: ReactNode;
  /** Content width: 'md' (48 rem, forms) or 'lg' (64 rem, tables and reviews). Default 'md'. */
  width?: 'md' | 'lg';
  /** The page content, on the grey band (usually white cards). */
  children: ReactNode;
}

/** Content width classes. */
const WIDTH: Record<NonNullable<PageShellProps['width']>, string> = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
};

/**
 * A light page.
 *
 * @param props See PageShellProps.
 * @returns The header band and the content band.
 * Rendered by: Settings, Users, the session review
 */
export function PageShell({
  title,
  eyebrow,
  description,
  actions,
  width = 'md',
  children,
}: PageShellProps) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-ui-border bg-ui-surface px-4 py-8 sm:px-8">
        <div className={`mx-auto flex flex-wrap items-end justify-between gap-4 ${WIDTH[width]}`}>
          <div className="min-w-0">
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <h1 className="break-words text-[28px] font-bold text-ui-heading">{title}</h1>
            {description && (
              <div className="mt-1 max-w-prose text-[15px] text-ui-muted">{description}</div>
            )}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      </header>
      <div className="flex-1 bg-ui-band px-4 py-8 sm:px-8">
        <div className={`mx-auto flex flex-col gap-6 ${WIDTH[width]}`}>{children}</div>
      </div>
    </div>
  );
}
