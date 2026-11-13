/**
 * File: apps/web/src/core/review/calls.ts
 * Purpose: A session's calls, each with its own lines, answers, notes and recordings (ADR-0077): every
 *          start of a session is a call. Calls since ADR-0077 have a record (core/storage/calls.ts) and
 *          their lines, answers and recordings carry its id. Calls made before have none: they are worked
 *          out here each time the session is read, and never written (each device would make up its own):
 *          their lines are grouped by the call id inside each line's id (`<session>:<call>:<line>`, one
 *          per call since the transcript saver began), answers join the call they were given in (and give
 *          it its exact start), and the older single `notes` row joins the call it was written for. A
 *          legacy call's id is made from those same facts ("legacy-<call id in the lines>" or
 *          "legacy-t<start>"), so every device works out the same one.
 * Used by: src/features/review/* (the session page), src/core/live/afterCall.ts (a call's lines and
 *          answers), src/core/drive/{callFiles,earlierCalls}.ts
 * Depends on: src/core/storage (calls, callNotes, notes, utterances, answers, recordings), ./migrate
 * Architecture: ADR-0077; docs/architecture/kite-architecture-v3.1.md §7.4
 *
 * Runs on this device only; nothing here is logged or sent.
 */
import { listAnswers } from '../storage/answers';
import { listCallNotes } from '../storage/callNotes';
import { listCalls } from '../storage/calls';
import { findCalls } from '../storage/migrate';
import { getNotes } from '../storage/notes';
import { listRecordings } from '../storage/recordings';
import type {
  CallNotesState,
  StoredAnswer,
  StoredCall,
  StoredCallNotes,
  StoredNotes,
  StoredRecording,
  StoredUtterance,
} from '../storage/types';
import { listUtterances } from '../storage/utterances';

/** A legacy call's lines may start this long after it connected and still be its (a quiet start), ms. */
const LEGACY_START_SLACK_MS = 10 * 60_000;

/** A recording may start this long before its call's recorded start (as the Drive uploader allows), ms. */
const RECORDING_BEFORE_MS = 60_000;

/** An answer, a line or a recording just after a call's last line is still the call's, ms. */
const AFTER_END_MS = 120_000;

/** A call's notes as the session page and the Drive files read them (a call's own, or the older row). */
export type CallNotesView = Pick<
  StoredNotes,
  'notes' | 'callStartedAt' | 'createdAt' | 'fromAnswersOnly'
>;

/** One call of a session, with everything it has. */
export interface CallView {
  /** The call's id: its record's, or (legacy) the one worked out here. */
  id: string;
  /** True for a call made before call records (worked out from the data; never written). */
  legacy: boolean;
  /** The session. */
  sessionId: string;
  /** When it connected (Unix ms): the record's, or a legacy call's best estimate. */
  startedAt: number;
  /** When it ended (Unix ms); for a running call, the newest thing it has. */
  endedAt: number;
  /** How long it lasted, ms. */
  durationMs: number;
  /** Its record (null for a legacy call). */
  record: StoredCall | null;
  /** Its saved lines, oldest first. */
  lines: StoredUtterance[];
  /** Its answers, oldest first. */
  answers: StoredAnswer[];
  /** Its notes, or null. */
  notes: CallNotesView | null;
  /** Where its notes stand (a legacy call: 'saved' with notes, else null: never known). */
  notesState: CallNotesState | null;
  /** Its recording parts (records), by part. */
  recordings: StoredRecording[];
}

/** Everything a session has, for buildCallViews(). */
export interface SessionCallData {
  /** The session. */
  sessionId: string;
  /** Its call records. */
  calls: readonly StoredCall[];
  /** Its saved lines. */
  lines: readonly StoredUtterance[];
  /** Its answers. */
  answers: readonly StoredAnswer[];
  /** Its calls' notes. */
  callNotes: readonly StoredCallNotes[];
  /** The session's older single notes row, or null. */
  legacyNotes: StoredNotes | null;
  /** Every recording record (any session; filtered here). */
  recordings: readonly StoredRecording[];
  /** The clock (a running call's length). */
  now: number;
}

/**
 * The call id inside a saved line's id (`<session>:<call>:<line>`, the transcript saver's format).
 *
 * @param sessionId The session.
 * @param lineId    The saved line's id.
 * @returns The call id, or null for an id of another form.
 * Called from: buildCallViews(); tests
 */
export function callIdInLineId(sessionId: string, lineId: string): string | null {
  const prefix = `${sessionId}:`;
  if (!lineId.startsWith(prefix)) return null;
  const rest = lineId.slice(prefix.length);
  const at = rest.indexOf(':');
  return at > 0 ? rest.slice(0, at) : null;
}

/** A legacy call being put together. */
interface LegacyGroup {
  /** Its id. */
  id: string;
  /** Its lines. */
  lines: StoredUtterance[];
  /** Its answers. */
  answers: StoredAnswer[];
  /** Its first line's start (or its answers' start). */
  first: number;
  /** Its last line's end. */
  last: number;
}

/**
 * The newest time an answer covers (asked, plus how long it took).
 *
 * @param answer The answer.
 * @returns Unix ms.
 */
function answerEnd(answer: StoredAnswer): number {
  return answer.createdAt + Math.max(0, answer.msTotal);
}

/**
 * The legacy call an answer was given in: among the calls whose time covers the answer, the first whose
 * lines start after the answer's recorded connect time (calls a minute apart stay apart), or without one,
 * the call that was running when it was asked.
 *
 * @param groups The legacy calls with lines.
 * @param answer The answer.
 * @returns The call, or undefined when none covers it.
 */
function legacyGroupOf(
  groups: readonly LegacyGroup[],
  answer: StoredAnswer,
): LegacyGroup | undefined {
  const at = answer.createdAt;
  const covering = groups
    .filter((one) => at >= one.first - LEGACY_START_SLACK_MS && at <= one.last + AFTER_END_MS)
    .sort((a, b) => a.first - b.first);
  const connected = answer.callStartedAt;
  if (connected !== undefined) {
    // Its lines start after it connected (a few seconds of slack for the clocks).
    return covering.find((one) => one.first >= connected - 5_000);
  }
  return covering.filter((one) => one.first <= at).at(-1) ?? covering[0];
}

/**
 * Builds a session's calls from its data (pure; loadSessionCalls() reads the data).
 *
 * @param data See SessionCallData.
 * @returns The calls, newest first.
 * Called from: loadSessionCalls(); tests
 */
export function buildCallViews(data: SessionCallData): CallView[] {
  const records = new Map(data.calls.map((call) => [call.id, call]));
  const byStart = new Map(data.calls.map((call) => [call.startedAt, call]));
  const own = new Map<string, { lines: StoredUtterance[]; answers: StoredAnswer[] }>(
    data.calls.map((call) => [call.id, { lines: [], answers: [] }]),
  );

  // Lines: a call's own (by its id, or the id inside the line's id); the rest by the saver's call id.
  const segments = new Map<string, StoredUtterance[]>();
  const loose: StoredUtterance[] = [];
  for (const line of [...data.lines].sort((a, b) => a.tStart - b.tStart)) {
    const inId = callIdInLineId(data.sessionId, line.id);
    const callId = line.callId ?? inId;
    if (callId && own.has(callId)) {
      own.get(callId)!.lines.push(line);
    } else if (inId) {
      segments.set(inId, [...(segments.get(inId) ?? []), line]);
    } else {
      loose.push(line);
    }
  }
  const groups: LegacyGroup[] = [...segments.entries()].map(([segment, lines]) => ({
    id: `legacy-${segment}`,
    lines,
    answers: [],
    first: Math.min(...lines.map((line) => line.tStart)),
    last: Math.max(...lines.map((line) => line.tEnd)),
  }));
  // Lines saved without a call id in theirs (very old data): split where nothing happened for 30 minutes.
  for (const span of findCalls(loose.flatMap((line) => [line.tStart, line.tEnd]))) {
    const lines = loose.filter((line) => line.tStart >= span.start && line.tStart <= span.end);
    if (lines.length === 0) continue;
    groups.push({
      id: `legacy-t${span.start}`,
      lines,
      answers: [],
      first: span.start,
      last: Math.max(...lines.map((line) => line.tEnd)),
    });
  }

  // Answers: a call's own (by id, or by its exact start); the rest join the legacy call they were given in.
  const orphans: StoredAnswer[] = [];
  for (const answer of [...data.answers].sort((a, b) => a.createdAt - b.createdAt)) {
    const record =
      (answer.callId ? records.get(answer.callId) : undefined) ??
      (answer.callStartedAt !== undefined ? byStart.get(answer.callStartedAt) : undefined);
    if (record) {
      own.get(record.id)!.answers.push(answer);
      continue;
    }
    const group = legacyGroupOf(groups, answer);
    if (group) group.answers.push(answer);
    else orphans.push(answer);
  }
  // Answers with no saved lines ("Save transcript" off): one legacy call per call start they recorded,
  // or (older answers) per 30-minute gap.
  const byKnownStart = new Map<number, StoredAnswer[]>();
  const unknown: StoredAnswer[] = [];
  for (const answer of orphans) {
    if (answer.callStartedAt === undefined) unknown.push(answer);
    else
      byKnownStart.set(answer.callStartedAt, [
        ...(byKnownStart.get(answer.callStartedAt) ?? []),
        answer,
      ]);
  }
  for (const [start, answers] of byKnownStart) {
    groups.push({
      id: `legacy-t${start}`,
      lines: [],
      answers,
      first: start,
      last: Math.max(...answers.map(answerEnd)),
    });
  }
  for (const span of findCalls(unknown.map((answer) => answer.createdAt))) {
    const answers = unknown.filter((a) => a.createdAt >= span.start && a.createdAt <= span.end);
    groups.push({
      id: `legacy-t${span.start}`,
      lines: [],
      answers,
      first: span.start,
      last: Math.max(...answers.map(answerEnd)),
    });
  }

  const notesById = new Map(data.callNotes.map((notes) => [notes.callId, notes]));
  const claimed = new Set<string>();
  const sessionRecordings = data.recordings
    .filter((recording) => recording.sessionId === data.sessionId)
    .sort((a, b) => a.part - b.part || a.startedAt - b.startedAt);
  const views: CallView[] = [];

  for (const call of data.calls) {
    const mine = own.get(call.id)!;
    const recordings = sessionRecordings.filter((recording) => recording.meetingId === call.id);
    for (const recording of recordings) claimed.add(recording.id);
    const newest = Math.max(
      call.startedAt,
      ...mine.lines.map((line) => line.tEnd),
      ...mine.answers.map(answerEnd),
    );
    const endedAt = call.endedAt ?? Math.max(newest, data.now);
    views.push({
      id: call.id,
      legacy: false,
      sessionId: call.sessionId,
      startedAt: call.startedAt,
      endedAt,
      durationMs: call.endedAt !== null ? call.durationMs : Math.max(0, endedAt - call.startedAt),
      record: call,
      lines: mine.lines,
      answers: mine.answers,
      notes: notesById.get(call.id) ?? null,
      notesState: call.notesState,
      recordings,
    });
  }

  // Legacy calls: an answer's recorded start is the call's exact start (the one Drive and the older
  // notes used); without one, its first line.
  const legacyViews = groups.map((group) => {
    const known = group.answers.flatMap((answer) =>
      answer.callStartedAt !== undefined ? [answer.callStartedAt] : [],
    );
    const startedAt = known.length > 0 ? Math.min(...known) : group.first;
    return { group, startedAt };
  });
  // The older single notes row: the call it was written for (the same start, else the first call whose
  // lines begin after the notes' recorded connect time). Its recorded start is that call's exact start
  // too (as an answer's is), when no answer gave one.
  const legacyNotes = data.legacyNotes;
  const notesOwner = legacyNotes
    ? (legacyViews.find((one) => one.startedAt === legacyNotes.callStartedAt) ??
      legacyViews
        .filter(
          (one) =>
            one.group.first >= legacyNotes.callStartedAt - 5_000 &&
            one.group.first - legacyNotes.callStartedAt <= LEGACY_START_SLACK_MS,
        )
        .sort((x, y) => x.group.first - y.group.first)[0])
    : undefined;
  if (notesOwner && legacyNotes && legacyNotes.callStartedAt < notesOwner.startedAt) {
    notesOwner.startedAt = legacyNotes.callStartedAt;
  }
  for (const { group, startedAt } of legacyViews) {
    const endedAt = Math.max(group.last, ...group.answers.map(answerEnd));
    const recordings = sessionRecordings.filter(
      (recording) =>
        !claimed.has(recording.id) &&
        recording.startedAt >= startedAt - RECORDING_BEFORE_MS &&
        recording.startedAt <= endedAt + AFTER_END_MS,
    );
    for (const recording of recordings) claimed.add(recording.id);
    const recordedEnd = Math.max(
      endedAt,
      ...recordings.map((recording) => recording.startedAt + recording.durationMs),
    );
    const notes: CallNotesView | null =
      notesById.get(group.id) ?? (notesOwner?.group === group ? legacyNotes : null);
    views.push({
      id: group.id,
      legacy: true,
      sessionId: data.sessionId,
      startedAt,
      endedAt: recordedEnd,
      durationMs: Math.max(0, recordedEnd - startedAt),
      record: null,
      lines: group.lines,
      answers: group.answers,
      notes,
      notesState: notes ? 'saved' : null,
      recordings,
    });
  }
  // Recordings of a legacy call that kept no line or answer: one call per meeting.
  const leftover = new Map<string, StoredRecording[]>();
  for (const recording of sessionRecordings) {
    if (claimed.has(recording.id)) continue;
    leftover.set(recording.meetingId, [...(leftover.get(recording.meetingId) ?? []), recording]);
  }
  for (const [meetingId, recordings] of leftover) {
    const startedAt = Math.min(...recordings.map((recording) => recording.startedAt));
    const endedAt = Math.max(
      ...recordings.map((recording) => recording.startedAt + recording.durationMs),
    );
    const id = `legacy-m${meetingId}`;
    const notes: CallNotesView | null = notesById.get(id) ?? null;
    views.push({
      id,
      legacy: true,
      sessionId: data.sessionId,
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      record: null,
      lines: [],
      answers: [],
      notes,
      notesState: notes ? 'saved' : null,
      recordings,
    });
  }
  return views.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Reads a session's data and builds its calls.
 *
 * @param sessionId The session.
 * @param now       The clock.
 * @returns The calls, newest first.
 * Called from: core/review/load.ts, core/live/afterCall.ts, core/drive/*; tests
 */
export async function loadSessionCalls(
  sessionId: string,
  now: number = Date.now(),
): Promise<CallView[]> {
  const [calls, lines, answers, callNotes, legacyNotes, recordings] = await Promise.all([
    listCalls(sessionId),
    listUtterances(sessionId),
    listAnswers(sessionId),
    listCallNotes(sessionId),
    getNotes(sessionId),
    listRecordings(),
  ]);
  return buildCallViews({
    sessionId,
    calls,
    lines,
    answers,
    callNotes,
    legacyNotes,
    recordings,
    now,
  });
}
