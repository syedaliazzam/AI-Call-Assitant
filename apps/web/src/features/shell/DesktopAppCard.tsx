/**
 * File: apps/web/src/features/shell/DesktopAppCard.tsx
 * Purpose: The sidebar's desktop app card, in the browser (spec S2, and the developer's decision at
 *          Phase 0: a web page cannot tell whether the app is installed, so nothing is guessed). It
 *          always offers "Open desktop app", with a small download link under it, and can be hidden
 *          from its ⋮ menu.
 * Used by: src/features/shell/AppShell.tsx
 * Depends on: @kite/shared (the link), lucide-react, src/core/storage/sidebarPrefs.ts,
 *             src/features/session-setup/labels.ts, src/ui (Button, Menu)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S2), §6
 */
'use client';

import { DESKTOP_OPEN_LINK } from '@kite/shared';
import { EllipsisVertical, Monitor } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { getDesktopCardHidden, setDesktopCardHidden } from '@/core/storage/sidebarPrefs';
import { DESKTOP_DOWNLOAD_URL } from '@/features/session-setup/labels';
import { buttonClasses } from '@/ui/Button';
import { Menu } from '@/ui/Menu';

/**
 * Nothing to subscribe to: only this component changes the choice, and it holds that in state.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * The card, until it is hidden. Hidden during server render, so it never flashes for someone who hid it.
 *
 * @returns The card, or nothing.
 * Rendered by: AppShell.tsx (in the browser only)
 */
export function DesktopAppCard() {
  const savedHidden = useSyncExternalStore(subscribeNever, getDesktopCardHidden, () => true);
  const [hidden, setHidden] = useState(false);
  if (savedHidden || hidden) return null;
  return (
    // Not on a phone: the desktop app needs a computer.
    <section
      aria-label="Desktop app"
      className="flex flex-col gap-2 rounded-card border border-ui-border bg-ui-bg p-3 max-md:hidden"
    >
      <div className="flex items-center justify-between">
        <Monitor aria-hidden="true" size={20} strokeWidth={1.75} className="text-ui-muted" />
        <Menu
          label={<EllipsisVertical aria-hidden="true" size={16} />}
          ariaLabel="Desktop app card options"
          variant="plain"
          size="icon"
          items={[
            {
              label: 'Hide card',
              onSelect: () => {
                setHidden(true);
                setDesktopCardHidden();
              },
            },
          ]}
        />
      </div>
      <div>
        <p className="text-[15px] font-medium text-ui-heading">Paramount AI for Windows</p>
        <p className="text-helper text-ui-muted">Hidden from screen share, global hotkeys</p>
      </div>
      <a href={DESKTOP_OPEN_LINK} className={buttonClasses('primary', 'md', 'w-full')}>
        Open desktop app
      </a>
      <a
        href={DESKTOP_DOWNLOAD_URL}
        className="self-center rounded-control text-center text-[12px] text-ui-muted underline hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
      >
        Don’t have it? Download for Windows
      </a>
    </section>
  );
}
