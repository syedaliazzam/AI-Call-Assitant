/**
 * Tests for apps/web/scripts/lib/call-script.ts (v1.4, ADR-0063): the script holds every case the plan
 * asks for (a thinking pause, the user's "um" and "okay" during a question, a multi-part question,
 * "can you repeat that?", "can you hear me?", a notification, another language); its questions are
 * listed with their lines; placeLines() follows the gaps, places listening sounds over a line without
 * moving the timeline, starts an overlapping reply before the line it talks over ends, and adds the
 * silences.
 */
import { describe, expect, it } from 'vitest';
import {
  CALL_SCRIPT,
  expectedQuestions,
  LEADING_SILENCE_MS,
  placeLines,
  TRAILING_SILENCE_MS,
  type ScriptLine,
} from '../../../scripts/lib/call-script';

describe('call-script', () => {
  it('covers every case of the plan', () => {
    const text = CALL_SCRIPT.map((line) => line.text.toLowerCase()).join(' | ');
    expect(text).toContain('can you repeat that');
    expect(text).toContain('can you hear me');
    expect(CALL_SCRIPT.some((line) => line.chimeAtMs !== undefined)).toBe(true);
    expect(
      CALL_SCRIPT.filter((line) => line.role === 'other-language')
        .map((line) => line.speaker)
        .sort(),
    ).toEqual(['them', 'you']);
    expect(
      CALL_SCRIPT.some(
        (line) => line.speaker === 'you' && line.role === 'backchannel' && line.during,
      ),
    ).toBe(true);
    expect(CALL_SCRIPT.some((line) => (line.gapMs ?? 0) >= 2_000 && line.question)).toBe(true);
  });

  it('lists the questions with their lines', () => {
    const questions = expectedQuestions();
    expect(questions.map((question) => question.id)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
      'q5',
      'q6',
      'q7',
    ]);
    expect(questions.find((question) => question.id === 'q3')?.lineIds).toEqual([
      't08',
      't09',
      't10',
    ]);
  });

  it('places lines by their gaps, overlaps and listening sounds', () => {
    const script: ScriptLine[] = [
      { id: 'a', speaker: 'them', role: 'question', text: 'a', gapMs: 0 },
      {
        id: 'b',
        speaker: 'you',
        role: 'backchannel',
        text: 'b',
        during: { anchor: 'a', atMs: 100 },
      },
      { id: 'c', speaker: 'them', role: 'question', text: 'c', gapMs: 500 },
      { id: 'd', speaker: 'you', role: 'answer', text: 'd', overlapMs: 200 },
    ];
    const durations = new Map([
      ['a', 1_000],
      ['b', 300],
      ['c', 1_000],
      ['d', 1_000],
    ]);
    const { lines, totalMs } = placeLines(script, durations);
    const at = Object.fromEntries(lines.map((line) => [line.id, [line.startMs, line.endMs]]));
    const t0 = LEADING_SILENCE_MS;
    expect(at).toEqual({
      a: [t0, t0 + 1_000],
      b: [t0 + 100, t0 + 400],
      c: [t0 + 1_500, t0 + 2_500],
      d: [t0 + 2_300, t0 + 3_300],
    });
    expect(totalMs).toBe(t0 + 3_300 + TRAILING_SILENCE_MS);
    expect(() => placeLines(script, new Map())).toThrow('no audio length');
  });
});
