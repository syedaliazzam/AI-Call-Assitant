/**
 * File: apps/web/src/features/session-setup/ChoosePlatformDialog.tsx
 * Purpose: The "Choose platform" dialog shown when a session is opened in the browser: two large
 *          buttons, "Desktop app" (opens the installer's download page) and "Open in browser", plus
 *          "What's the difference?" (architecture §4). The desktop app never shows this dialog
 *          (Platform.offersPlatformChoice is false there).
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: src/ui (Dialog, icons), ./labels.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F4), §4 (desktop vs browser),
 *               §5 (Choose platform); docs/design/kite-ui-theme.md §6
 */
'use client';

import { useState } from 'react';
import { Dialog } from '@/ui/Dialog';
import { GlobeIcon, MonitorIcon } from '@/ui/icons';
import { DESKTOP_DOWNLOAD_URL } from './labels';

/** Props for ChoosePlatformDialog. */
export interface ChoosePlatformDialogProps {
  /** True to show the dialog. */
  open: boolean;
  /** Called when the dialog is closed without a choice. */
  onClose: () => void;
  /** Called when the user chooses "Open in browser". */
  onOpenInBrowser: () => void;
}

/** The "What's the difference?" rows (architecture §4, in plain words). */
const DIFFERENCES: readonly {
  /** What is compared. */
  topic: string;
  /** In the desktop app. */
  desktop: string;
  /** In the browser. */
  browser: string;
}[] = [
  {
    topic: 'Install',
    desktop: 'A one-time install (Windows, macOS)',
    browser: 'Nothing to install',
  },
  {
    topic: 'Meeting apps',
    desktop: 'Any: Zoom, Teams, Meet, Webex, phone apps',
    browser: 'Calls in a Chrome or Edge tab (Meet, Teams web, Zoom web)',
  },
  { topic: 'Hotkeys', desktop: 'Work from any app', browser: 'Only while Kite has focus' },
  { topic: 'Overlay', desktop: 'Always-on-top live window', browser: 'Picture-in-picture view' },
  {
    topic: 'Screen sharing',
    desktop: 'Kite can be hidden from a shared screen (Windows)',
    browser: 'Share one tab or window, or keep Kite on a second screen',
  },
];

/** The look shared by the two large choices (one a link, one a button). */
const CHOICE =
  'flex flex-col items-center gap-2 rounded-card border border-ui-border bg-ui-surface px-4 py-6 text-center text-[15px] font-medium text-ui-heading transition-colors duration-150 hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * The Choose platform dialog.
 *
 * @param props See ChoosePlatformDialogProps.
 * @returns The dialog.
 * Rendered by: Dashboard.tsx (when a session is opened in the browser)
 */
export function ChoosePlatformDialog({
  open,
  onClose,
  onOpenInBrowser,
}: ChoosePlatformDialogProps) {
  const [showDifferences, setShowDifferences] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="How do you want to join?" size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer" className={CHOICE}>
            <MonitorIcon size={24} />
            Desktop app
            <span className="text-[13px] font-normal text-ui-text">
              Any meeting app, global hotkeys. Opens the download page.
            </span>
          </a>
          <button type="button" onClick={onOpenInBrowser} className={CHOICE}>
            <GlobeIcon size={24} />
            Open in browser
            <span className="text-[13px] font-normal text-ui-text">
              Calls in a Chrome or Edge tab. You share the meeting tab with its audio.
            </span>
          </button>
        </div>

        <button
          type="button"
          aria-expanded={showDifferences}
          onClick={() => setShowDifferences((shown) => !shown)}
          className="inline-flex items-center self-start text-[13px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        >
          What’s the difference?
        </button>
        {showDifferences && (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-ui-border text-ui-muted">
                <th className="py-2 pr-4 font-medium" scope="col">
                  <span className="sr-only">Topic</span>
                </th>
                <th className="py-2 pr-4 font-medium" scope="col">
                  Desktop app
                </th>
                <th className="py-2 font-medium" scope="col">
                  Browser
                </th>
              </tr>
            </thead>
            <tbody>
              {DIFFERENCES.map((row) => (
                <tr key={row.topic} className="border-b border-ui-border align-top">
                  <th scope="row" className="py-2 pr-4 font-medium text-ui-text">
                    {row.topic}
                  </th>
                  <td className="py-2 pr-4 text-ui-muted">{row.desktop}</td>
                  <td className="py-2 text-ui-muted">{row.browser}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Dialog>
  );
}
