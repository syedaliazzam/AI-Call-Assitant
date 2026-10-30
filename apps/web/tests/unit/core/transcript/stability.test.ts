/**
 * Tests for apps/web/src/core/transcript/stability.ts, splitStable(), on invented lines: a final
 * line becomes stable exactly 5 s after its end and not 1 ms before; partial lines are never
 * stable; a line stays in the tail while the same speaker's open line could still merge into
 * it, and a "You" line while an open "Them" line could still mark it as an echo; with the real
 * transcript, a stable line is never changed later by a merge or an echo. All text is invented.
 */
import { describe, expect, it } from 'vitest';
import { ECHO_WINDOW_AFTER_MS } from '@/core/transcript/echo';
import { MERGE_GAP_MS } from '@/core/transcript/merge';
import { STABLE_AFTER_MS, splitStable } from '@/core/transcript/stability';
import { createTranscript, type Utterance } from '@/core/transcript/transcript';

/**
 * An invented line.
 *
 * @param id      Line id.
 * @param speaker Who spoke.
 * @param tStart  Start (Unix ms).
 * @param tEnd    End (Unix ms).
 * @param final   False for a partial (grey) line.
 * @returns The line.
 */
function line(
  id: string,
  speaker: 'you' | 'them',
  tStart: number,
  tEnd: number,
  final = true,
): Utterance {
  return { id, speaker, text: `LINE ${id}`, tStart, tEnd, final };
}

/**
 * The ids in each part of a split.
 *
 * @param lines Lines.
 * @param now   Clock.
 * @returns Stable ids and tail ids.
 */
function ids(lines: Utterance[], now: number) {
  const split = splitStable(lines, now);
  return { stable: split.stable.map((l) => l.id), tail: split.tail.map((l) => l.id) };
}

describe('splitStable', () => {
  it('makes a line stable exactly 5 s after it ended', () => {
    const lines = [line('u1', 'them', 1_000, 2_000)];
    expect(ids(lines, 2_000 + STABLE_AFTER_MS - 1)).toEqual({ stable: [], tail: ['u1'] });
    expect(ids(lines, 2_000 + STABLE_AFTER_MS)).toEqual({ stable: ['u1'], tail: [] });
  });

  it('never makes a partial line stable, however old', () => {
    const lines = [line('partial-them', 'them', 1_000, 2_000, false)];
    expect(ids(lines, 60_000)).toEqual({ stable: [], tail: ['partial-them'] });
  });

  it('keeps a line in the tail while the same speaker’s open line could still merge', () => {
    const old = line('u1', 'them', 1_000, 2_000);
    const near = line('partial-them', 'them', 2_000 + MERGE_GAP_MS, 30_000, false);
    const far = line('partial-them', 'them', 2_000 + MERGE_GAP_MS + 1, 30_000, false);
    expect(ids([old, near], 30_000).stable).toEqual([]);
    expect(ids([old, far], 30_000).stable).toEqual(['u1']);
  });

  it('keeps a "You" line in the tail while an open "Them" line could still mark it as echo', () => {
    const you = line('u1', 'you', 1_000, 2_000);
    const themNear = line('partial-them', 'them', 2_000 + ECHO_WINDOW_AFTER_MS, 30_000, false);
    const themFar = line('partial-them', 'them', 2_000 + ECHO_WINDOW_AFTER_MS + 1, 30_000, false);
    expect(ids([you, themNear], 30_000).stable).toEqual([]);
    expect(ids([you, themFar], 30_000).stable).toEqual(['u1']);
    // A "Them" line is never an echo, so an open "You" line far away does not hold it back.
    const them = line('u2', 'them', 1_000, 2_000);
    const youOpen = line('partial-you', 'you', 4_000, 30_000, false);
    expect(ids([them, youOpen], 30_000).stable).toEqual(['u2']);
  });

  it('keeps every line exactly once, in order', () => {
    const lines = [
      line('u1', 'them', 1_000, 2_000),
      line('u2', 'you', 3_000, 4_000),
      line('u3', 'them', 20_000, 21_000),
      line('partial-you', 'you', 22_000, 23_000, false),
    ];
    const split = ids(lines, 24_000);
    expect(split).toEqual({ stable: ['u1', 'u2'], tail: ['u3', 'partial-you'] });
  });

  it('with the real transcript, a stable line is not changed by a later merge or echo', () => {
    let now = 0;
    const transcript = createTranscript(() => now, { schedule: () => () => undefined });
    transcript.addFinal({ speaker: 'them', text: 'WHAT DOES IT COST', tStart: 1_000, tEnd: 2_000 });
    // "Them" keeps talking from 2.5 s (within the merge gap) for a long time.
    transcript.addPartial('them', 'FOR FORTY SEATS ON THE', 2_500);
    now = 20_000;
    expect(splitStable(transcript.lines(), now).stable).toEqual([]);
    transcript.addFinal({
      speaker: 'them',
      text: 'FOR FORTY SEATS ON THE PROFESSIONAL PLAN',
      tStart: 2_500,
      tEnd: 19_000,
    });
    // Merged into one line, which is stable only 5 s after the merged end.
    expect(transcript.lines()).toHaveLength(1);
    expect(splitStable(transcript.lines(), 23_999).stable).toEqual([]);
    expect(splitStable(transcript.lines(), 24_000).stable).toHaveLength(1);
  });
});
