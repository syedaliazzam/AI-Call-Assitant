/**
 * File: apps/web/src/core/live/liveLock.ts
 * Purpose: This device's side of the live-call lock (ADR-0098): a session's call runs on one device at a
 *          time. A call's Connect takes the session's lock on the server (startLiveLock; refused while
 *          another device runs it, unless the person chose Take over), keepLiveLock() sends the heartbeat
 *          every 15 s and reports when another device took the call over, and End releases it. Also the
 *          small notes between this app's windows: the "Take over" choice (left by a session card or the
 *          Connect card, taken by the live page's Connect), and "this call was moved" (for the desktop app's
 *          small window). Only ids travel; never call text.
 * Used by: src/features/live/LivePage.tsx (start, keep, end, the take-over note), src/features/dashboard,
 *          src/features/home (leaveTakeOver, watchCallMoved); tests/unit/core/live/liveLock.test.ts
 * Depends on: @kite/shared (liveLock.ts, ACCOUNT_HEADER), ./deviceId.ts, ../storage/accountScope.ts;
 *             fetch, localStorage and BroadcastChannel (all injectable for tests)
 * Architecture: docs/decisions/ADR-0098-live-call-lock.md
 */
import {
  ACCOUNT_HEADER,
  LIVE_ELSEWHERE_CODE,
  LIVE_LOCK_HEARTBEAT_MS,
  type LiveLockReply,
  type LiveLockRequest,
} from '@kite/shared';
import { currentAccountId } from '../storage/accountScope';
import { thisDeviceId } from './deviceId';

/** The route. */
export const LIVE_LOCK_PATH = '/api/live-lock';

/** The longest a start waits for the server, ms: Connect must still open the overlay inside the click. */
export const START_TIMEOUT_MS = 3_000;

/** The localStorage key of the "Take over" note. */
export const TAKE_OVER_KEY = 'kite-take-over';

/** How long a "Take over" note is good for, ms (time to pick the audio source and press Connect). */
export const TAKE_OVER_TTL_MS = 10 * 60_000;

/** The BroadcastChannel that says a call was moved to another device. */
export const CALL_MOVED_CHANNEL = 'kite-call-moved';

/** What this module uses (the page's own objects by default). */
export interface LiveLockDeps {
  /** fetch. */
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /** This device's id. */
  deviceId: () => string;
  /** The page's account id, or null. */
  accountId: () => string | null;
  /** localStorage, or null where it is blocked. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Opens the "moved" channel, or null where BroadcastChannel is missing. */
  openChannel:
    | (() => Pick<
        BroadcastChannel,
        'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'
      >)
    | null;
  /** The clock, ms. */
  now: () => number;
  /** Timers (tests pass fakes). */
  setInterval: (run: () => void, ms: number) => ReturnType<typeof setInterval>;
  /** Stops a timer. */
  clearInterval: (timer: ReturnType<typeof setInterval>) => void;
}

/**
 * The page's own objects.
 *
 * @returns Default dependencies.
 * Called from: the functions below (default argument)
 */
export function defaultLiveLockDeps(): LiveLockDeps {
  let storage: LiveLockDeps['storage'] = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    // Blocked storage: Take over from a card then needs the Connect card's own Take over.
    storage = null;
  }
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    deviceId: () => thisDeviceId(),
    accountId: () => currentAccountId(),
    storage,
    openChannel:
      typeof BroadcastChannel === 'function'
        ? () => new BroadcastChannel(CALL_MOVED_CHANNEL)
        : null,
    now: () => Date.now(),
    setInterval: (run, ms) => globalThis.setInterval(run, ms),
    clearInterval: (timer) => globalThis.clearInterval(timer),
  };
}

/**
 * Sends one request to the route.
 *
 * @param body      The request.
 * @param deps      See LiveLockDeps.
 * @param extra     More fetch options (a timeout signal, keepalive).
 * @returns The response, or null when the server could not be reached.
 */
async function send(
  body: LiveLockRequest,
  deps: LiveLockDeps,
  extra: RequestInit = {},
): Promise<Response | null> {
  const account = deps.accountId();
  try {
    return await deps.fetch(LIVE_LOCK_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The server refuses a page opened for another account than the one signed in now.
        ...(account ? { [ACCOUNT_HEADER]: account } : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      ...extra,
    });
  } catch {
    return null;
  }
}

/** How a start went: held, refused because another device runs the session, or not known (no answer). */
export type LiveLockStart = 'held' | 'elsewhere' | 'unknown';

/**
 * Takes the session's lock for a call (Connect, and a Reconnect of the same call).
 * Only a refusal from the server stops a call: with no answer (offline, an error, slower than
 * START_TIMEOUT_MS) the call starts, and its heartbeats take the lock once the server is reached.
 *
 * @param sessionId The session.
 * @param callId    The call.
 * @param takeOver  True after the person confirmed "Take over".
 * @param deps      See LiveLockDeps.
 * @returns 'held', 'elsewhere' (409 live_elsewhere) or 'unknown'.
 * Called from: LivePage connect()
 */
export async function startLiveLock(
  sessionId: string,
  callId: string,
  takeOver: boolean,
  deps = defaultLiveLockDeps(),
): Promise<LiveLockStart> {
  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? { signal: AbortSignal.timeout(START_TIMEOUT_MS) }
      : {};
  const response = await send(
    { action: 'start', sessionId, callId, deviceId: deps.deviceId(), takeOver },
    deps,
    signal,
  );
  if (!response) return 'unknown';
  if (response.ok) return 'held';
  if (response.status === 409) {
    try {
      const failure = (await response.json()) as { code?: unknown };
      if (failure.code === LIVE_ELSEWHERE_CODE) return 'elsewhere';
    } catch {
      // Not our JSON: not known.
    }
  }
  return 'unknown';
}

/**
 * One heartbeat.
 *
 * @param sessionId The session.
 * @param callId    The call.
 * @param deps      See LiveLockDeps.
 * @returns The server's state, or 'unknown' with no answer.
 * Called from: keepLiveLock()
 */
export async function beatLiveLock(
  sessionId: string,
  callId: string,
  deps = defaultLiveLockDeps(),
): Promise<LiveLockReply['state'] | 'unknown'> {
  const response = await send(
    { action: 'beat', sessionId, callId, deviceId: deps.deviceId() },
    deps,
  );
  if (!response?.ok) return 'unknown';
  try {
    const reply = (await response.json()) as Partial<LiveLockReply>;
    return reply.state === 'held' || reply.state === 'moved' || reply.state === 'released'
      ? reply.state
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Releases the session's lock at End (or when a call that never ran gives it back). Not awaited by
 * callers; keepalive lets it finish when the window closes right after End.
 *
 * @param sessionId The session.
 * @param callId    The call.
 * @param deps      See LiveLockDeps.
 * Called from: LivePage end() and connect() (a capture that failed)
 */
export function endLiveLock(sessionId: string, callId: string, deps = defaultLiveLockDeps()): void {
  void send({ action: 'end', sessionId, callId }, deps, { keepalive: true });
}

/** A running call's heartbeat. */
export interface LiveLockKeeper {
  /** Stops the heartbeat (End, or the page goes). */
  stop: () => void;
}

/**
 * Sends the call's heartbeat every LIVE_LOCK_HEARTBEAT_MS until stopped, and once more when the network
 * comes back. A heartbeat with no answer changes nothing (the next one tries again; the server lets the
 * lock expire after 90 s without one). When the server says another device took the call over, the
 * heartbeat stops and onMoved runs once.
 *
 * @param sessionId The session.
 * @param callId    The call.
 * @param onMoved   Ends the call here ("This call was moved to another device").
 * @param deps      See LiveLockDeps.
 * @returns The keeper.
 * Called from: LivePage connect()
 */
export function keepLiveLock(
  sessionId: string,
  callId: string,
  onMoved: () => void,
  deps = defaultLiveLockDeps(),
): LiveLockKeeper {
  let stopped = false;
  let busy = false;
  const beat = async () => {
    if (stopped || busy) return;
    busy = true;
    const state = await beatLiveLock(sessionId, callId, deps);
    busy = false;
    if (stopped || state !== 'moved') return;
    stop();
    onMoved();
  };
  const timer = deps.setInterval(() => void beat(), LIVE_LOCK_HEARTBEAT_MS);
  const online = () => void beat();
  globalThis.addEventListener?.('online', online);
  function stop() {
    if (stopped) return;
    stopped = true;
    deps.clearInterval(timer);
    globalThis.removeEventListener?.('online', online);
  }
  return { stop };
}

/**
 * Leaves the "Take over" choice for the session's next Connect (on this device, in any of its windows).
 *
 * @param sessionId The session.
 * @param deps      See LiveLockDeps.
 * Called from: the session cards' and the Connect card's take-over dialogs
 */
export function leaveTakeOver(sessionId: string, deps = defaultLiveLockDeps()): void {
  try {
    deps.storage?.setItem(TAKE_OVER_KEY, JSON.stringify({ sessionId, at: deps.now() }));
  } catch {
    // Full or blocked storage: the Connect card offers Take over again if the start is refused.
  }
}

/**
 * Takes the "Take over" choice for this session, once: true when it was left within TAKE_OVER_TTL_MS. A note
 * for this session is removed, so it takes over one call only.
 *
 * @param sessionId The live page's session.
 * @param deps      See LiveLockDeps.
 * @returns True when Connect should take the call over.
 * Called from: LivePage connect()
 */
export function takeTakeOver(sessionId: string, deps = defaultLiveLockDeps()): boolean {
  try {
    const raw = deps.storage?.getItem(TAKE_OVER_KEY);
    if (!raw) return false;
    const note = JSON.parse(raw) as { sessionId?: unknown; at?: unknown };
    if (note.sessionId !== sessionId) return false;
    deps.storage?.removeItem(TAKE_OVER_KEY);
    return (
      typeof note.at === 'number' &&
      note.at <= deps.now() &&
      deps.now() - note.at <= TAKE_OVER_TTL_MS
    );
  } catch {
    return false;
  }
}

/**
 * Tells this app's other windows that a call here was moved to another device (the desktop app's small
 * window shows it, as the call window closes).
 *
 * @param deps See LiveLockDeps.
 * Called from: LivePage (when the heartbeat says moved)
 */
export function announceCallMoved(deps = defaultLiveLockDeps()): void {
  const channel = deps.openChannel?.();
  if (!channel) return;
  channel.postMessage({ type: 'moved' });
  channel.close();
}

/**
 * Listens for "a call was moved to another device".
 *
 * @param onMoved Called each time.
 * @param deps    See LiveLockDeps.
 * @returns Stops listening.
 * Called from: Launcher.tsx
 */
export function watchCallMoved(onMoved: () => void, deps = defaultLiveLockDeps()): () => void {
  const channel = deps.openChannel?.();
  if (!channel) return () => undefined;
  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data as { type?: unknown } | null;
    if (data?.type === 'moved') onMoved();
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
    channel.close();
  };
}
