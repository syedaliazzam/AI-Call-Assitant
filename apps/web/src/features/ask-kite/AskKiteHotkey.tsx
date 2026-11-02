/**
 * File: apps/web/src/features/ask-kite/AskKiteHotkey.tsx
 * Purpose: Makes Ctrl+Alt+K (⌘⌥K on macOS) open the Ask Kite page from any signed-in page. During a
 *          call or a mock interview it leaves the page alone, because leaving would end them: a
 *          call opens its chat box instead (LiveAnswers.tsx).
 * Used by: app/(app)/layout.tsx
 * Depends on: next/navigation, src/platform
 * Architecture: docs/decisions/ADR-0030-ask-kite-and-adaptive-answers.md
 */
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getPlatform } from '@/platform';

/**
 * Whether the shortcut may leave a page.
 *
 * @param pathname The page's path.
 * @returns False on a live call and a mock interview.
 * Called from: AskKiteHotkey; tests
 */
export function mayLeaveFor(pathname: string): boolean {
  return !pathname.startsWith('/live') && !pathname.startsWith('/mock');
}

/**
 * Listens for the shortcut. Shows nothing.
 *
 * @returns Nothing.
 * Rendered by: app/(app)/layout.tsx
 */
export function AskKiteHotkey() {
  const router = useRouter();
  const pathname = usePathname();
  // A ref, so the listener is added once and always sees the current page.
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(
    () =>
      getPlatform().onAskKiteHotkey(() => {
        if (mayLeaveFor(path.current)) router.push('/ask-kite');
      }),
    [router],
  );
  return null;
}
