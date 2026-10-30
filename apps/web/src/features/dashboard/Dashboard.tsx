/**
 * File: apps/web/src/features/dashboard/Dashboard.tsx
 * Purpose: The dashboard ("Call Sessions"): the user's sessions on this computer, newest first,
 *          with a search box, type filter tabs (All / Interview / Sales / Support / Internal), a
 *          "Create session" button, empty states, and a "Download desktop app" banner placeholder
 *          in the browser. Opening a session goes through Choose platform in the browser and
 *          straight to the live screen in the desktop app.
 * Used by: app/(app)/page.tsx
 * Depends on: src/core/storage/sessions.ts, src/platform (offersPlatformChoice, kind for the
 *             banner), ./SessionCard.tsx, src/features/session-setup/ChoosePlatformDialog.tsx,
 *             src/ui (Button, Tabs)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1, F4), §5 (Dashboard);
 *               day-03-sessions.md Stage 3
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { deleteSession, listSessions } from '@/core/storage/sessions';
import type { Session, SessionType } from '@/core/storage/types';
import { ChoosePlatformDialog } from '@/features/session-setup/ChoosePlatformDialog';
import { SESSION_TYPE_OPTIONS } from '@/features/session-setup/labels';
import { getPlatform } from '@/platform';
import { Eyebrow } from '@/ui/Eyebrow';
import { LinkButton } from '@/ui/LinkButton';
import { Tabs } from '@/ui/Tabs';
import { SessionCard } from './SessionCard';

/** The type filter: one session type, or all of them. */
type TypeFilter = SessionType | 'all';

/** The filter tabs, "All" first. */
const TYPE_TABS: readonly { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  ...SESSION_TYPE_OPTIONS,
];

/**
 * No-op subscription for useSyncExternalStore: the platform never changes while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Which platform the page runs on, for display only (the "Download desktop app" banner).
 *
 * @returns 'desktop' or 'browser'.
 */
const platformKind = () => getPlatform().kind;

/**
 * The Call Sessions dashboard.
 *
 * @returns The page content.
 * Rendered by: app/(app)/page.tsx
 */
export function Dashboard() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  // null while loading; the list as stored on this computer otherwise.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Bumped to reload the list (after a delete).
  const [version, setVersion] = useState(0);
  const [choosing, setChoosing] = useState<Session | null>(null);
  // Fixed per render pass so every card judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(() => Date.now());
  // The server cannot know the platform; it renders no banner, the browser decides after load.
  const kind = useSyncExternalStore(subscribeNever, platformKind, () => null);

  useEffect(() => {
    let cancelled = false;
    listSessions({ search, type: type === 'all' ? undefined : type })
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
        setNow(Date.now());
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [search, type, version]);

  /**
   * Opens a session: Choose platform first where it applies (browser), otherwise straight to
   * the live screen (desktop app).
   *
   * @param session The session to open.
   */
  function open(session: Session) {
    if (getPlatform().offersPlatformChoice) setChoosing(session);
    else router.push(`/live/${session.id}`);
  }

  /**
   * Deletes a session with everything saved for it, then reloads the list.
   *
   * @param session The session to delete.
   */
  async function remove(session: Session) {
    await deleteSession(session.id);
    setVersion((n) => n + 1);
  }

  const filtering = search.trim() !== '' || type !== 'all';
  // The empty state has its own primary button; the header's is hidden then (one per view).
  const firstRun = sessions !== null && sessions.length === 0 && !filtering;
  return (
    <div className="flex flex-col">
      {/* White header band, then the list on the grey band (theme §5: alternating sections). */}
      <header className="border-b border-ui-border bg-ui-surface px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Kite · call assistant</Eyebrow>
            <h1 className="text-[28px] font-bold text-ui-heading">Call Sessions</h1>
            <p className="mt-1 max-w-prose text-[15px] text-ui-muted">
              Prepare a session before each call, then get live answers while you talk.
            </p>
          </div>
          {!firstRun && (
            <LinkButton href="/sessions/new" variant="primary">
              Create session
            </LinkButton>
          )}
        </div>
      </header>

      <section aria-label="Sessions" className="flex-1 bg-ui-band px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-5xl">
          {kind === 'browser' && (
            // Placeholder: the installer and its download links go live on Day 6.
            <aside className="mb-6 flex flex-wrap items-center justify-between gap-2 border border-l-[3px] border-ui-border border-l-ui-accent bg-ui-surface px-5 py-3 text-[15px]">
              <span className="text-ui-text">
                The desktop app hears calls from any meeting app, with global hotkeys.
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.08em] text-ui-muted">
                Download on Day 6
              </span>
            </aside>
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <Tabs label="Session type" options={TYPE_TABS} value={type} onChange={setType} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search company, role or description"
              aria-label="Search sessions"
              className="h-10 w-full border border-ui-border bg-ui-input px-3 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 sm:w-72 md:text-[15px]"
            />
          </div>

          {failed && (
            <p role="alert" className="mt-8 text-sm text-ui-danger">
              Kite could not open its local storage. Reload the page to try again.
            </p>
          )}

          {sessions && sessions.length > 0 && (
            <ul className="mt-6 flex flex-col gap-3">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  now={now}
                  onOpen={open}
                  onDelete={remove}
                />
              ))}
            </ul>
          )}

          {sessions && sessions.length === 0 && (
            // Empty state (theme §6): a headline, one line, one primary button.
            <section className="mt-6 flex flex-col items-center border border-ui-border bg-ui-surface px-6 py-14 text-center">
              <h2 className="text-[20px] font-semibold text-ui-heading">
                {filtering ? 'No sessions match' : 'No sessions yet'}
              </h2>
              <p className="mt-1 max-w-sm text-[15px] text-ui-muted">
                {filtering
                  ? 'Try another search or type.'
                  : 'Create a session before your next call: its details and documents help Kite answer. Sessions are saved on this computer.'}
              </p>
              {!filtering && (
                <LinkButton href="/sessions/new" variant="primary" className="mt-6">
                  Start your first session
                </LinkButton>
              )}
            </section>
          )}
        </div>
      </section>

      <ChoosePlatformDialog
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        onOpenInBrowser={() => {
          if (choosing) router.push(`/live/${choosing.id}`);
        }}
      />
    </div>
  );
}
