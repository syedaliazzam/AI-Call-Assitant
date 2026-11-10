/**
 * File: apps/web/src/core/recording/meetings.ts
 * Purpose: What the Meetings page and the player show (desktop 1.5.0, ADR-0068): recording parts grouped
 *          into meetings (one call; starting again in it makes a new part), their total length and size,
 *          the words of sizes and lengths, and the transcript lines that fall inside one part, each with
 *          its place in the video (for click-to-seek).
 * Used by: src/features/meetings/MeetingsPage.tsx, src/features/meetings/RecordingPlayer.tsx
 * Depends on: src/core/storage/types.ts (types only)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md
 */
import type { RecordingStatus, StoredRecording, StoredUtterance } from '@/core/storage/types';

/** One meeting: the parts of one call, first part first. */
export interface MeetingGroup {
  /** The meeting's id. */
  meetingId: string;
  /** Its session. */
  sessionId: string;
  /** When its first part started (Unix ms). */
  startedAt: number;
  /** All parts' lengths together, ms. */
  durationMs: number;
  /** All parts' main files together, bytes. */
  bytes: number;
  /** The computer that holds the files (the first part's). */
  deviceId: string;
  /** Its name. */
  deviceName: string;
  /** 'screen' when any part has video, else 'audio'. */
  kind: 'screen' | 'audio';
  /** 'recording' while a part is being recorded; 'recovered' when any part was; else 'complete'. */
  status: RecordingStatus;
  /** The parts, first first. */
  parts: StoredRecording[];
}

/**
 * Groups recording parts into meetings, newest meeting first.
 * @param records Every recording record.
 * @returns The meetings.
 * Called from: MeetingsPage.tsx; tests
 */
export function groupMeetings(records: readonly StoredRecording[]): MeetingGroup[] {
  const byMeeting = new Map<string, StoredRecording[]>();
  for (const record of records) {
    const list = byMeeting.get(record.meetingId) ?? [];
    list.push(record);
    byMeeting.set(record.meetingId, list);
  }
  const meetings = [...byMeeting.entries()].map(([meetingId, list]): MeetingGroup => {
    const parts = [...list].sort((a, b) => a.part - b.part || a.startedAt - b.startedAt);
    const first = parts[0]!;
    const status: RecordingStatus = parts.some((p) => p.status === 'recording')
      ? 'recording'
      : parts.some((p) => p.status === 'recovered')
        ? 'recovered'
        : 'complete';
    return {
      meetingId,
      sessionId: first.sessionId,
      startedAt: Math.min(...parts.map((p) => p.startedAt)),
      durationMs: parts.reduce((sum, p) => sum + p.durationMs, 0),
      bytes: parts.reduce((sum, p) => sum + p.bytes, 0),
      deviceId: first.deviceId,
      deviceName: first.deviceName,
      kind: parts.some((p) => p.kind === 'screen') ? 'screen' : 'audio',
      status,
      parts,
    };
  });
  return meetings.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * A size in words: "820 KB", "265 MB", "1.4 GB".
 * @param bytes The size.
 * @returns The words ('—' for 0, a part still being recorded).
 * Called from: MeetingsPage.tsx, RecordingPlayer.tsx; tests
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * A length in words: "12:05", or "1:02:03" from an hour.
 * @param ms The length.
 * @returns The words ('—' for 0).
 * Called from: MeetingsPage.tsx, RecordingPlayer.tsx; tests
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** A transcript line inside a part, with its place in the video. */
export interface PartLine {
  /** The line. */
  line: StoredUtterance;
  /** Seconds from the start of the part's video. */
  at: number;
}

/** Lines that started this long before a part are still its first words (speech already under way). */
const LEAD_MS = 2_000;

/**
 * The transcript lines spoken during one part, in order, each with its place in the video.
 * @param lines  The session's saved lines.
 * @param part   The part.
 * @param nowMs  The clock (a part still being recorded runs until now).
 * @returns The lines inside the part.
 * Called from: RecordingPlayer.tsx; tests
 */
export function linesInPart(
  lines: readonly StoredUtterance[],
  part: Pick<StoredRecording, 'startedAt' | 'durationMs'>,
  nowMs: number = Date.now(),
): PartLine[] {
  const end = part.durationMs > 0 ? part.startedAt + part.durationMs : nowMs;
  return lines
    .filter((line) => line.tStart >= part.startedAt - LEAD_MS && line.tStart <= end)
    .sort((a, b) => a.tStart - b.tStart)
    .map((line) => ({ line, at: Math.max(0, (line.tStart - part.startedAt) / 1000) }));
}

/**
 * The line being spoken at a point of the video (the last one that started at or before it).
 * @param lines   The part's lines.
 * @param seconds The video's time.
 * @returns The line's index, or -1 before the first.
 * Called from: RecordingPlayer.tsx; tests
 */
export function currentLineIndex(lines: readonly PartLine[], seconds: number): number {
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.at <= seconds) found = i;
    else break;
  }
  return found;
}
