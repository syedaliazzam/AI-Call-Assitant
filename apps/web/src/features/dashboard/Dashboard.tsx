/**
 * File: apps/web/src/features/dashboard/Dashboard.tsx
 * Purpose: The dashboard ("Call Sessions"): the user's sessions on this computer, with type tabs
 *          and their counts (All / Interview / Regular / Mock), search by role or company, sort,
 *          grid or list, a "Create session" menu of types, empty states, and a dismissible banner
 *          about the desktop app in the browser. Starting a session goes through Choose platform in the
 *          browser and straight to the live screen in the desktop app.
 * Used by: app/(app)/page.tsx
 * Depends on: src/core/storage (sessions.ts, dashboardPrefs.ts), src/platform (offersPlatformChoice,
 *             kind for the note), ./SessionCard.tsx,
 *             src/features/session-setup/ChoosePlatformDialog.tsx, src/ui (Menu, Select, Tabs, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §2 (F1, F4), §5 (Dashboard); ADR-0029
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  dismissDesktopBanner,
  getDashboardLayout,
  getDashboardSort,
  getDesktopBannerDismissed,
  setDashboardLayout,
  setDashboardSort,
  type DashboardLayout,
} from '@/core/storage/dashboardPrefs';
import {
  deleteSession,
  duplicateSession,
  filterSessions,
  listSessions,
  sortSessions,
  updateSession,
  type SessionSort,
} from '@/core/storage/sessions';
import type { Session, SessionType } from '@/core/storage/types';
import { ChoosePlatformDialog } from '@/features/session-setup/ChoosePlatformDialog';
import { DESKTOP_DOWNLOAD_URL, SESSION_TYPE_OPTIONS } from '@/features/session-setup/labels';
import { getPlatform } from '@/platform';
import { Eyebrow } from '@/ui/Eyebrow';
import { CloseIcon, GridIcon, ListIcon, MonitorIcon } from '@/ui/icons';
import { LinkButton } from '@/ui/LinkButton';
import { Menu } from '@/ui/Menu';
import { Select } from '@/ui/Select';
import { Tabs } from '@/ui/Tabs';
import { SessionCard } from './SessionCard';

/** The type filter: one session type, or all of them. */
type TypeFilter = SessionType | 'all';

/** The sort choices. */
const SORT_OPTIONS: readonly { value: SessionSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'company', label: 'Company A–Z' },
];

/**
 * No-op subscription for useSyncExternalStore: these values never change by themselves while a
 * page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * Which platform the page runs on, for display only (the note about the desktop app).
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
  // Bumped to reload the list (after a change).
  const [version, setVersion] = useState(0);
  const [choosing, setChoosing] = useState<Session | null>(null);
  // Fixed per render pass so every card judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(() => Date.now());
  // The server cannot know the platform or saved choices; the browser decides after load.
  const kind = useSyncExternalStore(subscribeNever, platformKind, () => null);
  const savedLayout = useSyncExternalStore<DashboardLayout>(
    subscribeNever,
    getDashboardLayout,
    () => 'list',
  );
  const savedSort = useSyncExternalStore<SessionSort>(
    subscribeNever,
    getDashboardSort,
    () => 'newest',
  );
  const bannerDismissed = useSyncExternalStore(
    subscribeNever,
    getDesktopBannerDismissed,
    () => true,
  );
  const [bannerClosed, setBannerClosed] = useState(false);
  const [chosenLayout, setChosenLayout] = useState<DashboardLayout | null>(null);
  const [chosenSort, setChosenSort] = useState<SessionSort | null>(null);
  const layout = chosenLayout ?? savedLayout;
  const sort = chosenSort ?? savedSort;

  useEffect(() => {
    let cancelled = false;
    listSessions()
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
  }, [version]);

  /**
   * Starts a session: Choose platform first where it applies (browser), otherwise straight to
   * the live screen (desktop app).
   *
   * @param session The session to start.
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

  /**
   * Saves a session's new names, then reloads the list.
   *
   * @param session The session.
   * @param company The new company.
   * @param role    The new role or topic.
   */
  async function rename(session: Session, company: string, role: string) {
    await updateSession(session.id, { company, role });
    setVersion((n) => n + 1);
  }

  /**
   * Copies a session, then reloads the list.
   *
   * @param session The session to copy.
   */
  async function duplicate(session: Session) {
    await duplicateSession(session.id);
    setVersion((n) => n + 1);
  }

  const all = sessions ?? [];
  const tabs: readonly { value: TypeFilter; label: string }[] = [
    { value: 'all', label: `All (${all.length})` },
    ...SESSION_TYPE_OPTIONS.map((option) => ({
      value: option.value,
      label: `${option.label} (${all.filter((session) => session.type === option.value).length})`,
    })),
  ];
  const shown = sortSessions(
    filterSessions(all, { search, ...(type === 'all' ? {} : { type }) }),
    sort,
  );
  const filtering = search.trim() !== '' || type !== 'all';
  // The empty state has its own primary button; the header's is hidden then (one per view).
  const firstRun = sessions !== null && sessions.length === 0;
  return (
    <div className="flex flex-col">
      {/* White header band, then the list on the grey band (theme §5: alternating sections). */}
      <header className="border-b border-ui-border bg-ui-surface px-4 py-8 sm:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>Paramount AI · call assistant</Eyebrow>
            <h1 className="text-[24px] font-semibold text-ui-heading">Call Sessions</h1>
            <p className="mt-1 max-w-prose text-[15px] text-ui-muted">
              Prepare a session before each call, then get live answers while you talk.
            </p>
          </div>
          {!firstRun && (
            <Menu
              label="Create session"
              variant="primary"
              items={SESSION_TYPE_OPTIONS.map((option) => ({
                label: option.label,
                onSelect: () => router.push(`/sessions/new?type=${option.value}`),
              }))}
            />
          )}
        </div>
      </header>

      <section aria-label="Sessions" className="flex-1 bg-ui-band px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-5xl">
          {kind === 'browser' && !bannerDismissed && !bannerClosed && (
            <aside
              aria-label="Desktop app"
              className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-ui-border bg-ui-surface px-5 py-3 text-[15px] text-ui-text shadow-card"
            >
              <MonitorIcon size={20} />
              <p className="min-w-0 flex-1 basis-56">
                The desktop app hears calls from any meeting app, with global hotkeys.
              </p>
              <a
                href={DESKTOP_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-control text-[15px] font-medium text-ui-link hover:underline focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
              >
                Get the desktop app
              </a>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => {
                  setBannerClosed(true);
                  dismissDesktopBanner();
                }}
                className="flex size-8 items-center justify-center text-ui-muted hover:bg-ui-hover hover:text-ui-heading focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11"
              >
                <CloseIcon />
              </button>
            </aside>
          )}

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <Tabs label="Session type" options={tabs} value={type} onChange={setType} />
            <div className="flex flex-wrap items-end gap-3">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search role or company"
                aria-label="Search sessions"
                className="h-10 w-full border border-ui-border bg-ui-input px-3 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 sm:w-60 md:text-[15px]"
              />
              <div className="w-40">
                <Select
                  label="Sort"
                  options={SORT_OPTIONS}
                  value={sort}
                  onChange={(next) => {
                    setChosenSort(next);
                    setDashboardSort(next);
                  }}
                />
              </div>
              <div role="radiogroup" aria-label="Layout" className="flex">
                {(
                  [
                    ['list', 'List', <ListIcon key="list" />],
                    ['grid', 'Grid', <GridIcon key="grid" />],
                  ] as const
                ).map(([value, name, icon]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={layout === value}
                    aria-label={name}
                    title={name}
                    onClick={() => {
                      setChosenLayout(value);
                      setDashboardLayout(value);
                    }}
                    className={[
                      'flex h-10 w-10 items-center justify-center rounded-none border border-ui-border first:rounded-l-control last:rounded-r-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 pointer-coarse:min-w-11',
                      layout === value
                        ? 'bg-ui-subtle text-ui-heading'
                        : 'bg-ui-surface text-ui-muted',
                    ].join(' ')}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {failed && (
            <p role="alert" className="mt-8 text-[13px] text-ui-danger">
              Paramount AI could not open its local storage. Reload the page to try again.
            </p>
          )}

          {shown.length > 0 && (
            <ul
              className={
                layout === 'grid'
                  ? 'mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3'
                  : 'mt-6 flex flex-col gap-3'
              }
            >
              {shown.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  now={now}
                  grid={layout === 'grid'}
                  onOpen={open}
                  onDelete={remove}
                  onRename={rename}
                  onDuplicate={duplicate}
                />
              ))}
            </ul>
          )}

          {sessions && shown.length === 0 && (
            // Empty state (theme §6): a headline, one line, one primary button.
            <section className="mt-6 flex flex-col items-center border border-ui-border rounded-card bg-ui-surface shadow-card px-6 py-14 text-center">
              <h2 className="text-[18px] font-semibold text-ui-heading">
                {filtering ? 'No sessions match' : 'No sessions yet'}
              </h2>
              <p className="mt-1 max-w-sm text-[15px] text-ui-muted">
                {filtering
                  ? 'Try another search or type.'
                  : 'Create a session before your next call: its details and documents help Paramount AI answer. Sessions are saved on this computer.'}
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
