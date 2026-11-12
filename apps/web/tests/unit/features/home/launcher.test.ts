/**
 * Tests for apps/web/src/features/home/LauncherSessions.tsx (launcherOrder, launcherSearch) and Launcher.tsx
 * (lastEndedCall): the desktop sessions card lists every session newest first with the browser's
 * session on top, and offers the notes of a call that ended in the last 2 hours (ADR-0055); ADR-0071:
 * the search (title, role or topic, description) and the sort. 1.6.1 (initialLauncherView,
 * shownLauncherView): the browser's Start opens that session's Start card, and falls back to the
 * sessions only when the session is gone or not in the account (ADR-0073: an ended one starts again).
 */
import { describe, expect, it } from 'vitest';
import type { Session } from '@/core/storage/types';
import {
  initialLauncherView,
  LAST_CALL_MS,
  lastEndedCall,
  shownLauncherView,
} from '@/features/home/Launcher';
import { launcherOrder, launcherSearch } from '@/features/home/LauncherSessions';

/**
 * An invented session.
 *
 * @param id        Its id.
 * @param createdAt When it was made.
 * @param extra     Other fields.
 * @returns The session.
 */
function session(id: string, createdAt: number, extra: Partial<Session> = {}): Session {
  return {
    id,
    createdAt,
    type: 'interview',
    company: `Company ${id}`,
    role: 'Analyst',
    status: 'not-started',
    ...extra,
  } as Session;
}

describe('launcherOrder', () => {
  it('lists every session newest first', () => {
    const rows = [session('a', 1), session('b', 3), session('c', 2, { status: 'ended' })];
    expect(launcherOrder(rows, null).map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts the session from the browser first', () => {
    const rows = [session('a', 1), session('b', 3), session('c', 2)];
    expect(launcherOrder(rows, 'a').map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores a browser session this computer does not have', () => {
    const rows = [session('a', 1), session('b', 3)];
    expect(launcherOrder(rows, 'zzz').map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('orders by the chosen sort, keeping the browser session first', () => {
    const rows = [
      session('a', 1, { company: 'Birch' }),
      session('b', 3, { company: 'Cedar' }),
      session('c', 2, { company: 'Alder' }),
    ];
    expect(launcherOrder(rows, null, 'oldest').map((row) => row.id)).toEqual(['a', 'c', 'b']);
    expect(launcherOrder(rows, null, 'company').map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(launcherOrder(rows, 'b', 'company').map((row) => row.id)).toEqual(['b', 'c', 'a']);
  });

  it('shows only the sessions matching the search, the browser session included only if it matches', () => {
    const rows = [
      session('a', 1, { company: 'Birch', description: '' }),
      session('b', 3, { company: 'Cedar', description: '' }),
    ];
    expect(launcherOrder(rows, 'b', 'newest', 'birch').map((row) => row.id)).toEqual(['a']);
  });
});

describe('launcherSearch', () => {
  const rows = [
    session('a', 1, { company: 'Northwind', role: 'Data Analyst', description: '' }),
    session('b', 2, {
      type: 'regular',
      company: 'Harbor',
      role: 'Quarterly review',
      description: 'Pricing for the renewal',
    }),
  ];

  it('matches the title, the role or topic line and the description, ignoring case', () => {
    expect(launcherSearch(rows, 'NORTH').map((row) => row.id)).toEqual(['a']);
    expect(launcherSearch(rows, 'analyst').map((row) => row.id)).toEqual(['a']);
    expect(launcherSearch(rows, 'quarterly').map((row) => row.id)).toEqual(['b']);
    expect(launcherSearch(rows, 'renewal').map((row) => row.id)).toEqual(['b']);
  });

  it('keeps every session for an empty or blank search', () => {
    expect(launcherSearch(rows, '  ')).toHaveLength(2);
  });
});

describe('lastEndedCall', () => {
  const now = 10 * LAST_CALL_MS;

  it('offers the most recent call that ended in the last 2 hours', () => {
    const rows = [
      session('old', 1, { status: 'ended', lastActiveAt: now - LAST_CALL_MS - 1 }),
      session('recent', 2, { status: 'ended', lastActiveAt: now - 60_000 }),
      session('earlier', 3, { status: 'ended', lastActiveAt: now - 120_000 }),
      session('ready', 4),
    ];
    expect(lastEndedCall(rows, now)?.id).toBe('recent');
  });

  it('offers nothing when no call ended recently', () => {
    expect(lastEndedCall([session('ready', 1, { createdAt: now })], now)).toBeNull();
  });
});

describe('the first card (1.6.1)', () => {
  it('opens on the Start card of the session the browser’s Start named, else on the sessions', () => {
    expect(initialLauncherView('abc')).toEqual({ kind: 'start', sessionId: 'abc' });
    expect(initialLauncherView(undefined)).toEqual({ kind: 'sessions' });
  });

  it('keeps the chosen card while the link’s session can be started (also while the list loads)', () => {
    const start = { kind: 'start', sessionId: 'abc' } as const;
    expect(shownLauncherView(start, 'abc', 'ok')).toEqual(start);
    // Another session's card is never affected by the link's session.
    const other = { kind: 'connect', sessionId: 'xyz' } as const;
    expect(shownLauncherView(other, 'abc', 'missing')).toEqual(other);
  });

  it('goes back to the sessions only when the link’s session is gone or not in the account', () => {
    const start = { kind: 'start', sessionId: 'abc' } as const;
    expect(shownLauncherView(start, 'abc', 'missing')).toEqual({ kind: 'sessions' });
    // ADR-0073: an ended session starts again, so its link keeps the Start card ('ok').
  });
});
