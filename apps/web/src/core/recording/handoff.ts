/**
 * File: apps/web/src/core/recording/handoff.ts
 * Purpose: Carries recording between the desktop app's windows (1.5.0, ADR-0068). ADR-0082: the Connect card
 *          (the small window) has no Record choice any more (recording starts only from the call bars' Rec
 *          pill); when the person ticks "Everyone on the call has agreed to be recorded" there, it leaves a
 *          short-lived note of that consent, and the live page (the main window) takes it once when the
 *          call connects, so the Rec pill can start without asking again. When the call ends with a
 *          recording, the live page announces it, so the small window shows "Recording saved · Open in
 *          Meetings". Only ids and a yes travel; never call content.
 * Used by: src/features/home/LauncherConnect.tsx (leaves the note), src/features/live/LivePage.tsx
 *          (takes it, announces), src/features/home/Launcher.tsx (listens)
 * Depends on: localStorage, BroadcastChannel (both injectable for tests)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md, ADR-0082; ADR-0055 (the same pattern as
 *               callStart.ts)
 */

/**
 * ADR-0082: the localStorage key of the consent note. (1.5.0 to 1.6.3 used 'kite-record-start' for "record
 * from the start"; such a note is ignored now, so no call ever starts recording by itself.)
 */
export const RECORD_CONSENT_KEY = 'kite-record-consent';

/** The BroadcastChannel's name. */
export const RECORDING_CHANNEL = 'kite-recording';

/** How long a note is good for, in ms (Connect waits up to 60 s for the speech model). */
export const RECORD_CONSENT_TTL_MS = 120_000;

/** ADR-0082: the Connect card's consent for one call. */
export interface RecordConsentNote {
  /** The session. */
  sessionId: string;
  /** When it was left (Unix ms). */
  at: number;
}

/** What this module uses (the page's own objects by default). */
export interface HandoffDeps {
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
 * @returns Default dependencies.
 * Called from: the functions below (default argument)
 */
export function defaultHandoffDeps(): HandoffDeps {
  let storage: HandoffDeps['storage'] = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return {
    storage,
    openChannel:
      typeof BroadcastChannel === 'function' ? () => new BroadcastChannel(RECORDING_CHANNEL) : null,
    now: () => Date.now(),
  };
}

/**
 * ADR-0082: leaves the consent note for the call about to start (the Connect card's Connect). Unticked
 * clears any old note, so consent never carries over to another call.
 * @param sessionId The session.
 * @param consented True when "Everyone on the call has agreed to be recorded" is ticked.
 * @param deps      See HandoffDeps.
 * Called from: LauncherConnect.tsx
 */
export function leaveRecordConsent(
  sessionId: string,
  consented: boolean,
  deps = defaultHandoffDeps(),
): void {
  try {
    if (!consented) {
      deps.storage?.removeItem(RECORD_CONSENT_KEY);
      return;
    }
    const note: RecordConsentNote = { sessionId, at: deps.now() };
    deps.storage?.setItem(RECORD_CONSENT_KEY, JSON.stringify(note));
  } catch {
    // Storage blocked: the Rec pill simply asks for consent, as without the tick.
  }
}

/**
 * ADR-0082: takes the consent note for this session, once (it is removed whatever it holds).
 * @param sessionId The live page's session.
 * @param deps      See HandoffDeps.
 * @returns True when consent was ticked at Connect for this call (a fresh note for this session).
 * Called from: LivePage.tsx (when the call has connected)
 */
export function takeRecordConsent(sessionId: string, deps = defaultHandoffDeps()): boolean {
  try {
    const raw = deps.storage?.getItem(RECORD_CONSENT_KEY);
    if (!raw) return false;
    const note = JSON.parse(raw) as Partial<RecordConsentNote>;
    if (note.sessionId !== sessionId) return false;
    deps.storage?.removeItem(RECORD_CONSENT_KEY);
    return (
      typeof note.at === 'number' &&
      note.at <= deps.now() &&
      deps.now() - note.at <= RECORD_CONSENT_TTL_MS
    );
  } catch {
    return false;
  }
}

/**
 * Tells the app's other windows that a call ended with a recording saved.
 * @param deps See HandoffDeps.
 * Called from: LivePage.tsx (End)
 */
export function announceRecordingSaved(deps = defaultHandoffDeps()): void {
  const channel = deps.openChannel?.();
  if (!channel) return;
  channel.postMessage({ type: 'saved' });
  channel.close();
}

/**
 * Listens for "a recording was saved".
 * @param onSaved Called each time.
 * @param deps    See HandoffDeps.
 * @returns Stops listening.
 * Called from: Launcher.tsx
 */
export function watchRecordingSaved(onSaved: () => void, deps = defaultHandoffDeps()): () => void {
  const channel = deps.openChannel?.();
  if (!channel) return () => undefined;
  const listener = (event: Event) => {
    const data = (event as MessageEvent<unknown>).data as { type?: unknown } | null;
    if (data?.type === 'saved') onSaved();
  };
  channel.addEventListener('message', listener);
  return () => {
    channel.removeEventListener('message', listener);
    channel.close();
  };
}
