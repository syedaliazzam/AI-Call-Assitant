/**
 * File: apps/web/src/features/auth/DesktopAppLink.tsx
 * Purpose: "Get the desktop app" under the sign-in card (ADR-0071): downloads the latest Windows
 *          installer (/download/windows, in the same tab; ADR-0114). Hidden inside the desktop app
 *          itself, which is already installed. 1.8.0 (ADR-0109): on a Mac it opens the Mac install
 *          steps instead.
 * Used by: app/login/page.tsx
 * Depends on: lucide-react, src/features/session-setup/labels.ts (DESKTOP_DOWNLOAD_URL), src/platform,
 *             src/features/shell/MacInstall.tsx, src/ui/useIsMac.ts
 * Architecture: ADR-0071, ADR-0109, ADR-0114
 */
'use client';

import { Download } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { DESKTOP_DOWNLOAD_URL } from '@/features/session-setup/labels';
import { MacInstallDialog } from '@/features/shell/MacInstall';
import { getPlatform } from '@/platform';
import { useIsMac } from '@/ui/useIsMac';

/** The link's look (the same for the Windows link and the Mac button). */
const LINK_CLASSES =
  'inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-[14px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

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
  // ADR-0109: a Mac gets the Mac install steps instead of the Windows installer download.
  const mac = useIsMac();
  const [macSteps, setMacSteps] = useState(false);
  if (!show) return null;
  if (mac) {
    return (
      <>
        <button type="button" onClick={() => setMacSteps(true)} className={LINK_CLASSES}>
          <Download aria-hidden="true" size={16} strokeWidth={1.75} />
          Get the desktop app for Mac
        </button>
        <MacInstallDialog open={macSteps} onClose={() => setMacSteps(false)} />
      </>
    );
  }
  return (
    <a href={DESKTOP_DOWNLOAD_URL} className={LINK_CLASSES}>
      <Download aria-hidden="true" size={16} strokeWidth={1.75} />
      Get the desktop app
    </a>
  );
}
