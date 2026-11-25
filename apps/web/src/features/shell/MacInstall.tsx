/**
 * File: apps/web/src/features/shell/MacInstall.tsx
 * Purpose: How to get Paramount AI on a Mac (ADR-0109 §4): the one-line Terminal installer with a Copy
 *          button and a link to read the script, what it checks, and the .dmg fallback with the one-time
 *          "Open Anyway" steps. Shown in a dialog from every download place ("Need it for macOS?", "Get it
 *          for Mac"). Inside the desktop app on a Mac (already installed) the link is not shown. ADR-0125: the
 *          command and the .dmg link show only once the Mac app is published (the mac-latest release has its
 *          latest-mac.yml); until then the dialog says "Mac version coming soon" and offers no install.
 * Used by: src/features/shell/DesktopAppCard.tsx, src/features/auth/DesktopAppLink.tsx,
 *          src/features/handoff/DesktopHandoffPage.tsx, src/features/live/ConnectPanel.tsx,
 *          src/features/home/LauncherConnect.tsx
 * Depends on: src/features/session-setup/labels.ts (the command and addresses), src/platform (isDesktop),
 *             src/ui (Button, Dialog, useIsMac, useMacRelease), browser Clipboard API
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md §4; ADR-0125
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import {
  MAC_INSTALL_COMMAND,
  MAC_INSTALL_SCRIPT_URL,
  MAC_RELEASE_PAGE_URL,
} from '@/features/session-setup/labels';
import { isDesktop } from '@/platform';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';
import { useIsMac } from '@/ui/useIsMac';
import { useMacRelease } from '@/ui/useMacRelease';

/** The dialog's title. */
export const MAC_INSTALL_TITLE = 'Get Paramount AI for Mac';

/** A link's look: small, muted, underlined (as the "Need it for macOS?" words were). */
const LINK_CLASSES =
  'rounded-control underline underline-offset-4 hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * Nothing to subscribe to: whether this is the desktop app does not change while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/** ADR-0125: what the dialog says while no Mac release is published. */
export const MAC_COMING_SOON = 'Mac version coming soon';

/**
 * ADR-0125: the dialog's body while the Mac app is not published (or the server has not said yet): no
 * command and no .dmg link, so nobody is offered an install that cannot work. It turns into the install steps
 * by itself once the mac-latest release is published.
 *
 * @param props.checking True while the server has not answered yet.
 * @returns The notice.
 * Rendered by: MacInstallSteps
 */
function MacComingSoon({
  checking,
}: {
  /** True while the server has not answered yet. */
  checking: boolean;
}) {
  if (checking) {
    return (
      <p role="status" className="text-[14px] text-ui-muted">
        Checking for the Mac version…
      </p>
    );
  }
  return (
    <section
      aria-label={MAC_COMING_SOON}
      data-mac-release="coming-soon"
      className="flex flex-col gap-2 text-[14px] text-ui-text"
    >
      <p className="font-medium text-ui-heading">{MAC_COMING_SOON}</p>
      <p>
        Paramount AI for Mac is not released yet. Until then, use Paramount AI in{' '}
        <strong>Chrome</strong> or <strong>Edge</strong> on your Mac: open it in a tab and share the
        meeting tab with its audio when you connect.
      </p>
    </section>
  );
}

/**
 * The install steps: the Terminal command first, then the .dmg fallback. ADR-0125: only when the Mac app is
 * published; otherwise "Mac version coming soon".
 *
 * @param props.published Whether the Mac app is published (useMacRelease()); null while not known yet.
 * @returns The steps, or the notice.
 * Rendered by: MacInstallDialog
 */
export function MacInstallSteps({
  published,
}: {
  /** Whether the Mac app is published; null while the server has not said. */
  published: boolean | null;
}) {
  const [copied, setCopied] = useState(false);
  if (published !== true) return <MacComingSoon checking={published === null} />;

  /** Copies the command and briefly says so. */
  async function copy() {
    try {
      await navigator.clipboard.writeText(MAC_INSTALL_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the command is still there to select and copy by hand.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-[14px] text-ui-text">
      <section aria-label="Install with Terminal" className="flex flex-col gap-2">
        <p>
          Open <strong>Terminal</strong> (Applications › Utilities), paste this line and press
          Return:
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-control border border-ui-border bg-ui-surface px-3 py-2 font-mono text-[13px] break-all text-ui-heading select-all">
            {MAC_INSTALL_COMMAND}
          </code>
          <Button variant="secondary" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-helper text-ui-muted">
          It downloads the app, checks that the file is complete and signed by Paramount
          Intelligence, puts it in Applications and opens it. Nothing is installed if a check fails.
          Run the same line again to update by hand; the app also updates itself.{' '}
          <a
            href={MAC_INSTALL_SCRIPT_URL}
            target="_blank"
            rel="noreferrer"
            className={LINK_CLASSES}
          >
            Read the script first
          </a>
        </p>
      </section>

      <section aria-label="First start" className="flex flex-col gap-1">
        <p className="font-medium text-ui-heading">The first time it opens</p>
        <p>
          macOS asks to allow the <strong>Microphone</strong> and{' '}
          <strong>Screen &amp; System Audio Recording</strong>. Paramount AI shows which ones are
          still needed and opens the right System Settings page. After allowing screen recording,
          quit and reopen Paramount AI.
        </p>
        <p className="text-helper text-ui-muted">
          macOS 12 or later. Hearing the other side of the call needs macOS 14.2 or later; on older
          versions, use Paramount AI in Chrome and share the meeting tab with its audio.
        </p>
      </section>

      <details className="rounded-control border border-ui-border px-3 py-2">
        <summary className="cursor-pointer font-medium text-ui-heading">
          Or download the .dmg instead
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Download <strong>Paramount-AI-…-universal.dmg</strong> from the{' '}
            <a
              href={MAC_RELEASE_PAGE_URL}
              target="_blank"
              rel="noreferrer"
              className={LINK_CLASSES}
            >
              Mac release page
            </a>
            , open it and drag Paramount AI to Applications.
          </li>
          <li>Open Paramount AI. macOS says it cannot check the app: click Done.</li>
          <li>
            Open <strong>System Settings › Privacy &amp; Security</strong>, scroll down to
            &ldquo;Paramount AI was blocked&rdquo;, click <strong>Open Anyway</strong>, then{' '}
            <strong>Open</strong>. This is needed only once.
          </li>
        </ol>
      </details>
    </div>
  );
}

/** Props for MacInstallDialog. */
export interface MacInstallDialogProps {
  /** True while the dialog is shown. */
  open: boolean;
  /** Closes it. */
  onClose: () => void;
}

/**
 * The install steps in a dialog.
 *
 * @param props See MacInstallDialogProps.
 * @returns The dialog.
 * Rendered by: MacInstallLink, DesktopHandoffPage.tsx, DesktopAppCard.tsx, DesktopAppLink.tsx
 */
export function MacInstallDialog({ open, onClose }: MacInstallDialogProps) {
  // ADR-0125: asked when the dialog opens (once per page).
  const published = useMacRelease(open);
  return (
    <Dialog open={open} onClose={onClose} title={MAC_INSTALL_TITLE} size="lg">
      <MacInstallSteps published={published} />
    </Dialog>
  );
}

/** Props for MacInstallLink. */
export interface MacInstallLinkProps {
  /** The words (default "Need it for macOS?", or "Get it for Mac" on a Mac). */
  label?: string;
  /** Extra classes for the button. */
  className?: string;
}

/**
 * A small link-styled button that opens the install steps. Not shown inside the desktop app on a Mac,
 * where Paramount AI is already installed.
 *
 * @param props See MacInstallLinkProps.
 * @returns The button and its dialog, or nothing in the Mac desktop app.
 * Rendered by: ConnectPanel.tsx, LauncherConnect.tsx, DesktopHandoffPage.tsx
 */
export function MacInstallLink({ label, className = '' }: MacInstallLinkProps) {
  const [open, setOpen] = useState(false);
  const mac = useIsMac();
  const desktop = useSyncExternalStore(subscribeNever, isDesktop, () => false);
  if (mac && desktop) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${LINK_CLASSES} pointer-coarse:min-h-11 ${className}`}
      >
        {label ?? (mac ? 'Get it for Mac' : 'Need it for macOS?')}
      </button>
      <MacInstallDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
