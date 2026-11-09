/**
 * Tests: apps/web/src/core/transcript/turns.ts (v1.3.2). Consecutive parts of one speaker merge into a
 * turn; a speaker change or a pause over 8 s starts a new one; words still settling end a turn; noise
 * stays apart only when asked (the live panel). The mm:ss clock, and the speaker names.
 */
import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  lineTurns,
  mergeTurns,
  speakerNames,
  TURN_GAP_MS,
  type TurnPart,
} from '@/core/transcript/turns';

/**
 * An invented part.
 *
 * @param id       Its id.
 * @param speaker  Who spoke.
 * @param tStart   Start (ms).
 * @param tEnd     End (ms).
 * @param text     Its finished words.
 * @param extra    Other fields.
 * @returns The part.
 */
function part(
  id: string,
  speaker: 'you' | 'them',
  tStart: number,
  tEnd: number,
  text = `Words ${id}.`,
  extra: Partial<TurnPart> = {},
): TurnPart {
  return { id, speaker, finalText: text, provisionalText: '', tStart, tEnd, ...extra };
}

describe('mergeTurns', () => {
  it('merges consecutive parts of one speaker into one turn, with their words joined', () => {
    const turns = mergeTurns([part('a', 'them', 0, 1_000), part('b', 'them', 3_000, 4_000)]);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      id: 'a',
      speaker: 'them',
      tStart: 0,
      tEnd: 4_000,
      finalText: 'Words a. Words b.',
    });
  });

  it('starts a new turn when the speaker changes', () => {
    const turns = mergeTurns([
      part('a', 'them', 0, 1_000),
      part('b', 'you', 1_500, 2_000),
      part('c', 'them', 2_500, 3_000),
    ]);
    expect(turns.map((turn) => turn.id)).toEqual(['a', 'b', 'c']);
  });

  it('starts a new turn after a pause over 8 s, and keeps one of exactly 8 s', () => {
    const exactly = mergeTurns([
      part('a', 'you', 0, 1_000),
      part('b', 'you', 1_000 + TURN_GAP_MS, 10_000),
    ]);
    expect(exactly).toHaveLength(1);
    const over = mergeTurns([
      part('a', 'you', 0, 1_000),
      part('b', 'you', 1_001 + TURN_GAP_MS, 10_000),
    ]);
    expect(over.map((turn) => turn.id)).toEqual(['a', 'b']);
  });

  it('puts words still settling at the end of a turn, and nothing after them', () => {
    const turns = mergeTurns([
      part('a', 'them', 0, 1_000),
      part('b', 'them', 1_500, 2_000, '', { provisionalText: 'still hearing' }),
      part('c', 'them', 2_100, 2_500),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ finalText: 'Words a.', provisionalText: 'still hearing' });
    expect(turns[1]!.id).toBe('c');
  });

  it('keeps noise apart only when asked; leaves out empty parts', () => {
    const parts = [
      part('a', 'them', 0, 1_000),
      part('b', 'them', 1_500, 2_000, 'Mm hm.', { unclear: true }),
      part('c', 'them', 2_500, 3_000, '  '),
    ];
    expect(mergeTurns(parts)).toHaveLength(1);
    const apart = mergeTurns(parts, { keepUnclearApart: true });
    expect(apart.map((turn) => [turn.id, turn.unclear])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('counts a part without an end (an older live page) as ending where it starts', () => {
    const turns = mergeTurns([
      { id: 'a', speaker: 'you', finalText: 'One.', provisionalText: '', tStart: 0 },
      { id: 'b', speaker: 'you', finalText: 'Two.', provisionalText: '', tStart: 7_000 },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.tEnd).toBe(7_000);
  });
});

describe('lineTurns', () => {
  it('turns saved lines into sentence-cased turns that keep their line ids', () => {
    const turns = lineTurns(
      [
        { id: 's:c:u1', speaker: 'them', text: 'HOW DID YOU', tStart: 0, tEnd: 1_000 },
        { id: 's:c:u2', speaker: 'them', text: 'SCALE THE PIPELINE', tStart: 6_000, tEnd: 7_000 },
        { id: 's:c:u3', speaker: 'you', text: 'with lantern queues', tStart: 8_000, tEnd: 9_000 },
      ],
      ['Lantern'],
    );
    expect(turns.map((turn) => turn.parts.flatMap((p) => p.lineIds))).toEqual([
      ['s:c:u1', 's:c:u2'],
      ['s:c:u3'],
    ]);
    expect(turns[0]!.finalText).toMatch(/^How did you/);
    expect(turns[1]!.finalText).toContain('Lantern');
  });
});

describe('formatElapsed', () => {
  it('writes mm:ss, minutes not capped at 59, and 00:00 before the start', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(4_999)).toBe('00:04');
    expect(formatElapsed(65_000)).toBe('01:05');
    expect(formatElapsed(75 * 60_000 + 3_000)).toBe('75:03');
    expect(formatElapsed(-2_000)).toBe('00:00');
    expect(formatElapsed(Number.NaN)).toBe('00:00');
  });
});

describe('speakerNames', () => {
  it("uses the account's name and the session's name for the other person", () => {
    expect(speakerNames({ contactName: ' Dana ' }, 'Sam Rivera')).toEqual({
      you: 'Sam Rivera',
      them: 'Dana',
    });
  });

  it('falls back to You and Them', () => {
    expect(speakerNames({ contactName: '' }, '  ')).toEqual({ you: 'You', them: 'Them' });
    expect(speakerNames(null)).toEqual({ you: 'You', them: 'Them' });
  });
});
