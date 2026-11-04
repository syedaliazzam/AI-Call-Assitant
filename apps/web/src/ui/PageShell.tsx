/**
 * File: apps/web/src/ui/PageShell.tsx
 * Purpose: The layout of a page's content under the app header (spec S1, which shows the page's name).
 *          The page's <h1> stays here for screen readers, and shows only where the title changes with
 *          the page's content (a session's name in Review).
 * Used by: src/features/settings/Settings.tsx, app/(app)/admin/users/page.tsx,
 *          src/features/review/SessionReview.tsx and the other signed-in pages
 * Depends on: React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1, §3 (S1, S17)
 * Theme: tokens from src/ui/tokens/theme.css
 */
import type { ReactNode } from 'react';

/** Props for PageShell. */
export interface PageShellProps {
  /** The page's title. */
  title: string;
  /** True to show the title on the page, because it is not the name in the header. */
  showTitle?: boolean;
  /** One line at the top of the content, or none. */
  description?: ReactNode;
  /** Buttons at the right of the top line (they wrap on narrow screens). */
  actions?: ReactNode;
  /** Content width: 'md' (48 rem, forms) or 'lg' (64 rem, tables and reviews). Default 'md'. */
  width?: 'md' | 'lg';
  /** The page content. */
  children: ReactNode;
}

/** Content width classes. */
const WIDTH: Record<NonNullable<PageShellProps['width']>, string> = {
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
};

/**
 * A page's content.
 *
 * @param props See PageShellProps.
 * @returns The top line, if any, and the content.
 * Rendered by: Settings, Users, the session review
 */
export function PageShell({
  title,
  showTitle = false,
  description,
  actions,
  width = 'md',
  children,
}: PageShellProps) {
  const hasTopLine = showTitle || description || actions;
  return (
    <div className="px-4 py-6 sm:px-6">
      <div className={`mx-auto flex flex-col gap-6 ${WIDTH[width]}`}>
        {!showTitle && <h1 className="sr-only">{title}</h1>}
        {hasTopLine && (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              {showTitle && (
                <h1 className="break-words text-card-title text-ui-heading">{title}</h1>
              )}
              {description && (
                <div className="max-w-prose text-page-subtitle text-ui-muted">{description}</div>
              )}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
