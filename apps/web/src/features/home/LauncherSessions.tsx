/**
 * File: apps/web/src/features/home/LauncherSessions.tsx
 * Purpose: The desktop app's first card (ADR-0055), "Your sessions", redesigned in ADR-0071: a search
 *          box ("Search by title or description") joined to a sort button (newest, oldest, A–Z), then
 *          the account's sessions as the dashboard's own session cards, one column. Each card's button
 *          opens the Start card (Start session) or the session's page in the browser (View transcript);
 *          its ⋮ has View in dashboard ↗ and Delete. A session the browser's "Desktop app" link opened
 *          stays first, edged in green, "From your browser". After a call, "Call ended · View notes"
 *          sits on top. A bar stuck to the bottom holds "View in Dashboard ↗" and "+ Create session",
 *          both opening the browser.
 * Used by: src/features/home/Launcher.tsx
 * Depends on: lucide-react, src/core/storage (sessions, dashboardPrefs, types),
 *             src/features/dashboard (SessionCard, SessionSearch, sessionCardParts),
 *             src/features/sync/dashboardLink.ts, src/ui (Button, icons), ./LauncherSessionMenu.tsx
 * Architecture: ADR-0051, ADR-0055, ADR-0071
 *
 * Session text is shown on screen only; it is never logged.
 */
'use client';

import { Plus } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { getDashboardSort, setDashboardSort } from '@/core/storage/dashboardPrefs';
import { shownStatus, sortSessions, type SessionSort } from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { SessionCardFrame } from '@/features/dashboard/SessionCard';
import { sessionCardLine, sessionCardTitle } from '@/features/dashboard/sessionCardParts';
import { SessionSearch } from '@/features/dashboard/SessionSearch';
import { openDashboard } from '@/features/sync/dashboardLink';
import { Button } from '@/ui/Button';
import { OutIcon } from '@/ui/icons';
import { LauncherSessionMenu } from './LauncherSessionMenu';

/** The browser page "+ Create session" opens: the dashboard with Create session open (ADR-0071). */
export const CREATE_SESSION_PATH = '/dashboard?create=1';

/** Props for LauncherSessions. */
export interface LauncherSessionsProps {
  /** The account's sessions on this computer (null while loading). */
  sessions: readonly Session[] | null;
  /** True when this computer's copy could not be read. */
  failed: boolean;
  /** The clock for "live for over 12 hours" (fixed per list). */
  now: number;
  /** How many answers each session has, by session id (missing: none). */
  answers?: ReadonlyMap<string, number>;
  /** The session the browser's link opened, shown first and highlighted. */
  fromBrowserId?: string | null;
  /** True once the link's session was looked for in the account and is not there. */
  fromBrowserMissing?: boolean;
  /** A call that ended in the last 2 hours: its notes are one click away. */
  lastCall?: Session | null;
  /** Opens a session's Start card. */
  onOpen: (session: Session) => void;
  /** Deletes a session after the user confirmed. */
  onDelete: (session: Session) => Promise<void>;
  /** Extra rows above the list (the accurate-transcription offer, the one-time upload). */
  notices?: ReactNode;
}

/**
 * The sessions whose title, role or topic line, or description holds the search text.
 *
 * @param sessions The sessions.
 * @param search   The text typed (case and spaces at the ends are ignored).
 * @returns The matching sessions, in the same order.
 * Called from: launcherOrder(); tests
 */
export function launcherSearch(sessions: readonly Session[], search: string): Session[] {
  const text = search.trim().toLowerCase();
  if (text === '') return [...sessions];
  return sessions.filter((session) =>
    [sessionCardTitle(session), sessionCardLine(session), session.description].some((field) =>
      field.toLowerCase().includes(text),
    ),
  );
}

/**
 * The list as shown: matching the search, in the chosen order, with the session the browser opened
 * first.
 *
 * @param sessions      The sessions.
 * @param fromBrowserId The session the link opened, if any.
 * @param sort          The order (default newest first).
 * @param search        The search text (default none).
 * @returns The ordered list.
 * Called from: LauncherSessions; tests
 */
export function launcherOrder(
  sessions: readonly Session[],
  fromBrowserId: string | null | undefined,
  sort: SessionSort = 'newest',
  search = '',
): Session[] {
  const shown = sortSessions(launcherSearch(sessions, search), sort);
  const first = fromBrowserId ? shown.find((session) => session.id === fromBrowserId) : undefined;
  return first ? [first, ...shown.filter((session) => session !== first)] : shown;
}

/**
 * Nothing to subscribe to: the saved order only changes through this page.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: LauncherSessions
 */
const subscribeNever = () => () => undefined;

/** A bottom bar button's shape: half the bar, 44 tall (the launcher's button height). */
const BAR_BUTTON =
  'inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[10px] px-3 text-[15px] font-semibold focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]';

/**
 * The card, and the bottom bar under it.
 *
 * @param props See LauncherSessionsProps.
 * @returns The page.
 * Rendered by: Launcher.tsx
 */
export function LauncherSessions({
  sessions,
  failed,
  now,
  answers,
  fromBrowserId = null,
  fromBrowserMissing = false,
  lastCall = null,
  onOpen,
  onDelete,
  notices,
}: LauncherSessionsProps) {
  const [search, setSearch] = useState('');
  // The dashboard's remembered order is the starting point (each window has its own storage).
  const savedSort = useSyncExternalStore<SessionSort>(
    subscribeNever,
    getDashboardSort,
    () => 'newest',
  );
  const [chosenSort, setChosenSort] = useState<SessionSort | null>(null);
  const sort = chosenSort ?? savedSort;
  const ordered = sessions ? launcherOrder(sessions, fromBrowserId, sort, search) : [];

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-1">
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
          className="k-anim-modal k-card-texture flex flex-1 flex-col gap-3 rounded-[16px] border border-ui-border p-4"
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
              The session from your browser is not in this account. It may have been deleted, or
              made in another account.
            </p>
          )}
          {sessions !== null && sessions.length > 0 && (
            <SessionSearch
              search={search}
              onSearch={setSearch}
              placeholder="Search by title or description"
              sort={sort}
              onSort={(next) => {
                setChosenSort(next);
                setDashboardSort(next);
              }}
              className="w-full"
            />
          )}
          {failed ? (
            <p role="alert" className="p-4 text-[14px] text-ui-danger">
              Paramount AI could not read your sessions on this computer. Reopen it and try again.
            </p>
          ) : sessions === null ? (
            <p className="p-4 text-center text-[14px] text-ui-muted">Loading…</p>
          ) : sessions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="text-[15px] font-medium text-ui-heading">No sessions yet</p>
              <p className="text-[14px] text-ui-muted">
                Create one in the dashboard, and it shows here.
              </p>
            </div>
          ) : ordered.length === 0 ? (
            <p className="p-6 text-center text-[14px] text-ui-muted">
              No sessions match. Try another search.
            </p>
          ) : (
            <ul aria-label="Sessions" className="flex flex-col gap-3">
              {ordered.map((session) => (
                <LauncherCard
                  key={session.id}
                  session={session}
                  now={now}
                  answers={answers?.get(session.id) ?? 0}
                  fromBrowser={session.id === fromBrowserId}
                  onOpen={onOpen}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
      {/* Stuck to the window's bottom while the list scrolls under it. */}
      <div className="sticky bottom-0 z-10 grid grid-cols-2 gap-3 border-t border-ui-border bg-ui-bg px-4 py-3">
        <button
          type="button"
          onClick={() => openDashboard('/')}
          className={`${BAR_BUTTON} border border-ui-border bg-ui-surface text-ui-heading shadow-raised hover:bg-ui-hover`}
        >
          <span className="truncate">View in Dashboard</span> <OutIcon />
        </button>
        <button
          type="button"
          onClick={() => openDashboard(CREATE_SESSION_PATH)}
          className={`${BAR_BUTTON} bg-ui-accent-fill text-ui-on-accent shadow-raised hover:bg-ui-accent-fill-hover`}
        >
          <Plus aria-hidden="true" size={18} strokeWidth={2} />
          <span className="truncate">Create session</span>
        </button>
      </div>
    </div>
  );
}

/**
 * One session: the dashboard's session card, with the desktop's menu and button.
 *
 * @param props.session     The session.
 * @param props.now         The list's clock.
 * @param props.answers     How many answers it has.
 * @param props.fromBrowser True for the session the browser's link opened.
 * @param props.onOpen      Opens its Start card.
 * @param props.onDelete    Deletes it after the user confirmed.
 * @returns The card.
 * Rendered by: LauncherSessions
 */
function LauncherCard({
  session,
  now,
  answers,
  fromBrowser,
  onOpen,
  onDelete,
}: {
  /** The session. */
  session: Session;
  /** The list's clock. */
  now: number;
  /** How many answers it has. */
  answers: number;
  /** True for the session the browser's link opened. */
  fromBrowser: boolean;
  /** Opens its Start card. */
  onOpen: (session: Session) => void;
  /** Deletes it after the user confirmed. */
  onDelete: (session: Session) => Promise<void>;
}) {
  const status = shownStatus(session, now);
  const title = sessionCardTitle(session);
  return (
    <SessionCardFrame
      session={session}
      status={status}
      answers={answers}
      highlighted={fromBrowser}
      {...(fromBrowser ? { eyebrow: 'From your browser' } : {})}
      menu={<LauncherSessionMenu session={session} title={title} onDelete={onDelete} />}
      action={
        status === 'ended' ? (
          // The transcript is read in the browser (the session's Review page).
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={() => openDashboard(`/sessions/${session.id}`)}
          >
            View transcript <OutIcon />
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="shrink-0"
            aria-label={`Start session: ${title}`}
            onClick={() => onOpen(session)}
          >
            Start session
          </Button>
        )
      }
    />
  );
}
