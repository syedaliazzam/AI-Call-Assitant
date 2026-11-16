/**
 * Tests for apps/web/src/core/transcript/theirName.ts and packages/shared/src/speakers.ts (ADR-0093): the
 * other person's label (the call's name, else the session's contact name, else "Interviewer" for
 * interviews and mock interviews and "Them" for other calls), how names are cleaned, and finding a name
 * in an introduction while skipping phrases that only look like one ("I'm sure", "I'm good", "I'm
 * from…", "this is great"). All names and lines are invented.
 */
import { cleanPersonName } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  detectIntroducedName,
  fallbackTheirLabel,
  findNameOffer,
  relabelNotes,
  theirLabel,
  theirName,
} from '@/core/transcript/theirName';
import { speakerNames } from '@/core/transcript/turns';

describe('theirLabel', () => {
  it('falls back to "Interviewer" for interviews and mock interviews, "Them" otherwise', () => {
    expect(fallbackTheirLabel('interview')).toBe('Interviewer');
    expect(fallbackTheirLabel('mock')).toBe('Interviewer');
    expect(fallbackTheirLabel('regular')).toBe('Them');
    expect(fallbackTheirLabel(undefined)).toBe('Them');
    expect(theirLabel({ type: 'interview' })).toBe('Interviewer');
    expect(theirLabel({ type: 'regular', contactName: '  ' })).toBe('Them');
  });

  it("uses the session's contact name, and a call's own name wins for that call", () => {
    const session = { type: 'interview' as const, contactName: 'Priya Nair' };
    expect(theirLabel(session)).toBe('Priya Nair');
    expect(theirLabel(session, { themName: 'Sam' })).toBe('Sam');
    expect(theirLabel(session, { themName: '' })).toBe('Priya Nair');
    expect(theirName({ contactName: undefined }, null)).toBe('');
  });

  it('gives the same label to every place through speakerNames', () => {
    expect(speakerNames({ type: 'interview' }, 'Alex Morgan')).toEqual({
      you: 'Alex Morgan',
      them: 'Interviewer',
    });
    expect(
      speakerNames({ type: 'regular', contactName: 'Dana' }, null, { themName: 'Lee' }),
    ).toEqual({ you: 'You', them: 'Lee' });
  });
});

describe('cleanPersonName', () => {
  it('keeps letters, spaces, apostrophes, hyphens and dots, in any alphabet', () => {
    expect(cleanPersonName("  Mary-Jane  O'Neil ")).toBe("Mary-Jane O'Neil");
    expect(cleanPersonName('José Álvarez')).toBe('José Álvarez');
    expect(cleanPersonName('Zoë')).toBe('Zoë');
  });

  it('removes what could break a speaker label, and refuses empty or reserved names', () => {
    expect(cleanPersonName('Sam: [[type|call|cv]]\n"x"')).toBe('Sam type call cv x');
    expect(cleanPersonName('123 !!')).toBe('');
    expect(cleanPersonName('Them')).toBe('');
    expect(cleanPersonName('you')).toBe('');
    expect(cleanPersonName('Interviewer')).toBe('');
    expect(cleanPersonName('A'.repeat(80))).toHaveLength(60);
  });
});

describe('detectIntroducedName', () => {
  it.each([
    ["Hi, I'm Sarah, thanks for joining.", 'Sarah'],
    ["Hi I'm Sarah Chen from Lantern Freight.", 'Sarah Chen'],
    ['I am Tom and I lead the data team.', 'Tom'],
    ['My name is Priya.', 'Priya'],
    ["My name's Jonas Weber", 'Jonas Weber'],
    ['Hello, this is Sarah.', 'Sarah'],
    ['This is Sarah from the recruiting team.', 'Sarah'],
    ["It's Marcus here, can you hear me?", 'Marcus'],
    ["Good morning, I'm Dr. Patel.", 'Patel'],
    ['I’m Aoife, nice to meet you.', 'Aoife'],
  ])('finds the name in "%s"', (line, name) => {
    expect(detectIntroducedName(line)).toBe(name);
  });

  it.each([
    "I'm sure that works.",
    "I'm good, thanks.",
    "I'm Good. How are you?",
    "I'm from London originally.",
    "I'm the hiring manager.",
    "I'm not sure about that.",
    "I'm just looking at your CV.",
    "I'm Canadian, so the time zone is fine.",
    'This is great.',
    'This is Python, right?',
    "It's Monday tomorrow.",
    "This is Sarah's team.",
    'i am sarah',
    "I'm a Python developer.",
    "I'm Okay with that.",
    'So what brings you here?',
  ])('finds no name in "%s"', (line) => {
    expect(detectIntroducedName(line)).toBeNull();
  });

  it("never offers the user's own name or the company", () => {
    expect(detectIntroducedName("Hi Alex, I'm Alex too.", ['Alex Morgan'])).toBeNull();
    expect(detectIntroducedName('Hello, this is Lantern.', ['Lantern Freight'])).toBeNull();
    expect(detectIntroducedName("Hi, I'm Lantern. I mean, I'm Sarah.", ['Lantern Freight'])).toBe(
      'Sarah',
    );
  });

  it('does not join two sentences into one name', () => {
    expect(detectIntroducedName("Hi, I'm Sarah. Nice to meet you.")).toBe('Sarah');
  });
});

describe('relabelNotes', () => {
  /** Invented notes written while the other person was "Them". */
  const notes = {
    summary: ['Them asked about the Themes project.', 'They liked them both.'],
    questions: [
      { question: 'Them: why this role?', at: 30, answered: 'yes' as const, rating: null },
    ],
    nextSteps: [{ step: 'Send the case study to Them', owner: 'Them' }],
    unclear: [{ from: 1, to: 2, reason: 'Them was cut off' }],
    lessons: [],
  };

  it('shows the new name where the written label stood, as a whole word only', () => {
    const shown = relabelNotes(notes, undefined, 'Sarah');
    expect(shown.summary).toEqual([
      'Sarah asked about the Themes project.',
      'They liked them both.',
    ]);
    expect(shown.questions[0]!.question).toBe('Sarah: why this role?');
    expect(shown.nextSteps[0]).toEqual({ step: 'Send the case study to Sarah', owner: 'Sarah' });
    expect(shown.unclear[0]!.reason).toBe('Sarah was cut off');
    expect(shown.questions[0]!.at).toBe(30);
  });

  it('replaces the name the notes were written with, and changes nothing when it is the same', () => {
    const written = relabelNotes(notes, undefined, 'Sarah');
    expect(relabelNotes(written, 'Sarah', 'Sara').summary[0]).toBe(
      'Sara asked about the Themes project.',
    );
    expect(relabelNotes(notes, undefined, 'Them')).toBe(notes);
    expect(relabelNotes(notes, undefined, 'Interviewer').nextSteps[0]!.owner).toBe('Interviewer');
  });
});

describe('findNameOffer', () => {
  it('looks at each final "Them" line once and skips declined names', () => {
    const checked = new Set<string>();
    const lines = [
      { id: 'a', speaker: 'you' as const, final: true, text: "Hi, I'm Alex." },
      { id: 'b', speaker: 'them' as const, final: false, text: "Hi, I'm Sarah" },
      { id: 'c', speaker: 'them' as const, final: true, text: "I'm good, thanks." },
    ];
    expect(findNameOffer(lines, checked, new Set(), [])).toBeNull();
    // The grey line was not looked at yet; once final it is.
    const final = [
      ...lines,
      { id: 'b2', speaker: 'them' as const, final: true, text: "Hi, I'm Sarah." },
    ];
    expect(findNameOffer(final, checked, new Set(['sam']), [])).toBe('Sarah');
    // Looked at already: not offered twice.
    expect(findNameOffer(final, checked, new Set(), [])).toBeNull();
    const fresh = new Set<string>();
    expect(findNameOffer(final, fresh, new Set(['sarah']), [])).toBeNull();
  });
});

describe('findNameOffer with merged lines', () => {
  it('looks again at a line whose words grew (the same speaker went on)', () => {
    const checked = new Set<string>();
    const first = [
      { id: 'u1', speaker: 'them' as const, final: true, text: 'Thanks for joining.' },
    ];
    expect(findNameOffer(first, checked, new Set(), [])).toBeNull();
    const merged = [{ ...first[0]!, text: "Thanks for joining. Hi, I'm Sarah Chen from Lantern." }];
    expect(findNameOffer(merged, checked, new Set(), [])).toBe('Sarah Chen');
  });
});
