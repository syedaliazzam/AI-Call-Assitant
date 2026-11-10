/**
 * Tests for apps/web/src/core/recording/meetings.ts (desktop 1.5.0, ADR-0068): parts grouped into
 * meetings (newest first, parts in order, totals, status), the words of sizes and lengths, the transcript
 * lines inside one part with their place in the video, and the line being spoken. Invented values.
 */
import { describe, expect, it } from 'vitest';
import {
  currentLineIndex,
  formatBytes,
  formatDuration,
  groupMeetings,
  linesInPart,
} from '@/core/recording/meetings';
import type { StoredRecording, StoredUtterance } from '@/core/storage/types';

/**
 * An invented part.
 * @param id      Its id.
 * @param changes Fields to override.
 * @returns The part.
 */
function part(id: string, changes: Partial<StoredRecording> = {}): StoredRecording {
  return {
    id,
    sessionId: 's1',
    meetingId: 'm1',
    part: 1,
    kind: 'screen',
    startedAt: 10_000,
    durationMs: 60_000,
    bytes: 1_000_000,
    fileName: 'a.mkv',
    hasStereo: true,
    deviceId: 'd1',
    deviceName: 'Laptop',
    status: 'complete',
    updatedAt: 1,
    ...changes,
  };
}

/**
 * An invented transcript line.
 * @param id     Its id.
 * @param tStart When it started (Unix ms).
 * @returns The line.
 */
function line(id: string, tStart: number): StoredUtterance {
  return { id, sessionId: 's1', speaker: 'them', text: 'Invented', tStart, tEnd: tStart + 500 };
}

describe('groupMeetings', () => {
  it('groups parts, newest meeting first, with totals', () => {
    const meetings = groupMeetings([
      part('b', { part: 2, startedAt: 100_000, kind: 'audio', status: 'recovered' }),
      part('a'),
      part('c', { meetingId: 'm2', startedAt: 500_000, kind: 'audio' }),
    ]);
    expect(meetings.map((m) => m.meetingId)).toEqual(['m2', 'm1']);
    const first = meetings[1]!;
    expect(first.parts.map((p) => p.id)).toEqual(['a', 'b']);
    expect(first.durationMs).toBe(120_000);
    expect(first.bytes).toBe(2_000_000);
    expect(first.kind).toBe('screen');
    expect(first.status).toBe('recovered');
    expect(meetings[0]!.kind).toBe('audio');
  });

  it('shows a meeting as recording while any part is', () => {
    const [meeting] = groupMeetings([part('a'), part('b', { part: 2, status: 'recording' })]);
    expect(meeting!.status).toBe('recording');
  });
});

describe('formatBytes and formatDuration', () => {
  it('words sizes', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(820_000)).toBe('820 KB');
    expect(formatBytes(265_000_000)).toBe('265 MB');
    expect(formatBytes(1_420_000_000)).toBe('1.4 GB');
  });

  it('words lengths', () => {
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(725_000)).toBe('12:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
  });
});

describe('linesInPart and currentLineIndex', () => {
  it('keeps the lines inside the part, with their place in the video', () => {
    const lines = [
      line('before', 1_000),
      line('lead', 9_000),
      line('in', 40_000),
      line('after', 80_000),
    ];
    const inside = linesInPart(lines, { startedAt: 10_000, durationMs: 60_000 });
    expect(inside.map((l) => l.line.id)).toEqual(['lead', 'in']);
    expect(inside.map((l) => l.at)).toEqual([0, 30]);
  });

  it('runs to now for a part still being recorded', () => {
    const inside = linesInPart(
      [line('late', 200_000)],
      { startedAt: 10_000, durationMs: 0 },
      300_000,
    );
    expect(inside).toHaveLength(1);
  });

  it('finds the line being spoken', () => {
    const inside = linesInPart([line('a', 10_000), line('b', 20_000)], {
      startedAt: 10_000,
      durationMs: 60_000,
    });
    expect(currentLineIndex(inside, -1)).toBe(-1);
    expect(currentLineIndex(inside, 5)).toBe(0);
    expect(currentLineIndex(inside, 15)).toBe(1);
  });
});
