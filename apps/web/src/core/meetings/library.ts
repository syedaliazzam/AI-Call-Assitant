/**
 * File: apps/web/src/core/meetings/library.ts
 * Purpose: The Meetings library's rules (ADR-0096), without React: the account's calls grouped into
 *          session folders named as in Google Drive ("<YYYY-MM-DD> <Company> – <Session>", named after the
 *          session's first call), newest first; search by company, session and the other person's name; the
 *          date filter; each call's recording status words ("Recorded", "Waiting for the desktop app to
 *          finish the upload" and, after a day without progress, "Upload paused: open the desktop app on the
 *          computer used for this call" (ADR-0106), "Saved on <computer> only", "Not recorded"); its small icons (recorded, notes, transcript); the "Questions & answers
 *          only" view of a conversation; and the transcript search. Reads the synced call data only, so
 *          the same library shows in any browser and in the desktop app.
 * Used by: src/features/meetings/* (MeetingsPage, LibraryPane, CallPane and the tabs)
 * Depends on: src/core/review/calls.ts (CallView), src/core/review/conversation.ts (ConversationEntry),
 *             src/core/drive/names.ts (sessionFolderName, sessionTitle), src/core/drive/waitWords.ts
 *             (ADR-0106), src/core/transcript/theirName.ts,
 *             src/core/storage/types.ts
 * Architecture: docs/decisions/ADR-0096-meetings-library.md; architecture §5 (Meetings)
 *
 * Pure functions; nothing here is logged or sent.
 */
import { pendingUpload, UPLOAD_PAUSED_OPEN_APP, WAITING_FOR_DESKTOP } from '../drive/waitWords';
import { sessionFolderName, sessionTitle } from '../drive/names';
import type { CallView } from '../review/calls';
import type { ConversationEntry } from '../review/conversation';
import type { Session, StoredUtterance } from '../storage/types';
import { INTERVIEWER_LABEL, THEM_LABEL, theirLabel } from '../transcript/theirName';

/** One session folder of the library: a session with at least one call. */
export interface LibraryFolder {
  /** The session. */
  session: Session;
  /** Its name, as its folder in Google Drive: "<YYYY-MM-DD> <Company> – <Session>". */
  name: string;
  /** Its newest call's start (Unix ms): folders are sorted by it, newest first. */
  latestAt: number;
  /** Its calls, newest first. */
  calls: CallView[];
}

/** The date filter's choices. */
export type LibraryRange = 'all' | 'today' | '7d' | '30d' | '90d' | 'year';

/** The date filter's choices, in the order the filter lists them, with their words. */
export const LIBRARY_RANGES: readonly { value: LibraryRange; label: string }[] = [
  { value: 'all', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
  { value: 'year', label: 'This year' },
];

/** One day, ms. */
const DAY_MS = 24 * 60 * 60_000;

/**
 * Groups the account's calls into session folders. A session without calls is left out (it was never
 * started, so the library has nothing to show for it).
 *
 * @param sessions The sessions.
 * @param calls    Each session's calls (core/review/calls.ts), by session id.
 * @returns The folders, newest call first; each folder's calls newest first.
 * Called from: MeetingsPage.tsx; tests
 */
export function buildLibrary(
  sessions: readonly Session[],
  calls: ReadonlyMap<string, readonly CallView[]>,
): LibraryFolder[] {
  const folders: LibraryFolder[] = [];
  for (const session of sessions) {
    const own = [...(calls.get(session.id) ?? [])].sort((a, b) => b.startedAt - a.startedAt);
    if (own.length === 0) continue;
    // Drive names the session folder after the first call it saves (core/drive/names.ts).
    const first = own.at(-1)!.startedAt;
    folders.push({
      session,
      name: sessionFolderName(session, first),
      latestAt: own[0]!.startedAt,
      calls: own,
    });
  }
  return folders.sort((a, b) => b.latestAt - a.latestAt);
}

/**
 * The earliest call start a date choice keeps.
 *
 * @param range The choice.
 * @param now   The clock (Unix ms).
 * @returns The earliest start (Unix ms); 0 for "Any date".
 * Called from: filterLibrary(); tests
 */
export function rangeStart(range: LibraryRange, now: number): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  switch (range) {
    case 'today':
      return today.getTime();
    case '7d':
      return today.getTime() - 6 * DAY_MS;
    case '30d':
      return today.getTime() - 29 * DAY_MS;
    case '90d':
      return today.getTime() - 89 * DAY_MS;
    case 'year':
      return new Date(today.getFullYear(), 0, 1).getTime();
    default:
      return 0;
  }
}

/**
 * The other person's real name for a call (the call's own, else the session's), or null when only the
 * fallback label ("Them", "Interviewer") is known.
 *
 * @param session The session.
 * @param call    The call (its record's themName).
 * @returns The name, or null.
 * Called from: filterLibrary(), CallPane.tsx; tests
 */
export function callTheirName(
  session: Pick<Session, 'contactName' | 'type'>,
  call: Pick<CallView, 'record'>,
): string | null {
  const label = theirLabel(session, call.record);
  return label === THEM_LABEL || label === INTERVIEWER_LABEL ? null : label;
}

/**
 * Lower-case words of a search.
 *
 * @param query What was typed.
 * @returns Its words.
 */
function words(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Narrows the library by the search box and the date filter. Every typed word must appear in the
 * session's company, title, folder name or the other person's name; a matching session keeps only its
 * calls inside the dates, and a folder left with none is dropped.
 *
 * @param folders The library.
 * @param query   What was typed ('' for everything).
 * @param range   The date choice.
 * @param now     The clock (Unix ms).
 * @returns The folders to show.
 * Called from: LibraryPane.tsx; tests
 */
export function filterLibrary(
  folders: readonly LibraryFolder[],
  query: string,
  range: LibraryRange,
  now: number,
): LibraryFolder[] {
  const wanted = words(query);
  const from = rangeStart(range, now);
  const out: LibraryFolder[] = [];
  for (const folder of folders) {
    const { session } = folder;
    const sessionText = [session.company, session.role, sessionTitle(session), folder.name]
      .concat(session.contactName ?? '')
      .join(' ')
      .toLowerCase();
    const calls = folder.calls.filter((call) => {
      if (call.startedAt < from) return false;
      if (wanted.length === 0) return true;
      const text = `${sessionText} ${(callTheirName(session, call) ?? '').toLowerCase()}`;
      return wanted.every((word) => text.includes(word));
    });
    if (calls.length > 0) out.push({ ...folder, calls });
  }
  return out;
}

/** A call's recording status, for the call header and the Watch tab. */
export interface RecordingStatus {
  /**
   * - recording: a part is still being recorded;
   * - recorded: recorded and saved to Google Drive;
   * - uploading: recorded, and its Drive upload is on its way (ADR-0106: "Waiting for the desktop app to
   *   finish the upload": only the computer that recorded it can);
   * - stalled: on its way, but that computer's app has not worked on it for a day (ADR-0106);
   * - device-only: recorded, but only on the computer that recorded it;
   * - none: not recorded.
   */
  kind: 'recording' | 'recorded' | 'uploading' | 'stalled' | 'device-only' | 'none';
  /** The words to show. */
  label: string;
}

/**
 * A call's recording status.
 *
 * @param call The call (its recordings and its Drive state).
 * @param now  The clock (Unix ms; ADR-0106: a day without progress reads as paused).
 * @returns The status.
 * Called from: CallPane.tsx, LibraryPane.tsx; tests
 */
export function recordingStatus(
  call: Pick<CallView, 'recordings' | 'record'>,
  now: number = Date.now(),
): RecordingStatus {
  if (call.recordings.length === 0) return { kind: 'none', label: 'Not recorded' };
  if (call.recordings.some((part) => part.status === 'recording')) {
    return { kind: 'recording', label: 'Recording…' };
  }
  const drive = call.record?.drive.state;
  if (drive === 'done') return { kind: 'recorded', label: 'Recorded' };
  // 'waiting' with a reason waits for the person (Drive not connected, saving off): not on its way.
  // ADR-0106: the file is only on the computer that recorded it, so the words say who finishes it.
  const pending = call.record ? pendingUpload(call.record, now) : null;
  if (pending === 'stalled') return { kind: 'stalled', label: UPLOAD_PAUSED_OPEN_APP };
  if (pending === 'waiting') return { kind: 'uploading', label: WAITING_FOR_DESKTOP };
  const device = call.recordings.find((part) => part.deviceName.trim())?.deviceName.trim();
  return {
    kind: 'device-only',
    label: device ? `Saved on ${device} only` : 'Saved on one computer only',
  };
}

/** What a call has, for the small icons on its row. */
export interface CallMarks {
  /** It was recorded. */
  recorded: boolean;
  /** It has AI notes. */
  notes: boolean;
  /** It has saved transcript lines. */
  transcript: boolean;
}

/**
 * What a call has.
 *
 * @param call The call.
 * @returns Its marks.
 * Called from: LibraryPane.tsx; tests
 */
export function callMarks(call: Pick<CallView, 'recordings' | 'notes' | 'lines'>): CallMarks {
  return {
    recorded: call.recordings.length > 0,
    notes: call.notes !== null,
    transcript: call.lines.length > 0,
  };
}

/**
 * The "Questions & answers only" view of a conversation: every Paramount AI answer, each with the other
 * person's turn just before it (the question it answered), in order; everything else is left out.
 *
 * @param entries The conversation (core/review/conversation.ts conversationEntries()), oldest first.
 * @returns The questions and answers.
 * Called from: ConversationTab.tsx; tests
 */
export function questionsAndAnswers(entries: readonly ConversationEntry[]): ConversationEntry[] {
  const out: ConversationEntry[] = [];
  let lastTheirTurn: ConversationEntry | null = null;
  for (const entry of entries) {
    if (entry.kind === 'turn') {
      lastTheirTurn = entry.turn.speaker === 'them' ? entry : null;
      continue;
    }
    if (entry.kind !== 'answer') continue;
    // The question once, even when several answers follow it.
    if (lastTheirTurn && !out.includes(lastTheirTurn)) out.push(lastTheirTurn);
    out.push(entry);
  }
  return out;
}

/**
 * Whether a transcript line matches the transcript search (every typed word, any case).
 *
 * @param line  The line.
 * @param query What was typed ('' matches everything).
 * @returns True when it matches.
 * Called from: WatchTab.tsx; tests
 */
export function lineMatches(line: Pick<StoredUtterance, 'text'>, query: string): boolean {
  const wanted = words(query);
  if (wanted.length === 0) return true;
  const text = line.text.toLowerCase();
  return wanted.every((word) => text.includes(word));
}

/**
 * Where a call is in the library: its folder and the call.
 *
 * @param folders The library.
 * @param callId  The call's id.
 * @returns The folder and call, or null when the library has no such call (deleted, or another account's).
 * Called from: MeetingsPage.tsx; tests
 */
export function findCall(
  folders: readonly LibraryFolder[],
  callId: string,
): { folder: LibraryFolder; call: CallView } | null {
  for (const folder of folders) {
    const call = folder.calls.find((one) => one.id === callId);
    if (call) return { folder, call };
  }
  return null;
}
