/**
 * File: apps/web/src/ui/ErrorScreen.tsx
 * Purpose: The one look of a screen that cannot show what was asked for (spec S17): a short title, a
 *          plain sentence, and the way out. Follows the app's theme. It never shows an error's own
 *          message, which could hold details the person should not need.
 * Used by: app/not-found.tsx, app/error.tsx, src/features/live/LiveSession.tsx,
 *          src/features/live/LiveCallsUnsupported.tsx
 * Depends on: src/ui (BrandLockup, Button, LinkButton)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S17)
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import type { ReactNode } from 'react';
import { BrandLockup } from './BrandLockup';

/** Props for ErrorScreen. */
export interface ErrorScreenProps {
  /** What went wrong, in a few words. */
  title: string;
  /** What it means for the person, and what they can do. */
  children: ReactNode;
  /** The way out: a button or a link. */
  action?: ReactNode;
}

/**
 * The screen.
 *
 * @param props See ErrorScreenProps.
 * @returns A full-height page with one message.
 * Rendered by: app/not-found.tsx, app/error.tsx, LiveSession.tsx, LiveCallsUnsupported.tsx
 */
export function ErrorScreen({ title, children, action }: ErrorScreenProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ui-bg px-6 py-12 text-ui-text">
      <BrandLockup tone="auto" />
      <section className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <h1 className="text-modal-title text-ui-heading">{title}</h1>
        <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-ui-muted">
          {children}
        </div>
        {action && <div className="mt-3">{action}</div>}
      </section>
    </main>
  );
}
