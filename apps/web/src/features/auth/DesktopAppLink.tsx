/**
 * File: apps/web/src/features/auth/DesktopAppLink.tsx
 * Purpose: "Get the desktop app" under the sign-in card (ADR-0071): a link to the latest Windows
 *          installer's release page. Hidden inside the desktop app itself, which is already installed.
 * Used by: app/login/page.tsx
 * Depends on: lucide-react, src/features/session-setup/labels.ts (DESKTOP_DOWNLOAD_URL), src/platform,
 *             src/ui/icons.tsx
 * Architecture: ADR-0071
 */
'use client';

import { Download } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { DESKTOP_DOWNLOAD_URL } from '@/features/session-setup/labels';
import { getPlatform } from '@/platform';
import { OutIcon } from '@/ui/icons';

/**
 * Nothing to subscribe to: the platform does not change while the page is open.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: DesktopAppLink
 */
const subscribeNever = () => () => undefined;

/**
 * Whether to offer the download: anywhere but the desktop app.
 *
 * @returns True in a browser.
 * Called from: DesktopAppLink
 */
const inBrowser = () => getPlatform().kind !== 'desktop';

/**
 * The link.
 *
 * @returns The link, or nothing in the desktop app (and in the server's HTML, so the desktop app never
 *          shows it for a moment while the page loads).
 * Rendered by: app/login/page.tsx (AuthCard's footer)
 */
export function DesktopAppLink() {
  const show = useSyncExternalStore(subscribeNever, inBrowser, () => false);
  if (!show) return null;
  return (
    <a
      href={DESKTOP_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-[14px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
    >
      <Download aria-hidden="true" size={16} strokeWidth={1.75} />
      Get the desktop app
      <OutIcon />
    </a>
  );
}
