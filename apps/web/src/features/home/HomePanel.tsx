/**
 * File: apps/web/src/features/home/HomePanel.tsx
 * Purpose: The home panel, the desktop app's window between calls (v1.1.0, ADR-0041): a header with the
 *          logo, minimise, move, ⋮ and close; session search and sort; the session cards; and at the
 *          bottom "View in dashboard ↗" and "Create session". Everything else opens in the main
 *          window through the shell. Opened anywhere but a desktop app from 1.1.0, it goes to the
 *          dashboard. Also offers the accurate-transcription download once (never starts it itself).
 * Used by: app/home/page.tsx
 * Depends on: src/core/storage (sessions.ts, hintPrefs.ts, types), src/features/appearance/useAppearance,
 *             src/features/home (HomeCard, HomeMenu), src/features/notices/AcceptableUseNotice.tsx,
 *             src/platform, src/ui (BrandLockup, Button, Input styles, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §7.3; ADR-0041
 *
 * The header is the frameless window's drag handle; its buttons opt out. Session text is shown on
 * screen only; it is never logged.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  deleteSession,
  duplicateSession,
  sortSessions,
  updateSession,
  watchSessions,
  type SessionSort,
} from '@/core/storage/sessions';
import type { Session } from '@/core/storage/types';
import { useAppearance } from '@/features/appearance/useAppearance';
import { AcceptableUseNotice } from '@/features/notices/AcceptableUseNotice';
import { getPlatform } from '@/platform';
import { BrandLockup } from '@/ui/BrandLockup';
import { Button } from '@/ui/Button';
import {
  CloseIcon,
  MinusIcon,
  MoreIcon,
  MoveIcon,
  OutIcon,
  PlusIcon,
  SearchIcon,
  SortIcon,
} from '@/ui/icons';
import { AccurateOffer } from './AccurateOffer';
import { homeCardDescription, homeCardTitle, HomeCard } from './HomeCard';
import { HomeMenu } from './HomeMenu';

/** Props for HomePanel. */
export interface HomePanelProps {
  /** The signed-in person's name. */
  name: string;
  /** Their email. */
  email: string;
}

/** A button in the header: not part of the drag handle, always a clear focus ring. */
const HEADER_BUTTON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-control border border-ui-border text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]';

/**
 * Nothing to subscribe to: the platform does not change while the page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this app has the home panel. Server render: yes, so a desktop app paints it at once.
 *
 * @returns True in a desktop app from 1.1.0.
 */
const hasPanel = () => getPlatform().hasHomePanel();

/**
 * The home panel.
 *
 * @param props See HomePanelProps.
 * @returns The panel.
 * Rendered by: app/home/page.tsx
 */
export function HomePanel({ name, email }: HomePanelProps) {
  const router = useRouter();
  const available = useSyncExternalStore(subscribeNever, hasPanel, () => true);
  const { theme, resolved, zoom } = useAppearance();
  // null while loading; the list as stored on this computer otherwise.
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SessionSort>('newest');
  const [menuOpen, setMenuOpen] = useState(false);
  // Fixed per list, so every card judges "live for over 12 hours" the same way.
  const [now, setNow] = useState(0);

  // A press anywhere else, or Escape, closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest?.('[data-menu="home"]') || target.closest?.('[aria-label="Menu"]')) return;
      setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Anywhere but a desktop app from 1.1.0 this page has no window of its own.
  useEffect(() => {
    if (!available) router.replace('/');
  }, [available, router]);

  useEffect(
    () =>
      watchSessions(
        (rows) => {
          setSessions(rows);
          setNow(Date.now());
        },
        () => setFailed(true),
      ),
    [],
  );

  const shown = useMemo(() => {
    const words = search.trim().toLowerCase();
    const matching = (sessions ?? []).filter(
      (session) =>
        words === '' ||
        `${homeCardTitle(session)} ${homeCardDescription(session)}`.toLowerCase().includes(words),
    );
    return sortSessions(matching, sort);
  }, [sessions, search, sort]);

  /**
   * Opens a page in the main window.
   *
   * @param path The page's path.
   * @returns Nothing.
   */
  const open = (path: string) => getPlatform().openPagesWindow(path);

  /** What a card can do. */
  const actions = {
    onStart: (session: Session) => open(`/live/${session.id}`),
    onView: (session: Session) => open(`/sessions/${session.id}`),
    onEdit: (session: Session) => open(`/sessions/${session.id}/edit`),
    onRename: async (session: Session, company: string, role: string) => {
      await updateSession(session.id, { company, role });
    },
    onDuplicate: async (session: Session) => {
      await duplicateSession(session.id);
    },
    onDelete: async (session: Session) => {
      await deleteSession(session.id);
    },
  };

  return (
    <div
      className={`${resolved === 'dark' ? 'k-dark' : 'k-light'} relative flex h-screen flex-col overflow-hidden bg-ui-bg text-ui-text`}
    >
      <AcceptableUseNotice />
      <header className="flex shrink-0 items-center gap-1.5 px-3 py-2 [-webkit-app-region:drag]">
        <span className="min-w-0 flex-1">
          <BrandLockup tone={resolved === 'dark' ? 'dark' : 'light'} size="sm" byline={false} />
        </span>
        <button
          type="button"
          className={HEADER_BUTTON}
          aria-label="Minimise"
          onClick={() => getPlatform().windowControl('minimize')}
        >
          <MinusIcon />
        </button>
        {/* The whole header drags the window; this is where people look for it. */}
        <span
          role="img"
          aria-label="Drag here to move"
          className="inline-flex size-8 shrink-0 cursor-move items-center justify-center rounded-control border border-ui-border text-ui-text"
        >
          <MoveIcon />
        </span>
        <button
          type="button"
          className={HEADER_BUTTON}
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((was) => !was)}
        >
          <MoreIcon />
        </button>
        <button
          type="button"
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control bg-ui-end text-ui-on-end hover:opacity-90 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
          aria-label="Close"
          onClick={() => getPlatform().windowControl('close')}
        >
          <CloseIcon />
        </button>
        {menuOpen && (
          <HomeMenu
            name={name}
            email={email}
            theme={theme}
            zoom={zoom}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </header>

      <div className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-control border border-ui-border bg-ui-input px-2.5 text-ui-muted focus-within:border-ui-link">
          <SearchIcon />
          <input
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ui-text placeholder:text-ui-muted focus:outline-none"
            placeholder="Search by title or description"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={HEADER_BUTTON.replace('size-8', 'size-9')}
          aria-label={sort === 'newest' ? 'Sorted newest first' : 'Sorted oldest first'}
          onClick={() => setSort((was) => (was === 'newest' ? 'oldest' : 'newest'))}
        >
          <SortIcon />
        </button>
      </div>

      <AccurateOffer />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {failed ? (
          <p role="alert" className="p-4 text-[14px] text-ui-danger">
            Kite could not read your sessions on this computer. Reopen it and try again.
          </p>
        ) : sessions === null ? (
          <p className="p-4 text-[14px] text-ui-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-1 p-8 text-center">
            <p className="text-[15px] font-semibold text-ui-heading">
              {sessions.length === 0 ? 'No sessions yet' : 'Nothing matches that'}
            </p>
            <p className="text-[13px] text-ui-muted">
              {sessions.length === 0
                ? 'Create a session to get ready for a call.'
                : 'Try other words, or clear the search.'}
            </p>
          </div>
        ) : (
          <ul aria-label="Sessions" className="flex flex-col gap-2">
            {shown.map((session) => (
              <HomeCard key={session.id} session={session} now={now} {...actions} />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex shrink-0 gap-2 border-t border-ui-border p-3">
        <Button variant="secondary" className="min-w-0 flex-1 px-2" onClick={() => open('/')}>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            View in dashboard <OutIcon />
          </span>
        </Button>
        <Button className="min-w-0 flex-1 px-2" onClick={() => open('/sessions/new')}>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <PlusIcon /> Create session
          </span>
        </Button>
      </footer>
    </div>
  );
}
