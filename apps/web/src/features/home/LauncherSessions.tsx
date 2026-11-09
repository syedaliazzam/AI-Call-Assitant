/**
 * File: apps/web/src/features/home/LauncherSessions.tsx
 * Purpose: The desktop app's first card (ADR-0055): "Your sessions", the account's sessions (the same
 *          list as the dashboard, newest first), one row each with the company's logo tile, the company,
 *          the role, the date and the status. A row opens the Start card. A session the browser's
 *          "Desktop app" link opened comes first, highlighted "From your browser". After a call, "Call
 *          ended · View notes" sits on top (the notes open in the browser). At the bottom, "Open
 *          dashboard" (the browser). Nothing here edits a session: that is the dashboard's job.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: src/core/storage (sessions, types), src/features/dashboard (CompanyTile, sessionCardParts),
 *             src/features/session-setup/labels.ts, src/features/sync/dashboardLink.ts, src/ui
 * Architecture: ADR-0051, ADR-0055
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { shownStatus } from '@/core/storage/sessions';
import type { Session, SessionStatus } from '@/core/storage/types';
import { CompanyTile } from '@/features/dashboard/CompanyTile';
import { sessionCardLine, sessionCardTitle } from '@/features/dashboard/sessionCardParts';
import { STATUS_LABELS } from '@/features/session-setup/labels';
import { openDashboard } from '@/features/sync/dashboardLink';
import { OutIcon } from '@/ui/icons';

/** Props for LauncherSessions. */
export interface LauncherSessionsProps {
  /** The account's sessions on this computer (null while loading). */
  sessions: readonly Session[] | null;
  /** True when this computer's copy could not be read. */
  failed: boolean;
  /** The clock for "live for over 12 hours" (fixed per list). */
  now: number;
  /** The session the browser's link opened, shown first and highlighted. */
  fromBrowserId?: string | null;
  /** True once the link's session was looked for in the account and is not there. */
  fromBrowserMissing?: boolean;
  /** A call that ended in the last 2 hours: its notes are one click away. */
  lastCall?: Session | null;
  /** Opens a session's Start card. */
  onOpen: (session: Session) => void;
  /** Extra rows above the list (the accurate-transcription offer, the one-time upload). */
  notices?: ReactNode;
}

/** The status dot per shown status (spec §1): accent, a red pulse, or grey. */
const STATUS_DOTS: Record<SessionStatus, string> = {
  'not-started': 'bg-ui-accent-fill',
  live: 'animate-pulse bg-ui-dot-recording',
  ended: 'bg-ui-dot-ended',
};

/** The date on a row, in the user's locale (shown uppercase, for example "NOV 4, 2026"). */
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/**
 * The list with the session the browser opened first.
 *
 * @param sessions      The sessions, newest first.
 * @param fromBrowserId The session the link opened, if any.
 * @returns The ordered list.
 * Called from: LauncherSessions; tests
 */
export function launcherOrder(
  sessions: readonly Session[],
  fromBrowserId: string | null | undefined,
): Session[] {
  const first = fromBrowserId
    ? sessions.find((session) => session.id === fromBrowserId)
    : undefined;
  const rest = [...sessions]
    .filter((session) => session !== first)
    .sort((a, b) => b.createdAt - a.createdAt);
  return first ? [first, ...rest] : rest;
}

/**
 * The card.
 *
 * @param props See LauncherSessionsProps.
 * @returns The card, and the dashboard button under it.
 * Rendered by: Launcher.tsx
 */
export function LauncherSessions({
  sessions,
  failed,
  now,
  fromBrowserId = null,
  fromBrowserMissing = false,
  lastCall = null,
  onOpen,
  notices,
}: LauncherSessionsProps) {
  const ordered = sessions ? launcherOrder(sessions, fromBrowserId) : [];
  return (
    <div className="flex min-h-full flex-col gap-3 px-4 pb-4 pt-1">
      {lastCall && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-[14px] border border-ui-border bg-ui-surface px-4 py-3"
        >
          <p className="min-w-0 truncate text-[14px] text-ui-text">
            <span className="font-medium text-ui-heading">Call ended</span> ·{' '}
            {sessionCardTitle(lastCall)}
          </p>
          <button
            type="button"
            onClick={() => openDashboard(`/sessions/${lastCall.id}`)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-ui-border px-3 text-[14px] font-semibold text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
          >
            View notes <OutIcon />
          </button>
        </div>
      )}
      {notices}
      <section
        aria-labelledby="launcher-sessions-title"
        className="flex min-h-0 flex-1 flex-col gap-3 rounded-[16px] border border-ui-border bg-ui-bg p-4"
      >
        <h1
          id="launcher-sessions-title"
          className="text-center text-[18px] font-medium text-ui-heading"
        >
          Your sessions
        </h1>
        {fromBrowserMissing && (
          <p
            role="alert"
            className="rounded-[10px] bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
          >
            The session from your browser is not in this account. It may have been deleted, or made
            in another account.
          </p>
        )}
        {failed ? (
          <p role="alert" className="p-4 text-[14px] text-ui-danger">
            Paramount AI could not read your sessions on this computer. Reopen it and try again.
          </p>
        ) : sessions === null ? (
          <p className="p-4 text-center text-[14px] text-ui-muted">Loading…</p>
        ) : ordered.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-6 text-center">
            <p className="text-[15px] font-medium text-ui-heading">No sessions yet</p>
            <p className="text-[14px] text-ui-muted">
              Create a session in the dashboard, and it shows here.
            </p>
          </div>
        ) : (
          <ul aria-label="Sessions" className="flex flex-col gap-2">
            {ordered.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                status={shownStatus(session, now)}
                fromBrowser={session.id === fromBrowserId}
                onOpen={onOpen}
              />
            ))}
          </ul>
        )}
      </section>
      <button
        type="button"
        onClick={() => openDashboard('/')}
        className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-[10px] bg-ui-primary px-4 text-[15px] font-semibold text-ui-on-primary hover:bg-ui-primary-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
      >
        Open dashboard <OutIcon />
      </button>
    </div>
  );
}

/**
 * One session: the logo tile, the company and role, the date and the status. The whole row opens the
 * Start card.
 *
 * @param props.session     The session.
 * @param props.status      Its shown status.
 * @param props.fromBrowser True for the session the browser's link opened.
 * @param props.onOpen      Opens its Start card.
 * @returns The row.
 * Rendered by: LauncherSessions
 */
function SessionRow({
  session,
  status,
  fromBrowser,
  onOpen,
}: {
  /** The session. */
  session: Session;
  /** Its shown status. */
  status: SessionStatus;
  /** True for the session the browser's link opened. */
  fromBrowser: boolean;
  /** Opens its Start card. */
  onOpen: (session: Session) => void;
}) {
  const title = sessionCardTitle(session);
  const line = sessionCardLine(session);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(session)}
        aria-label={`${title}${line ? `, ${line}` : ''}, ${STATUS_LABELS[status]}${fromBrowser ? ', from your browser' : ''}`}
        className={`flex w-full items-center gap-3 rounded-[12px] border px-3 py-2.5 text-left hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] ${
          fromBrowser
            ? 'border-ui-accent-fill bg-ui-accent-tint [border-width:1.5px]'
            : 'border-ui-border bg-ui-surface'
        }`}
      >
        <CompanyTile name={title} domain={session.companyDomain} />
        <span className="flex min-w-0 flex-1 flex-col">
          {fromBrowser && (
            <span className="mb-0.5 text-[12px] font-medium text-ui-link">From your browser</span>
          )}
          <span className="truncate text-[15px] font-medium text-ui-heading">{title}</span>
          {line && <span className="truncate text-[14px] text-ui-muted">{line}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-card-date uppercase text-ui-muted">
            {DATE_FORMAT.format(session.createdAt)}
          </span>
          <span
            className={`flex items-center gap-1.5 text-[13px] ${status === 'ended' ? 'text-ui-muted' : 'text-ui-heading'}`}
          >
            <span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOTS[status]}`} />
            {STATUS_LABELS[status]}
          </span>
        </span>
        <ChevronRight aria-hidden="true" size={16} className="shrink-0 text-ui-muted" />
      </button>
    </li>
  );
}
