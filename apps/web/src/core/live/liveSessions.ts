/**
 * File: apps/web/src/core/live/liveSessions.ts
 * Purpose: Which of the account's sessions are live on another device now (ADR-0098), for the session cards
 *          (dashboard, desktop app) and Meetings: "Live on another device", Start disabled, Take over. One
 *          store per page: it asks GET /api/live-lock while something listens, every POLL_MS while the page
 *          is visible and focused, and at once when it gains focus, becomes visible or comes back online.
 *          A page in the background asks nothing (the free database can sleep); a click needs focus, and
 *          focus asks first, so what a click acts on is fresh, and the server refuses a start anyway.
 * Used by: src/features/live/useLiveElsewhere.ts; tests/unit/core/live/liveSessions.test.ts
 * Depends on: @kite/shared (ACCOUNT_HEADER, DEVICE_HEADER, LiveSessionsReply), ./deviceId.ts,
 *             ../storage/accountScope.ts; fetch and the page's events (injectable for tests)
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
import { ACCOUNT_HEADER, DEVICE_HEADER, type LiveSessionsReply } from '@kite/shared';
import { currentAccountId } from '../storage/accountScope';
import { thisDeviceId } from './deviceId';

/** How often a visible, focused page asks, ms. */
export const POLL_MS = 20_000;

/** The set when nothing is live elsewhere (one shared object, so React sees no change). */
const NONE: ReadonlySet<string> = new Set();

/** What the store uses (the page's own objects by default). */
export interface LiveSessionsDeps {
  /** fetch. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** This device's id. */
  deviceId: () => string;
  /** The page's account id, or null. */
  accountId: () => string | null;
  /** True while the page is visible and has focus. */
  looking: () => boolean;
  /** Listens for focus, visibility and network changes; returns a function that stops listening. */
  onWake: (run: () => void) => () => void;
  /** Timers. */
  setInterval: (run: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Stops a timer. */
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
}

/**
 * The page's own objects.
 *
 * @returns Default dependencies.
 * Called from: liveSessions (the page's store)
 */
export function defaultLiveSessionsDeps(): LiveSessionsDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    deviceId: () => thisDeviceId(),
    accountId: () => currentAccountId(),
    looking: () =>
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      document.hasFocus(),
    onWake: (run) => {
      if (typeof window === 'undefined') return () => undefined;
      const visible = () => {
        if (document.visibilityState === 'visible') run();
      };
      window.addEventListener('focus', run);
      window.addEventListener('online', run);
      document.addEventListener('visibilitychange', visible);
      return () => {
        window.removeEventListener('focus', run);
        window.removeEventListener('online', run);
        document.removeEventListener('visibilitychange', visible);
      };
    },
    setInterval: (run, ms) => globalThis.setInterval(run, ms),
    clearInterval: (timer) => globalThis.clearInterval(timer),
  };
}

/** The store. */
export interface LiveSessionsStore {
  /** Listens for changes (and starts asking with the first listener); returns a function that stops. */
  subscribe: (listener: () => void) => () => void;
  /** The sessions live on another device now (the same object until it changes). */
  snapshot: () => ReadonlySet<string>;
  /** Asks the server now (after a refused start, so the cards catch up at once). */
  refresh: () => Promise<void>;
}

/**
 * Makes a store.
 *
 * @param deps See LiveSessionsDeps.
 * @returns The store.
 * Called from: this module (the page's store); tests
 */
export function createLiveSessionsStore(deps: LiveSessionsDeps): LiveSessionsStore {
  const listeners = new Set<() => void>();
  let elsewhere: ReadonlySet<string> = NONE;
  let stopTimer: (() => void) | null = null;
  let stopWake: (() => void) | null = null;
  let asking = false;

  const refresh = async () => {
    if (asking) return;
    asking = true;
    try {
      const account = deps.accountId();
      const response = await deps.fetch('/api/live-lock', {
        cache: 'no-store',
        headers: {
          [DEVICE_HEADER]: deps.deviceId(),
          ...(account ? { [ACCOUNT_HEADER]: account } : {}),
        },
      });
      // A failed ask keeps what was known: the server still refuses a start that is not allowed.
      if (!response.ok) return;
      const reply = (await response.json()) as Partial<LiveSessionsReply>;
      if (!Array.isArray(reply.live)) return;
      const next = new Set(
        reply.live.filter((entry) => entry && !entry.here).map((entry) => entry.sessionId),
      );
      const same = next.size === elsewhere.size && [...next].every((id) => elsewhere.has(id));
      if (same) return;
      elsewhere = next.size === 0 ? NONE : next;
      for (const listener of [...listeners]) listener();
    } catch {
      // Offline: as above.
    } finally {
      asking = false;
    }
  };

  const start = () => {
    void refresh();
    const timer = deps.setInterval(() => {
      if (deps.looking()) void refresh();
    }, POLL_MS);
    stopTimer = () => deps.clearInterval(timer);
    stopWake = deps.onWake(() => void refresh());
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopTimer?.();
        stopWake?.();
        stopTimer = null;
        stopWake = null;
      };
    },
    snapshot: () => elsewhere,
    refresh,
  };
}

/** The page's store, made on first use (never on the server). */
let pageStore: LiveSessionsStore | null = null;

/**
 * The page's store.
 *
 * @returns The store shared by every card of the page.
 * Called from: useLiveElsewhere.ts, LivePage.tsx (refresh after a refused start)
 */
export function liveSessions(): LiveSessionsStore {
  pageStore ??= createLiveSessionsStore(defaultLiveSessionsDeps());
  return pageStore;
}

/** The empty set, for the server's render. */
export const NO_LIVE_SESSIONS = NONE;
