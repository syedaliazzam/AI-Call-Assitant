/**
 * File: apps/web/src/features/handoff/DesktopHandoffPage.tsx
 * Purpose: The page shown after choosing the desktop app (spec S9): it asks the browser to open the app
 *          on this session, says what to do with the browser's own prompt, and offers the same link as
 *          a button, the session file again, the download, and the way back. A browser cannot tell
 *          whether the link worked, so nothing here guesses.
 * Used by: app/(app)/sessions/[id]/desktop/page.tsx
 * Depends on: @kite/shared (the link and file name), lucide-react, next/link, src/core/session/handoff.ts,
 *             src/features/session-setup/labels.ts, src/ui
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S9); ADR-0045
 */
'use client';

import { desktopSessionLink, handoffFileName } from '@kite/shared';
import { ArrowLeft, MonitorDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { saveHandoffFile } from '@/core/session/handoff';
import { DESKTOP_DOWNLOAD_URL } from '@/features/session-setup/labels';
import { buttonClasses } from '@/ui/Button';
import { SOON_TOOLTIP } from '@/ui/Chip';
import { Tooltip } from '@/ui/Tooltip';

/** Props for DesktopHandoffPage. */
export interface DesktopHandoffPageProps {
  /** The session's id, from the address. */
  sessionId: string;
}

/**
 * Follows a paramountai:// link. A link click is what browsers expect for an app link.
 *
 * @param link The link.
 * Called from: DesktopHandoffPage
 */
function followLink(link: string): void {
  const anchor = document.createElement('a');
  anchor.href = link;
  anchor.click();
}

/**
 * The page.
 *
 * @param props See DesktopHandoffPageProps.
 * @returns The page's content.
 * Rendered by: app/(app)/sessions/[id]/desktop/page.tsx
 */
export function DesktopHandoffPage({ sessionId }: DesktopHandoffPageProps) {
  const link = desktopSessionLink(sessionId);
  const fileName = handoffFileName(sessionId);
  const asked = useRef(false);
  const [missing, setMissing] = useState(false);

  // Once per visit; the button below is there for when the prompt does not come.
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    followLink(link);
  }, [link]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-12 text-center">
      <h1 className="sr-only">Open in desktop app</h1>
      <p className="text-[15px] leading-relaxed text-ui-text">
        Click <strong className="font-semibold text-ui-heading">Open Paramount AI</strong> in your
        browser’s prompt. No prompt? Use the button below.
      </p>
      <a href={link} className={buttonClasses('secondary', 'lg', 'w-full max-w-sm')}>
        <MonitorDown aria-hidden="true" size={18} strokeWidth={1.75} />
        Open in desktop app
      </a>
      <p className="text-helper text-ui-muted">
        This session was saved to your downloads as{' '}
        <span className="break-all font-medium text-ui-text">{fileName}</span>. The desktop app asks
        for it the first time.{' '}
        <button
          type="button"
          onClick={() => {
            void saveHandoffFile(sessionId).then((saved) => setMissing(!saved));
          }}
          className="rounded-[4px] underline hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
        >
          Save it again
        </button>
      </p>
      {missing && (
        <p role="alert" className="text-helper text-ui-danger">
          This session is not on this computer.
        </p>
      )}

      <section
        aria-label="Get the desktop app"
        className="flex w-full flex-col gap-3 rounded-card border border-ui-border p-5 text-left"
      >
        <h2 className="text-label text-ui-heading">Don’t have the desktop app yet?</h2>
        <a
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses('primary', 'lg', 'w-full')}
        >
          Download for Windows
        </a>
        <Tooltip content={SOON_TOOLTIP} className="self-center">
          <span tabIndex={0} className="text-helper text-ui-muted">
            Need it for macOS?
          </span>
        </Tooltip>
      </section>

      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-control text-[15px] text-ui-muted hover:text-ui-text focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
      >
        <ArrowLeft aria-hidden="true" size={16} />
        Back to dashboard
      </Link>
    </div>
  );
}
