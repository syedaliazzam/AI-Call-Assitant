/**
 * File: apps/web/src/core/live/callStart.ts
 * Purpose: Starts a desktop call from the Connect card (ADR-0055). The card is in the desktop app's
 *          small window; the call itself runs in the main window's live page, which holds the speech
 *          engine and the capture. The card asks for the start and the live page answers with how it
 *          went, through two same-address channels every window of the app shares:
 *          - a short-lived note in localStorage, read by a live page that is just opening (it may not be
 *            listening yet);
 *          - a BroadcastChannel, for a live page that is already open (Try again) and for the answers.
 *          Only a session id and a state travel; never call text. ADR-0098: a start refused because the
 *          session is live on another device carries the code 'live-elsewhere', so the card offers Take over.
 * Used by: src/features/home/LauncherConnect.tsx (asks, listens), src/features/live/LivePage.tsx (takes,
 *          answers); tests/unit/core/live/callStart.test.ts
 * Depends on: localStorage, BroadcastChannel (both injectable for tests)
 * Architecture: ADR-0055; ADR-0053 (Connect starts the call); ADR-0098 (live elsewhere)
 */

/** The localStorage key of the note. */
export const CALL_START_KEY = 'kite-call-start';

/** The BroadcastChannel's name. */
export const CALL_START_CHANNEL = 'kite-call-start';

/** How long a note is good for, in ms: a live page opening later than this does not start a call. */
export const CALL_START_TTL_MS = 60_000;

/** How a start went, as the live page reports it. */
export type CallStartState = 'connecting' | 'connected' | 'failed' | 'ended';

/** A message on the channel. */
export type CallStartMessage =
  | {
      /** The card asks the live page of this session to connect. */
      type: 'start';
      /** The session. */
      sessionId: string;
    }
  | {
      /** The live page says how it went. */
      type: 'status';
      /** The session. */
      sessionId: string;
      /** The state. */
      state: CallStartState;
      /** For 'failed': what to tell the person (a fixed sentence from the app, never call text). */
      message?: string;
      /** ADR-0098: for 'failed', 'live-elsewhere' when another device runs the session (Take over offered). */
      code?: 'live-elsewhere';
    };

/** What this module uses (the page's own objects by default). */
export interface CallStartDeps {
  /** localStorage, or null where it is blocked. */
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** Opens the channel, or null where BroadcastChannel is missing. */
  openChannel:
    | (() => Pick<
        BroadcastChannel,
        'postMessage' | 'close' | 'addEventListener' | 'removeEventListener'
      >)
    | null;
  /** The clock, in ms. */
  now: () => number;
}

/**
 * The page's own objects.
 *
 * @returns Default dependencies.
 * Called from: the functions below (default argument)
 */
export function defaultCallStartDeps(): CallStartDeps {
  let storage: CallStartDeps['storage'] = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    // Blocked storage (a privacy setting): the channel still works for an open live page.
    storage = null;
  }
  return {
    storage,
    openChannel:
      typeof BroadcastChannel === 'function'
        ? () => new BroadcastChannel(CALL_START_CHANNEL)
        : null,
    now: () => Date.now(),
  };
}

/**
 * Sends one message and closes the channel.
 *
 * @param message The message.
 * @param deps    See CallStartDeps.
 */
function send(message: CallStartMessage, deps: CallStartDeps): void {
  const channel = deps.openChannel?.();
  if (!channel) return;
  channel.postMessage(message);
  channel.close();
}

/**
 * Asks for a call to start (the Connect card's Connect): leaves the note for a live page that is still
 * opening, and tells an open one.
 *
 * @param sessionId The session.
 * @param deps      See CallStartDeps.
 * Called from: LauncherConnect.tsx
 */
export function requestCallStart(sessionId: string, deps = defaultCallStartDeps()): void {
  try {
    deps.storage?.setItem(CALL_START_KEY, JSON.stringify({ sessionId, at: deps.now() }));
  } catch {
    // Full or blocked storage: the channel below still reaches an open live page.
  }
  send({ type: 'start', sessionId }, deps);
}

/**
 * Takes the note for this session, once: true when the card asked for this call within the last
 * CALL_START_TTL_MS. Any note is removed, so it cannot start a call twice.
 *
 * @param sessionId The live page's session.
 * @param deps      See CallStartDeps.
 * @returns True when the live page should connect now.
 * Called from: LivePage.tsx (as it opens)
 */
export function takeCallStart(sessionId: string, deps = defaultCallStartDeps()): boolean {
  try {
    const raw = deps.storage?.getItem(CALL_START_KEY);
    if (!raw) return false;
    const note = JSON.parse(raw) as { sessionId?: unknown; at?: unknown };
    if (note.sessionId !== sessionId) return false;
    deps.storage?.removeItem(CALL_START_KEY);
    return (
      typeof note.at === 'number' &&
      deps.now() - note.at <= CALL_START_TTL_MS &&
      note.at <= deps.now()
    );
  } catch {
    return false;
  }
}

/**
 * Tells the card how the start went.
 *
 * @param sessionId The session.
 * @param state     The state.
 * @param message   For 'failed': the sentence to show.
 * @param deps      See CallStartDeps.
 * Called from: LivePage.tsx
 */
export function reportCallStart(
  sessionId: string,
  state: CallStartState,
  message?: string,
  deps = defaultCallStartDeps(),
): void {
  send({ type: 'status', sessionId, state, ...(message ? { message } : {}) }, deps);
}

/**
 * ADR-0098: tells the card the start was refused because the session is live on another device.
 *
 * @param sessionId The session.
 * @param message   The sentence to show.
 * @param deps      See CallStartDeps.
 * Called from: LivePage.tsx (connect)
 */
export function reportLiveElsewhere(
  sessionId: string,
  message: string,
  deps = defaultCallStartDeps(),
): void {
  send({ type: 'status', sessionId, state: 'failed', message, code: 'live-elsewhere' }, deps);
}

/**
 * Listens to the channel for one session's messages of one kind.
 *
 * @param sessionId The session.
 * @param type      'start' (the live page) or 'status' (the card).
 * @param onMessage Called with each matching message.
 * @param deps      See CallStartDeps.
 * @returns Stops listening.
 * Called from: LivePage.tsx ('start'), LauncherConnect.tsx ('status')
 */
export function watchCallStart<T extends CallStartMessage['type']>(
  sessionId: string,
  type: T,
  onMessage: (message: Extract<CallStartMessage, { type: T }>) => void,
  deps = defaultCallStartDeps(),
): () => void {
  const channel = deps.openChannel?.();
  if (!channel) return () => undefined;
  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data as Partial<CallStartMessage> | null;
    if (!data || data.type !== type || data.sessionId !== sessionId) return;
    onMessage(data as Extract<CallStartMessage, { type: T }>);
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
    channel.close();
  };
}
