/**
 * File: apps/web/src/core/live/afterCall.ts
 * Purpose: The after-call runner (ADR-0077): finishes each ended call's work outside the call page's
 *          lifetime, so closing the call window loses nothing. It runs in every signed-in Kite window (the
 *          desktop panel too; features/live/AfterCallRunner.tsx), one window of the profile at a time (a
 *          Web Lock), on this device's own calls only. For each call it:
 *          1. ends a call whose window closed or crashed while it was live or ending (no call is live here);
 *          2. writes its AI notes (the call page hands over the call's lines in memory; without them, the
 *             saved lines; with "Save transcript" off and the window gone, the answers only), a few tries;
 *          3. once the notes are settled, queues its own Google Drive upload (or marks it 'off' when the
 *             account does not save to Drive).
 *          The call page writes the call record at End before anything else; this does the rest.
 * Used by: src/features/live/AfterCallRunner.tsx, src/features/live/LivePage.tsx (hand-over, wake-up)
 * Depends on: src/core/storage (calls, callNotes, sessions, documents, driveCallJobs), src/core/notes/generate.ts,
 *             src/core/review/calls.ts, src/core/drive/queue.ts, ./deviceId.ts
 * Architecture: ADR-0077
 *
 * Logs ids, counts and outcomes only; never transcript, notes or document text.
 */
import type { UnavailableReason } from '../answer/unavailable';
import { callIsLive, driveSavesNow, announceDrive } from '../drive/queue';
import { generateNotes, type NotesLine, type NotesOutcome } from '../notes/generate';
import { loadSessionCalls } from '../review/calls';
import { saveCallNotes } from '../storage/callNotes';
import { listDeviceCalls, updateCall, watchCall } from '../storage/calls';
import { queueCallJob, type CallJobInput } from '../storage/driveCallJobs';
import { listDocuments } from '../storage/documents';
import { getSession } from '../storage/sessions';
import type { Session, StoredAnswer, StoredCall, StoredDocument } from '../storage/types';
import { thisDeviceId } from './deviceId';

/** The Web Lock that lets one window of the profile do after-call work at a time. */
export const AFTER_CALL_LOCK = 'kite.after-call';

/** The BroadcastChannel that wakes the runners of this profile's windows. */
export const AFTER_CALL_CHANNEL = 'kite.after-call';

/** How many times writing a call's notes is tried before it counts as failed. */
export const MAX_NOTES_ATTEMPTS = 3;

/** How long after a failed try the notes are tried again, ms. */
export const NOTES_RETRY_MS = 60_000;

/** What the call page hands over at End, in this window's memory only (never stored). */
export interface CallHandOff {
  /** The call's final lines as heard (also when "Save transcript" is off). Never logged. */
  lines: NotesLine[];
}

/** Hand-overs waiting in this window, by call. */
const handOffs = new Map<string, CallHandOff>();

/**
 * Calls running in this window (from Connect until their record says 'ended'), so the runner here never
 * ends one, even where Web Locks cannot be queried.
 */
const liveHere = new Set<string>();

/**
 * Notes that a call runs in this window, or no longer does.
 *
 * @param callId The call.
 * @param live   True from Connect, false once its End is written.
 * Called from: LivePage.tsx
 */
export function markCallLiveHere(callId: string, live: boolean): void {
  if (live) liveHere.add(callId);
  else liveHere.delete(callId);
}

/**
 * Hands a call's in-memory lines to this window's runner (the call page's End). Kept until its notes are
 * written; lost with the window (the runner then uses the saved lines).
 *
 * @param callId  The call.
 * @param handOff Its lines.
 * Called from: LivePage.tsx (End)
 */
export function handOffCall(callId: string, handOff: CallHandOff): void {
  handOffs.set(callId, handOff);
}

/**
 * Wakes the after-call runners of this profile's windows (this one included).
 *
 * Called from: LivePage.tsx (End), tests
 */
export function announceAfterCall(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(AFTER_CALL_CHANNEL);
  channel.postMessage('ended');
  channel.close();
}

/**
 * Listens for wake-ups.
 *
 * @param handler Called on each.
 * @returns Stops listening.
 * Called from: features/live/AfterCallRunner.tsx
 */
export function onAfterCallMessage(handler: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const channel = new BroadcastChannel(AFTER_CALL_CHANNEL);
  channel.onmessage = () => handler();
  return () => channel.close();
}

/** What a call needs next. */
export type AfterCallStep = 'none' | 'wait' | 'finish-call' | 'notes' | 'drive';

/**
 * What one call needs next (pure).
 *
 * @param call     The call.
 * @param callLive True while a call is live on this device (its window is open).
 * @param now      The clock.
 * @returns 'finish-call' (a window closed during the call or its End: end it here), 'notes', 'drive',
 *          'wait' (try again later), or 'none' (nothing left).
 * Called from: runAfterCall(); tests
 */
export function nextAfterCallStep(call: StoredCall, callLive: boolean, now: number): AfterCallStep {
  if (call.phase !== 'ended') return callLive ? 'wait' : 'finish-call';
  if (call.notesState === 'writing') {
    // A failed try waits a minute before the next one.
    const tried = (call.notesAttempts ?? 0) > 0;
    return tried && now - call.updatedAt < NOTES_RETRY_MS ? 'wait' : 'notes';
  }
  if (call.drive.state === 'waiting') {
    // The call window still improves the user's lines (Accurate): Drive waits, for a while at most.
    return call.driveHoldUntil !== undefined && now < call.driveHoldUntil ? 'wait' : 'drive';
  }
  return 'none';
}

/** A call's data for its notes. */
export interface CallNotesData {
  /** Its saved lines (as heard), oldest first. */
  lines: NotesLine[];
  /** Its answers. */
  answers: StoredAnswer[];
  /** Its newest moment (the last line's end or the last answer's), Unix ms. */
  lastAt: number;
}

/** What the runner needs (tests pass fakes). */
export interface AfterCallDeps {
  /** This device's calls. */
  calls(): Promise<StoredCall[]>;
  /**
   * Changes a call record.
   * @param id      The call.
   * @param changes The fields.
   */
  update(id: string, changes: Partial<StoredCall>): Promise<boolean>;
  /** True while a call is live on this device. */
  callLive(): Promise<boolean>;
  /**
   * A session.
   * @param id The session.
   */
  session(id: string): Promise<Session | null>;
  /**
   * A session's documents.
   * @param sessionId The session.
   */
  documents(sessionId: string): Promise<StoredDocument[]>;
  /**
   * A call's saved lines and answers.
   * @param call The call.
   */
  callData(call: StoredCall): Promise<CallNotesData>;
  /**
   * Writes and saves a call's notes.
   * @param call  The call.
   * @param input What to write them from.
   */
  writeNotes(
    call: StoredCall,
    input: {
      session: Session;
      documents: StoredDocument[];
      lines: NotesLine[];
      answers: StoredAnswer[];
    },
  ): Promise<NotesOutcome>;
  /** Whether the account saves to Drive now (the last known answer when offline). */
  driveSaves(): Promise<boolean>;
  /**
   * Queues a call's Drive upload and wakes the uploader.
   * @param input The call.
   */
  queueDrive(input: CallJobInput): Promise<void>;
  /** The clock (Unix ms). */
  now(): number;
}

/**
 * Ends a call whose window closed during the call or its End: its end is its newest moment.
 *
 * @param deps The dependencies.
 * @param call The call.
 * @returns The call as it is now.
 */
async function finishCall(deps: AfterCallDeps, call: StoredCall): Promise<StoredCall> {
  const data = await deps.callData(call);
  const endedAt = call.endedAt ?? Math.max(call.startedAt, data.lastAt);
  const changes: Partial<StoredCall> = {
    phase: 'ended',
    endedAt,
    durationMs: Math.max(0, endedAt - call.startedAt),
    // Lines kept in memory only ("Save transcript" off) are gone with the window: the count is unknown.
    ...(call.heardLines === undefined && call.saveTranscript
      ? { heardLines: data.lines.length }
      : {}),
  };
  await deps.update(call.id, changes);
  console.info('after-call: call ended here', { callId: call.id });
  return { ...call, ...changes, updatedAt: deps.now() };
}

/**
 * Writes one call's notes, or records why not.
 *
 * @param deps The dependencies.
 * @param call The call.
 * @returns The call as it is now.
 */
async function writeCallNotes(deps: AfterCallDeps, call: StoredCall): Promise<StoredCall> {
  const settle = async (changes: Partial<StoredCall>) => {
    await deps.update(call.id, changes);
    return { ...call, ...changes, updatedAt: deps.now() };
  };
  const session = await deps.session(call.sessionId);
  if (!session) return settle({ notesState: 'failed', notesError: 'gone' });
  const data = await deps.callData(call);
  const handed = handOffs.get(call.id);
  // The lines as heard: handed over by this window's call page, else saved ones.
  const lines = handed?.lines ?? data.lines;
  // Lines heard but not available here (kept in memory only, and their window closed): the notes are
  // written from the answers only, and say so.
  const linesLost = !handed && !call.saveTranscript && (call.heardLines ?? 1) > 0;
  if (lines.length === 0 && data.answers.length === 0) {
    handOffs.delete(call.id);
    return settle(
      linesLost ? { notesState: 'failed', notesError: 'lines-lost' } : { notesState: 'skipped' },
    );
  }
  const outcome = await deps.writeNotes(call, {
    session,
    documents: await deps.documents(call.sessionId),
    lines,
    answers: data.answers,
  });
  if (outcome.status === 'saved' || outcome.status === 'skipped') {
    handOffs.delete(call.id);
    console.info('after-call: notes', { callId: call.id, outcome: outcome.status });
    return settle({ notesState: outcome.status, notesError: undefined });
  }
  const attempts = (call.notesAttempts ?? 0) + 1;
  // Claude unavailable (a usage limit, overload) is not worth trying again soon; Regenerate can.
  const final = attempts >= MAX_NOTES_ATTEMPTS || outcome.unavailable !== null;
  console.warn('after-call: notes failed', { callId: call.id, attempts, final });
  if (final) handOffs.delete(call.id);
  return settle({
    notesAttempts: attempts,
    ...(final
      ? { notesState: 'failed', notesError: outcome.unavailable ?? 'failed' }
      : { notesError: outcome.unavailable ?? undefined }),
  });
}

/**
 * Queues one call's Drive upload (or marks it 'off').
 *
 * @param deps The dependencies.
 * @param call The call.
 * @returns When done.
 */
async function queueCallDrive(deps: AfterCallDeps, call: StoredCall): Promise<void> {
  if (!(await deps.driveSaves())) {
    await deps.update(call.id, { drive: { ...call.drive, state: 'off', reason: undefined } });
    return;
  }
  const endedAt = call.endedAt ?? call.startedAt + call.durationMs;
  await deps.queueDrive({
    callId: call.id,
    sessionId: call.sessionId,
    startedAt: call.startedAt,
    endedAt,
    recordingMatch: 'meeting',
    origin: 'call',
  });
  await deps.update(call.id, {
    drive: { ...call.drive, state: 'queued', reason: undefined },
    driveHoldUntil: undefined,
  });
  console.info('after-call: queued for Drive', { callId: call.id });
}

/** How a run ended. */
export type AfterCallRun = 'done' | 'busy';

/**
 * Works through this device's calls once: each call's next steps, in order, oldest call first. One call's
 * failure never stops the others.
 *
 * @param deps The dependencies.
 * @returns 'done', or 'busy' when another window of the profile is running it.
 * Called from: runAfterCallOnce(); tests
 */
export async function runAfterCall(deps: AfterCallDeps): Promise<AfterCallRun> {
  const live = await deps.callLive();
  for (const start of await deps.calls()) {
    let call = start;
    try {
      for (let step = 0; step < 4; step += 1) {
        const next = nextAfterCallStep(call, live || liveHere.has(call.id), deps.now());
        if (next === 'none' || next === 'wait') break;
        if (next === 'finish-call') call = await finishCall(deps, call);
        else if (next === 'notes') {
          call = await writeCallNotes(deps, call);
          if (call.notesState === 'writing') break;
        } else {
          await queueCallDrive(deps, call);
          break;
        }
      }
    } catch {
      console.warn('after-call: step failed', { callId: call.id });
    }
  }
  return 'done';
}

/**
 * The runner's dependencies for this page.
 *
 * @returns The dependencies.
 * Called from: runAfterCallOnce()
 */
export function createAfterCallDeps(): AfterCallDeps {
  const deviceId = thisDeviceId();
  return {
    calls: async () =>
      (await listDeviceCalls(deviceId)).filter(
        (call) =>
          call.phase !== 'ended' || call.notesState === 'writing' || call.drive.state === 'waiting',
      ),
    update: (id, changes) => updateCall(id, changes),
    callLive: callIsLive,
    session: getSession,
    documents: listDocuments,
    callData: async (call) => {
      const view = (await loadSessionCalls(call.sessionId)).find((one) => one.id === call.id);
      const lines = (view?.lines ?? []).map(({ speaker, text, tStart }) => ({
        speaker,
        text,
        tStart,
      }));
      const answers = view?.answers ?? [];
      const lastAt = Math.max(
        call.startedAt,
        ...(view?.lines ?? []).map((line) => line.tEnd),
        ...answers.map((answer) => answer.createdAt + Math.max(0, answer.msTotal)),
      );
      return { lines, answers, lastAt };
    },
    writeNotes: (call, input) =>
      generateNotes(
        { ...input, callStartedAt: call.startedAt },
        {
          save: (stored) =>
            saveCallNotes({
              callId: call.id,
              sessionId: call.sessionId,
              notes: stored.notes,
              callStartedAt: stored.callStartedAt,
              createdAt: stored.createdAt,
              ...(stored.fromAnswersOnly ? { fromAnswersOnly: true } : {}),
            }),
        },
      ),
    driveSaves: driveSavesNow,
    queueDrive: async (input) => {
      await queueCallJob(input);
      announceDrive('queued');
    },
    now: () => Date.now(),
  };
}

/**
 * Runs the after-call work once, unless another window of this profile is already running it.
 *
 * @param deps The dependencies (default this page's).
 * @returns How the run ended.
 * Called from: features/live/AfterCallRunner.tsx
 */
export async function runAfterCallOnce(
  deps: AfterCallDeps = createAfterCallDeps(),
): Promise<AfterCallRun> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return runAfterCall(deps);
  const outcome = await locks.request(AFTER_CALL_LOCK, { ifAvailable: true }, async (lock) =>
    lock ? runAfterCall(deps) : ('busy' as const),
  );
  return outcome as AfterCallRun;
}

/**
 * Resolves once a call's notes are settled (saved, skipped or failed), or after a time at most.
 *
 * @param callId    The call.
 * @param timeoutMs The longest wait, ms.
 * @returns When settled or timed out (never rejects).
 * Called from: LivePage.tsx (a launcher call's window closes after its notes, ADR-0055)
 */
export function waitForNotes(callId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let stop: (() => void) | null = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // The watch may call back before watchCall() returned: stop it on the next turn.
      queueMicrotask(() => stop?.());
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    stop = watchCall(callId, (call) => {
      if (!call || call.notesState !== 'writing') finish();
    });
    if (done) stop();
  });
}

/**
 * The words for a call's notes failure (the live page and the session page).
 *
 * @param error The call's notesError.
 * @returns The reason for notesFailureText(), or null for any other failure.
 * Called from: LivePage.tsx; features/review/*
 */
export function notesUnavailableOf(error: string | undefined): UnavailableReason | null {
  if (!error || error === 'failed' || error === 'gone' || error === 'lines-lost') return null;
  return error as UnavailableReason;
}
