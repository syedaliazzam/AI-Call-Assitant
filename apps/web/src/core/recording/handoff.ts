/**
 * File: apps/web/src/core/recording/handoff.ts
 * Purpose: Carries recording between the desktop app's windows (1.5.0, ADR-0068). The Connect card (the
 *          small window) leaves a short-lived note saying the call should be recorded from the start, of
 *          which type and which display, with the person's consent ticked; the live page (the main
 *          window) takes it once when the call connects. When the call ends with a recording, the live
 *          page announces it, so the small window shows "Recording saved · Open in Meetings". Only ids
 *          and choices travel; never call content.
 * Used by: src/features/home/LauncherConnect.tsx (leaves the note), src/features/live/LivePage.tsx
 *          (takes it, announces), src/features/home/Launcher.tsx (listens)
 * Depends on: localStorage, BroadcastChannel (both injectable for tests), @kite/shared
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; ADR-0055 (the same pattern as callStart.ts)
 */
import { RECORDING_KINDS, type RecordingKind } from '@kite/shared';

/** The localStorage key of the note. */
export const RECORD_START_KEY = 'kite-record-start';

/** The BroadcastChannel's name. */
export const RECORDING_CHANNEL = 'kite-recording';

/** How long a note is good for, in ms (Connect waits up to 60 s for the speech model). */
export const RECORD_START_TTL_MS = 120_000;

/** The Connect card's recording choice for a call. */
export interface RecordStartNote {
  /** The session. */
  sessionId: string;
  /** Screen and sound, or sound only. */
  kind: RecordingKind;
  /** The display to record, or null for the main one. */
  displayId: string | null;
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
 * Leaves the note for the call about to start (the Connect card's Connect, with Record on and the
 * consent ticked). Record Off clears any old note.
 * @param sessionId The session.
 * @param choice    The type and display, or null for Off.
 * @param deps      See HandoffDeps.
 * Called from: LauncherConnect.tsx
 */
export function leaveRecordStart(
  sessionId: string,
  choice: { kind: RecordingKind; displayId: string | null } | null,
  deps = defaultHandoffDeps(),
): void {
  try {
    if (!choice) {
      deps.storage?.removeItem(RECORD_START_KEY);
      return;
    }
    const note: RecordStartNote = { sessionId, ...choice, at: deps.now() };
    deps.storage?.setItem(RECORD_START_KEY, JSON.stringify(note));
  } catch {
    // Storage blocked: the call starts without recording; the Rec pill still starts one.
  }
}

/**
 * Takes the note for this session, once (it is removed whatever it holds).
 * @param sessionId The live page's session.
 * @param deps      See HandoffDeps.
 * @returns The choice, or null when the call should not record from the start.
 * Called from: LivePage.tsx (when the call has connected)
 */
export function takeRecordStart(
  sessionId: string,
  deps = defaultHandoffDeps(),
): { kind: RecordingKind; displayId: string | null } | null {
  try {
    const raw = deps.storage?.getItem(RECORD_START_KEY);
    if (!raw) return null;
    const note = JSON.parse(raw) as Partial<RecordStartNote>;
    if (note.sessionId !== sessionId) return null;
    deps.storage?.removeItem(RECORD_START_KEY);
    const fresh =
      typeof note.at === 'number' &&
      note.at <= deps.now() &&
      deps.now() - note.at <= RECORD_START_TTL_MS;
    if (!fresh || !(RECORDING_KINDS as readonly unknown[]).includes(note.kind)) return null;
    return {
      kind: note.kind as RecordingKind,
      displayId: typeof note.displayId === 'string' ? note.displayId : null,
    };
  } catch {
    return null;
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
