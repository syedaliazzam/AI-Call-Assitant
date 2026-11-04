/**
 * Tests for apps/web/src/core/transcript/group.ts (v1.0.2 transcript bubbles), on invented lines:
 * same-speaker lines with pauses up to 4 s make one bubble and a longer pause or a speaker change
 * starts a new one; a bubble keeps its first line's id as it grows; words still being heard are
 * the bubble's grey tail; "Them" questions are marked; joined lines read as one sentence, and an
 * engine's own punctuation and case are kept.
 */
import { describe, expect, it } from 'vitest';
import { GROUP_GAP_MS, groupLines, type GroupLine } from '@/core/transcript/group';

/**
 * An invented line.
 *
 * @param id      Its id.
 * @param speaker Who spoke.
 * @param text    The words.
 * @param tStart  Start (ms).
 * @param tEnd    End (ms).
 * @param final   False while it may change.
 * @returns The line.
 */
function line(
  id: string,
  speaker: 'you' | 'them',
  text: string,
  tStart: number,
  tEnd: number,
  final = true,
): GroupLine {
  return { id, speaker, text, tStart, tEnd, final };
}

describe('groupLines', () => {
  it('joins same-speaker lines up to the gap and splits after it', () => {
    const groups = groupLines([
      line('a', 'them', 'SO TELL ME', 0, 1_000),
      line('b', 'them', 'ABOUT YOUR LAST PROJECT', 1_000 + GROUP_GAP_MS, 6_000 + GROUP_GAP_MS),
      line('c', 'them', 'AND THE TEAM', 6_001 + 2 * GROUP_GAP_MS, 8_000 + 2 * GROUP_GAP_MS),
    ]);
    expect(groups.map((group) => group.lineIds)).toEqual([['a', 'b'], ['c']]);
    expect(groups[0]!.finalText).toBe('So tell me about your last project');
    expect(groups[0]!.tEnd).toBe(6_000 + GROUP_GAP_MS);
  });

  it('starts a new bubble when the speaker changes, however short the pause', () => {
    const groups = groupLines([
      line('a', 'them', 'WHAT DO YOU DO', 0, 1_000),
      line('b', 'you', 'I BUILD SEARCH SYSTEMS', 1_100, 2_000),
      line('c', 'them', 'GREAT', 2_100, 2_500),
    ]);
    expect(groups.map((group) => [group.speaker, group.lineIds])).toEqual([
      ['them', ['a']],
      ['you', ['b']],
      ['them', ['c']],
    ]);
    expect(groups[1]!.finalText).toBe('I build search systems');
  });

  it('keeps the first line id as the bubble grows', () => {
    const before = groupLines([line('a', 'you', 'HELLO', 0, 500)]);
    const after = groupLines([
      line('a', 'you', 'HELLO', 0, 500),
      line('b', 'you', 'CAN YOU HEAR ME', 2_500, 3_500),
    ]);
    expect(after[0]!.id).toBe(before[0]!.id);
    expect(after).toHaveLength(1);
  });

  it('shows words still being heard as the grey tail of the bubble', () => {
    const [group] = groupLines([
      line('a', 'them', 'HOW WOULD YOU', 0, 1_000),
      line('b', 'them', 'SCALE IT', 3_000, 3_500, false),
    ]);
    expect(group!.finalText).toBe('How would you');
    expect(group!.provisionalText).toBe('scale it');
    expect(group!.final).toBe(false);
    // Nothing is joined after words that may still change.
    const split = groupLines([
      line('a', 'them', 'HOW WOULD YOU', 0, 1_000, false),
      line('b', 'them', 'SCALE IT', 1_500, 2_000),
    ]);
    expect(split).toHaveLength(2);
  });

  it('marks the other person questions, not the user', () => {
    const groups = groupLines([
      line('a', 'them', 'WHAT DOES THE PLAN COST', 0, 1_000),
      line('b', 'you', 'WHAT DO YOU MEAN BY THAT', 2_000, 3_000),
      line('c', 'them', 'IT IS FOR FORTY SEATS', 4_000, 5_000),
      line('d', 'them', 'Is that included?', 20_000, 21_000),
    ]);
    expect(groups.map((group) => group.question)).toEqual([true, false, false, true]);
  });

  it("keeps an engine's own punctuation and capitals after a sentence end", () => {
    const [group] = groupLines([
      line('a', 'them', 'We moved to Kafka last year.', 0, 1_000),
      line('b', 'them', 'The AWS cluster stayed the same.', 2_000, 3_000),
    ]);
    expect(group!.finalText).toBe('We moved to Kafka last year. The AWS cluster stayed the same.');
  });

  it('restores the session spellings and leaves out empty lines', () => {
    const groups = groupLines(
      [line('a', 'them', 'WE USE BLUEFIN ROUTE', 0, 1_000), line('b', 'them', '   ', 1_500, 1_600)],
      { terms: ['Bluefin Route'] },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.finalText).toBe('We use Bluefin Route');
    expect(groups[0]!.lineIds).toEqual(['a']);
  });

  it('starts a new bubble once one is long', () => {
    const long = Array.from({ length: 80 }, () => 'WORD').join(' ');
    const groups = groupLines([
      line('a', 'you', long, 0, 20_000),
      line('b', 'you', 'MORE', 21_000, 22_000),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe('splitting at questions (v1.1.0, item 19)', () => {
  /**
   * Makes a finished line from the other person.
   *
   * @param id     Its id.
   * @param text   Its words.
   * @param tStart Start (ms).
   * @returns The line.
   */
  const them = (id: string, text: string, tStart: number) => ({
    id,
    speaker: 'them' as const,
    text,
    final: true,
    tStart,
    tEnd: tStart + 1_000,
  });

  it('starts a new bubble after a question mark', () => {
    const groups = groupLines([them('a', 'What did you do?', 0), them('b', 'We liked it.', 2_000)]);
    expect(groups.map((group) => group.finalText)).toEqual(['What did you do?', 'We liked it.']);
  });

  it('starts a new bubble for a question after a finished sentence', () => {
    const groups = groupLines([them('a', 'We liked it.', 0), them('b', 'What did you do?', 2_000)]);
    expect(groups).toHaveLength(2);
    expect(groups[1]?.question).toBe(true);
  });

  it('gives two questions in capitals a bubble each', () => {
    const groups = groupLines([
      them('a', 'WHAT DOES THE PLAN COST', 0),
      them('b', 'HOW LONG DOES IT TAKE', 2_000),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('keeps a question a pause cut in two in one bubble', () => {
    const groups = groupLines([
      them('a', 'WHAT DOES THE PLAN COST', 0),
      them('b', 'FOR FORTY SEATS', 2_000),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('keeps statements in one bubble', () => {
    const groups = groupLines([them('a', 'We liked it.', 0), them('b', 'They did too.', 2_000)]);
    expect(groups.map((group) => group.finalText)).toEqual(['We liked it. They did too.']);
  });

  it('splits one written line, with an id for each bubble and the real line id for both', () => {
    const groups = groupLines([them('a', 'We liked it. What did you do?', 0)]);
    expect(groups.map((group) => group.id)).toEqual(['a', 'a#1']);
    expect(groups.map((group) => group.lineIds)).toEqual([['a'], ['a']]);
    expect(groups[1]?.tEnd).toBe(1_000);
  });

  it('closes a written bubble with the right mark, and leaves capitals alone', () => {
    expect(groupLines([them('a', 'What does the plan cost', 0)])[0]?.finalText).toBe(
      'What does the plan cost?',
    );
    expect(groupLines([them('a', 'We liked the results', 0)])[0]?.finalText).toBe(
      'We liked the results.',
    );
    expect(groupLines([them('a', 'WHAT DOES THE PLAN COST', 0)])[0]?.finalText).toBe(
      'What does the plan cost',
    );
  });

  it('never closes words still being heard', () => {
    const [group] = groupLines([{ ...them('a', 'What does the plan', 0), final: false }]);
    expect(group?.finalText).toBe('');
    expect(group?.provisionalText).toBe('What does the plan');
  });
});
