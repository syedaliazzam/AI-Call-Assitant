/**
 * File: apps/web/src/features/session-setup/ChoosePlatformDialog.tsx
 * Purpose: The "Choose platform" dialog shown when a session is opened in the browser: "Desktop
 *          app" or "Open in browser", plus "What's the difference?" (architecture §4). In the
 *          browser, "Desktop app" explains that the installer arrives on Day 6. The desktop app
 *          never shows this dialog (Platform.offersPlatformChoice is false there).
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: src/ui/Dialog.tsx, src/ui/Button.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F4), §4 (desktop vs browser),
 *               §5 (Choose platform); day-03-sessions.md Stage 3
 */
'use client';

import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

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
          <div className="flex flex-col gap-2 border border-ui-border p-4">
            <h3 className="font-semibold text-ui-heading">Desktop app</h3>
            <p className="text-ui-muted">
              Hears calls from any meeting app and works with global hotkeys.
            </p>
            <p className="text-xs text-ui-muted">
              The desktop installer arrives on Day 6. Until then, developers run it from source
              (README: “Run the desktop app”).
            </p>
            <Button variant="secondary" disabled className="mt-auto">
              Download (Day 6)
            </Button>
          </div>
          <div className="flex flex-col gap-2 border border-ui-accent p-4">
            <h3 className="font-semibold text-ui-heading">Open in browser</h3>
            <p className="text-ui-muted">
              For calls in a Chrome or Edge tab. You share the meeting tab with its audio.
            </p>
            <Button onClick={onOpenInBrowser} className="mt-auto">
              Open in browser
            </Button>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={showDifferences}
          onClick={() => setShowDifferences((shown) => !shown)}
          className="inline-flex items-center self-start text-sm font-semibold text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        >
          What’s the difference?
        </button>
        {showDifferences && (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-ui-border text-ui-muted">
                <th className="py-2 pr-4 font-semibold" scope="col">
                  <span className="sr-only">Topic</span>
                </th>
                <th className="py-2 pr-4 font-semibold" scope="col">
                  Desktop app
                </th>
                <th className="py-2 font-semibold" scope="col">
                  Browser
                </th>
              </tr>
            </thead>
            <tbody>
              {DIFFERENCES.map((row) => (
                <tr key={row.topic} className="border-b border-ui-border align-top">
                  <th scope="row" className="py-2 pr-4 font-semibold text-ui-text">
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
