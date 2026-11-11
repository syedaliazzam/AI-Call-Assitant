/**
 * File: apps/web/src/features/dashboard/Dashboard.tsx
 * Purpose: The sessions page ("Call Sessions", spec S3): tabs by type with the count at the right, a
 *          search box joined to a sort button, grid or list (remembered), collapsible Active and Past
 *          sections of session cards, and an empty state. Starting a session goes through Choose
 *          platform in the browser and straight to the live screen in the desktop app.
 * Used by: app/(app)/page.tsx
 * Depends on: lucide-react, src/core/storage (sessions.ts, answers.ts, dashboardPrefs.ts),
 *             src/features/sync/LegacyUploadCard.tsx and src/core/sync/events.ts (ADR-0049), src/platform
 *             (offersPlatformChoice), ./SessionCard.tsx, ./SessionSearch.tsx,
 *             src/features/shell/CreateSessionButton.tsx,
 *             src/features/session-setup/ChoosePlatformDialog.tsx, src/ui/Tabs.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S3); docs/architecture/kite-architecture-v3.1.md §5
 */
'use client';

import { Bot, Briefcase, ChevronDown, LayoutGrid, List, Phone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { saveHandoffFile } from '@/core/session/handoff';
import { countAnswersBySession } from '@/core/storage/answers';
import {
  getDashboardLayout,
  getDashboardSort,
  setDashboardLayout,
  setDashboardSort,
  type DashboardLayout,
} from '@/core/storage/dashboardPrefs';
import {
  deleteSession,
  duplicateSession,
  filterSessions,
  listSessions,
  shownStatus,
  sortSessions,
  updateSession,
  type SessionSort,
} from '@/core/storage/sessions';
import type { Session, SessionType } from '@/core/storage/types';
import { ChoosePlatformDialog } from '@/features/session-setup/ChoosePlatformDialog';
import { SESSION_TYPE_LABELS } from '@/features/session-setup/labels';
import { CreateSessionButton } from '@/features/shell/CreateSessionButton';
import { getPlatform } from '@/platform';
import { Tabs } from '@/ui/Tabs';
import { SessionCard } from './SessionCard';
import { SessionSearch } from './SessionSearch';
import { LegacyUploadCard } from '@/features/sync/LegacyUploadCard';
import { onSyncApplied } from '@/core/sync/events';
import { useSyncAccount } from '@/features/sync/SyncScope';

/** The type filter: one session type, or all of them. */
type TypeFilter = SessionType | 'all';

/** The tab icons' size and stroke. */
const TAB_ICON = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The tabs, in display order. */
const TABS: readonly { value: TypeFilter; label: string; icon?: ReactNode }[] = [
  { value: 'all', label: 'All' },
  { value: 'interview', label: SESSION_TYPE_LABELS.interview, icon: <Briefcase {...TAB_ICON} /> },
  { value: 'regular', label: SESSION_TYPE_LABELS.regular, icon: <Phone {...TAB_ICON} /> },
  { value: 'mock', label: SESSION_TYPE_LABELS.mock, icon: <Bot {...TAB_ICON} /> },
];

/**
 * No-op subscription for useSyncExternalStore: these values never change by themselves while a
 * page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => {};

/**
 * A collapsible group of sessions.
 *
 * @param props.title    The group's name.
 * @param props.count    How many sessions it holds.
 * @param props.children The sessions.
 * @returns The heading and, while open, the sessions.
 * Rendered by: Dashboard
 */
function Section({
  title,
  count,
  children,
}: {
  /** The group's name. */
  title: string;
  /** How many sessions it holds. */
  count: number;
  /** The sessions. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-2 self-start rounded-control px-2.5 text-[15px] font-medium text-ui-heading hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11"
      >
        <ChevronDown
          aria-hidden="true"
          size={16}
          className={`transition-transform duration-(--k-dur) ${open ? '' : '-rotate-90'}`}
        />
        {title}
        <span className="font-normal text-ui-muted">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

/**
 * The sessions page.
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
  const [answerCounts, setAnswerCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  // Bumped to reload the list (after a change).
  const [version, setVersion] = useState(0);
  const [choosing, setChoosing] = useState<Session | null>(null);
  // Fixed per render pass so every card judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(() => Date.now());
  // The server cannot know the saved choices; the browser decides after load.
  const savedLayout = useSyncExternalStore<DashboardLayout>(
    subscribeNever,
    getDashboardLayout,
    () => 'grid',
  );
  const savedSort = useSyncExternalStore<SessionSort>(
    subscribeNever,
    getDashboardSort,
    () => 'newest',
  );
  const [chosenLayout, setChosenLayout] = useState<DashboardLayout | null>(null);
  const [chosenSort, setChosenSort] = useState<SessionSort | null>(null);
  const layout = chosenLayout ?? savedLayout;
  const sort = chosenSort ?? savedSort;

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSessions(), countAnswersBySession()])
      .then(([rows, counts]) => {
        if (cancelled) return;
        setSessions(rows);
        setAnswerCounts(counts);
        setNow(Date.now());
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // ADR-0049: with account sync, reload when sync brought changes from the account (another device,
  // the one-time upload). Without account sync this never fires.
  useEffect(() => onSyncApplied(() => setVersion((n) => n + 1)), []);
  const synced = useSyncAccount() !== null;

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
  const inTab = type === 'all' ? all : all.filter((session) => session.type === type);
  const shown = sortSessions(
    filterSessions(all, { search, ...(type === 'all' ? {} : { type }) }),
    sort,
  );
  const active = shown.filter((session) => shownStatus(session, now) !== 'ended');
  const past = shown.filter((session) => shownStatus(session, now) === 'ended');
  const filtering = search.trim() !== '' || type !== 'all';

  /**
   * The cards of one section.
   *
   * @param rows The sessions.
   * @returns The grid or list.
   */
  const cards = (rows: readonly Session[]) => (
    <ul
      className={
        layout === 'grid'
          ? 'grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2'
          : 'flex flex-col gap-3'
      }
    >
      {rows.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          now={now}
          grid={layout === 'grid'}
          answers={answerCounts.get(session.id) ?? 0}
          onOpen={open}
          onDelete={remove}
          onRename={rename}
          onDuplicate={duplicate}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col">
      {/* The header above shows the name; this <h1> is for screen readers. */}
      <h1 className="sr-only">Call Sessions</h1>
      <Tabs
        label="Session type"
        options={TABS}
        value={type}
        onChange={setType}
        inset
        end={
          <p className="text-[15px] text-ui-muted">
            {inTab.length} {inTab.length === 1 ? 'Session' : 'Sessions'}
          </p>
        }
      />

      <section aria-label="Sessions" className="flex flex-col gap-5 px-5 py-5">
        {/* ADR-0049: with account sync, offers once to add this computer's own data. */}
        <LegacyUploadCard />
        <div className="flex items-center justify-between gap-3">
          {/* The search box and the sort button read as one control (shared with the desktop app). */}
          <SessionSearch
            search={search}
            onSearch={setSearch}
            placeholder="Search by company or role"
            sort={sort}
            onSort={(next) => {
              setChosenSort(next);
              setDashboardSort(next);
            }}
            className="w-full max-w-xs"
          />
          <div
            role="radiogroup"
            aria-label="Layout"
            className="flex shrink-0 gap-0.5 rounded-control bg-ui-subtle p-1"
          >
            {(
              [
                ['grid', 'Grid', <LayoutGrid key="grid" aria-hidden="true" size={18} />],
                ['list', 'List', <List key="list" aria-hidden="true" size={18} />],
              ] as const
            ).map(([value, name, icon]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                aria-label={name}
                onClick={() => {
                  setChosenLayout(value);
                  setDashboardLayout(value);
                }}
                className={[
                  'flex size-8 items-center justify-center rounded-[8px] transition-colors duration-(--k-dur) focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:size-11',
                  layout === value ? 'bg-ui-segment text-ui-heading' : 'text-ui-muted',
                ].join(' ')}
              >
                {icon}
              </button>
            ))}
          </div>
        </div>

        {failed && (
          <p role="alert" className="text-helper text-ui-danger">
            Paramount AI could not open its local storage. Reload the page to try again.
          </p>
        )}

        {sessions && active.length > 0 && (
          <Section title="Active sessions" count={active.length}>
            {cards(active)}
          </Section>
        )}
        {sessions && past.length > 0 && (
          <Section title="Past sessions" count={past.length}>
            {cards(past)}
          </Section>
        )}

        {sessions && shown.length === 0 && (
          <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <p className="text-[15px] text-ui-muted">
              {filtering
                ? 'No sessions match. Try another search or type.'
                : 'No sessions yet. Create one to get started.'}
            </p>
            {!filtering && <CreateSessionButton />}
          </div>
        )}
      </section>

      <ChoosePlatformDialog
        open={choosing !== null}
        onClose={() => setChoosing(null)}
        onOpenInBrowser={() => {
          if (choosing) router.push(`/live/${choosing.id}`);
        }}
        onOpenInDesktop={() => {
          if (!choosing) return;
          // ADR-0052: with account sync the session is already in the account; the link carries a
          // one-time sign-in code instead of a file. Without it, the file is saved here, on the press
          // (a browser allows a download from a person's action).
          if (!synced) void saveHandoffFile(choosing.id);
          router.push(`/sessions/${choosing.id}/desktop`);
        }}
      />
    </div>
  );
}
