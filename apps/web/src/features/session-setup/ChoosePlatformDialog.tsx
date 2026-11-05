/**
 * File: apps/web/src/features/session-setup/ChoosePlatformDialog.tsx
 * Purpose: The "Choose platform" window (spec S8), shown when a session is started in the browser:
 *          Desktop app, Open in browser, and a small "What's the difference?". On a phone the desktop
 *          app is not offered. The desktop app never shows this window
 *          (Platform.offersPlatformChoice is false there).
 * Used by: src/features/dashboard/Dashboard.tsx
 * Depends on: lucide-react, src/ui (Button, Modal)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S8);
 *               docs/architecture/kite-architecture-v3.1.md §4, §5
 */
'use client';

import { Globe, Laptop } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';

/** Props for ChoosePlatformDialog. */
export interface ChoosePlatformDialogProps {
  /** True to show the dialog. */
  open: boolean;
  /** Called when the dialog is closed without a choice. */
  onClose: () => void;
  /** Called when the user chooses "Desktop app". */
  onOpenInDesktop: () => void;
  /** Called when the user chooses "Open in browser". */
  onOpenInBrowser: () => void;
}

/** The icons on the two choices. */
const ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * The Choose platform window.
 *
 * @param props See ChoosePlatformDialogProps.
 * @returns The modal.
 * Rendered by: Dashboard.tsx (when a session is started in the browser)
 */
export function ChoosePlatformDialog({
  open,
  onClose,
  onOpenInDesktop,
  onOpenInBrowser,
}: ChoosePlatformDialogProps) {
  const [showDifferences, setShowDifferences] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose platform"
      subtitle="Where do you want to run this call?"
      width={440}
      centerTitle
    >
      <div className="flex flex-col gap-3">
        {/* On a phone the desktop app is not an option: the same place, disabled, says why. */}
        <Button size="lg" className="w-full max-sm:hidden" onClick={onOpenInDesktop}>
          <Laptop {...ICON} />
          Desktop app
        </Button>
        <Button size="lg" disabled className="w-full sm:hidden">
          <Laptop {...ICON} />
          Needs a computer
        </Button>
        <Button variant="secondary" size="lg" className="w-full" onClick={onOpenInBrowser}>
          <Globe {...ICON} />
          Open in browser
        </Button>
        <button
          type="button"
          aria-expanded={showDifferences}
          onClick={() => setShowDifferences((shown) => !shown)}
          className="self-center rounded-control px-2 py-1 text-[15px] font-medium text-ui-heading hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
        >
          What’s the difference?
        </button>
        {showDifferences && (
          <dl className="flex flex-col gap-2 rounded-control bg-ui-panel px-3 py-2.5 text-helper">
            <div>
              <dt className="font-medium text-ui-heading">Desktop</dt>
              <dd className="text-ui-text">
                Hidden from screen share, global hotkeys, captures any app’s audio.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-ui-heading">Browser</dt>
              <dd className="text-ui-text">No install, needs a shared tab.</dd>
            </div>
          </dl>
        )}
      </div>
    </Modal>
  );
}
