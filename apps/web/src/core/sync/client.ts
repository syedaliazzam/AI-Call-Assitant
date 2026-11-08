/**
 * File: apps/web/src/core/sync/client.ts
 * Purpose: When account sync runs (ADR-0049). Pushes: 2 s after a change; transcript lines in
 *          batches every 15 s or 50 lines; never while an answer streams (they wait for it); retried
 *          with backoff (2 s up to 60 s) after a failure; one push at a time across this browser's
 *          tabs and windows (a Web Lock). Pulls: on start, when the window gets focus or becomes
 *          visible, when the network comes back, and after a push that met newer data; there is NO
 *          background polling. On End of a call the outbox is flushed; when the page closes, one
 *          last small push is sent with keepalive. A local check every 30 s pushes changes made in
 *          another window of this app (the overlay) without asking the server anything.
 * Used by: src/features/sync/SyncScope.tsx (start/stop), src/features/live/LivePage.tsx (End),
 *          src/core/storage/wipe.ts (Delete all my data)
 * Depends on: dexie, src/core/storage/{db,wipe}.ts, src/core/sync/{engine,capture,foreground,prefsSignal}.ts
 * Architecture: ADR-0049
 */
import Dexie from 'dexie';
import { DB_NAME, getDb, usingAccountDatabase } from '../storage/db';
import { deleteAllLocalData, type DeletedCounts } from '../storage/wipe';
import { onLocalChange } from './capture';
import { httpTransport, pullAll, pushOnce, type SyncTransport } from './engine';
import { answerStreaming, whenNoAnswerStreams } from './foreground';
import { onAccountPrefChange } from './prefsSignal';

/** Wait after an ordinary change before pushing, ms (changes close together go in one push). */
export const CHANGE_DELAY_MS = 2_000;

/** Longest wait for transcript lines before they are pushed, ms. */
export const LINES_EVERY_MS = 15_000;

/** Lines that are pushed at once, without waiting. */
export const LINES_BATCH = 50;

/** Backoff after a failed push: first and longest wait, ms. */
export const BACKOFF_MS = { first: 2_000, max: 60_000 } as const;

/** How often the outbox is checked locally for changes made in another window, ms. */
export const LOCAL_CHECK_MS = 30_000;

/** Body limit for the push sent while the page closes (keepalive allows 64 KB in flight). */
const KEEPALIVE_BYTES = 60_000;

/** The running sync, or null when it is off (no account sync, or not started). */
interface Running {
  /** Pushes everything now (End of a call). */
  flushNow(): Promise<void>;
  /** Pulls now. */
  pullNow(): Promise<void>;
  /** Stops timers and listeners. */
  stop(): void;
}

/** The running sync of this page. */
let running: Running | null = null;

/** What sync listens on: the window (focus, online, pagehide), or a test stand-in. */
export interface SyncEventTarget {
  /**
   * Adds a listener.
   *
   * @param type     The event.
   * @param listener The listener.
   */
  addEventListener(type: string, listener: () => void): void;
  /**
   * Removes a listener.
   *
   * @param type     The event.
   * @param listener The listener.
   */
  removeEventListener(type: string, listener: () => void): void;
  /** Whether the browser thinks it is online (the window's navigator). */
  navigator?: {
    /** False when offline. */
    onLine: boolean;
  };
}

/** Optional replacements for tests. */
export interface SyncClientOptions {
  /** The server (default: the real routes). */
  transport?: SyncTransport;
  /** The window to listen on (default: the page's). */
  target?: SyncEventTarget;
}

/**
 * Runs an action under this browser's sync lock (one push at a time across tabs and windows), or
 * directly where Web Locks do not exist.
 *
 * @param action What to run.
 * @returns What it returns.
 */
async function withPushLock<T>(action: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return action();
  return locks.request('kite.sync-push', action) as Promise<T>;
}

/**
 * Starts account sync for this page. Does nothing unless an account's cache is selected (the
 * account has account sync).
 *
 * @param options Test replacements.
 * @returns Stops it.
 * Called from: SyncScope.tsx (once per page)
 */
export function startAccountSync(options: SyncClientOptions = {}): () => void {
  if (!usingAccountDatabase()) return () => undefined;
  running?.stop();
  const transport = options.transport ?? httpTransport;
  const target: SyncEventTarget | undefined = options.target ?? globalThis.window;
  const online = () => (target?.navigator ?? globalThis.navigator)?.onLine !== false;

  let stopped = false;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let linesTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingLines = 0;
  let backoff = 0;
  let pushing: Promise<void> | null = null;
  let pulling: Promise<void> | null = null;
  let cancelWait: (() => void) | null = null;
  const attempts = new Map<string, number>();

  /**
   * Pushes until the outbox is empty, or until a failure (then retries later).
   *
   * @returns When this push (or the one already running) has finished.
   */
  const push = (): Promise<void> => {
    if (stopped || !online()) return Promise.resolve();
    if (pushing) return pushing;
    if (answerStreaming()) {
      // Never compete with an answer for the network: push once it has finished.
      cancelWait?.();
      cancelWait = whenNoAnswerStreams(() => schedule(0));
      return Promise.resolve();
    }
    pushing = (async () => {
      try {
        let pullNeeded = false;
        await withPushLock(async () => {
          for (let round = 0; round < 20 && !stopped; round += 1) {
            const done = await pushOnce(getDb(), transport, { attempts });
            pullNeeded ||= done.pullNeeded;
            if (!done.more) break;
            if (answerStreaming()) {
              schedule(0);
              break;
            }
          }
        });
        backoff = 0;
        pendingLines = 0;
        if (pullNeeded) await pull();
      } catch {
        backoff = backoff === 0 ? BACKOFF_MS.first : Math.min(BACKOFF_MS.max, backoff * 2);
        console.warn('sync: push failed, retrying', { inMs: backoff });
        schedule(backoff);
      } finally {
        pushing = null;
      }
    })();
    return pushing;
  };

  /**
   * Pulls the account's changes (one pull at a time).
   *
   * @returns When the pull has finished (a failure is logged and tried again later).
   */
  const pull = (): Promise<void> => {
    if (stopped || !online()) return Promise.resolve();
    pulling ??= pullAll(getDb(), transport)
      .then(() => undefined)
      .catch(() => console.warn('sync: pull failed'))
      .finally(() => {
        pulling = null;
      });
    return pulling;
  };

  /**
   * Pushes after a wait (a newer schedule replaces an older one).
   *
   * @param delay ms.
   */
  function schedule(delay: number): void {
    if (stopped) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(
      () => {
        pushTimer = null;
        void push();
      },
      Math.max(delay, 0),
    );
  }

  onLocalChange((store) => {
    if (store !== 'utterances') {
      schedule(CHANGE_DELAY_MS);
      return;
    }
    // Lines arrive all through a call: send them in batches, not one by one.
    pendingLines += 1;
    if (pendingLines >= LINES_BATCH) {
      schedule(0);
    } else {
      linesTimer ??= setTimeout(() => {
        linesTimer = null;
        schedule(0);
      }, LINES_EVERY_MS);
    }
  });
  onAccountPrefChange(() => {
    void getDb()
      .syncMeta.put({ id: 'prefs', value: Date.now() })
      .then(() => schedule(CHANGE_DELAY_MS));
  });

  const onFocus = () => void pull();
  const onVisible = () => {
    if (globalThis.document?.visibilityState === 'visible') void pull().then(() => schedule(0));
  };
  const onOnline = () => void pull().then(() => schedule(0));
  const onPageHide = () => {
    // The page is closing: one small push, sent so it can finish after the page is gone. Anything
    // that does not fit stays in the outbox for the next visit.
    if (!online() || answerStreaming()) return;
    void pushOnce(getDb(), transport, {
      maxBytes: KEEPALIVE_BYTES,
      keepalive: true,
      attempts,
    }).catch(() => undefined);
  };
  target?.addEventListener('focus', onFocus);
  target?.addEventListener('online', onOnline);
  target?.addEventListener('pagehide', onPageHide);
  globalThis.document?.addEventListener('visibilitychange', onVisible);
  // Local only: changes made in another window of this app (the overlay) are pushed from here.
  const localCheck = setInterval(() => {
    void Promise.all([getDb().outbox.count(), getDb().syncMeta.get('prefs')]).then(
      ([waiting, prefs]) => {
        if ((waiting > 0 || prefs) && !pushTimer && !pushing) schedule(0);
      },
    );
  }, LOCAL_CHECK_MS);

  const state: Running = {
    flushNow: async () => {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      await push();
    },
    pullNow: pull,
    stop: () => {
      stopped = true;
      if (pushTimer) clearTimeout(pushTimer);
      if (linesTimer) clearTimeout(linesTimer);
      clearInterval(localCheck);
      cancelWait?.();
      onLocalChange(null);
      onAccountPrefChange(null);
      target?.removeEventListener('focus', onFocus);
      target?.removeEventListener('online', onOnline);
      target?.removeEventListener('pagehide', onPageHide);
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
      if (running === state) running = null;
    },
  };
  running = state;
  void pull().then(() => schedule(0));
  return state.stop;
}

/**
 * Pushes every waiting change now (End of a call: the call's last lines and answers reach the
 * account before the page may close). Does nothing without account sync.
 *
 * @returns When the push has finished or failed (a failure is retried later).
 * Called from: LivePage.tsx (end)
 */
export function flushAccountSync(): Promise<void> {
  return running?.flushNow() ?? Promise.resolve();
}

/**
 * Pulls the account's changes now, even before sync has started on this page. Does nothing without
 * account sync.
 *
 * @returns When the pull has finished.
 * Called from: StartSessionCard.tsx (a link's session made a moment ago in the browser, ADR-0052)
 */
export async function pullAccountSync(): Promise<void> {
  if (running) return running.pullNow();
  // Sync may not have started yet on this page (a child's effect runs before its parent's).
  if (!usingAccountDatabase()) return;
  await pullAll(getDb(), httpTransport).catch(() => undefined);
}

/**
 * Whether account sync runs on this page.
 *
 * @returns True between startAccountSync() and its stop.
 * Called from: features that word things differently with account sync (Settings)
 */
export function accountSyncRunning(): boolean {
  return running !== null;
}

/**
 * Deletes everything this account has synced, on the server (so on every device signed in to it),
 * then this device's cache and this device's own pre-sync data ('kite'). The server step comes first:
 * when it fails, nothing is deleted and the error is thrown.
 *
 * @param transport The server (tests pass a fake).
 * @returns How many rows this device's cache had.
 * @throws SyncHttpError or a network error when the server could not delete (nothing was deleted).
 * Called from: Settings.tsx ("Delete all my data", with account sync)
 */
export async function deleteAllAccountData(
  transport: SyncTransport = httpTransport,
): Promise<DeletedCounts> {
  await transport.push([{ op: 'deleteAll' }]);
  const counts = await deleteAllLocalData();
  // This device's data from before account sync: the same person asked for everything to go.
  await Dexie.delete(DB_NAME);
  return counts;
}
