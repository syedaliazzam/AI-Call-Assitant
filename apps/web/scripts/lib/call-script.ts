/**
 * File: apps/web/scripts/lib/call-script.ts
 * Purpose: The script of the synthetic test call (v1.4, ADR-0062 Phase 2) and its ground truth: who says
 *          what, when (pauses, words said over the other person), what each line is (a part of a
 *          question, an answer, talk about the call, a remark, a listening sound, another language), and
 *          so which questions should get exactly one answer. About five minutes. Built from the
 *          investigation's recording script: long questions with a thinking pause, the user's "um" and
 *          "okay" during a question, a multi-part question, "can you repeat that?", "can you hear me?", a
 *          question while a notification plays, and a stretch of another language.
 * Used by: scripts/make-calls.ts (the audio), scripts/stt-calls.ts (the metrics)
 * Depends on: nothing
 * Architecture: docs/decisions/ADR-0063-synthetic-call-harness.md
 *
 * All text is invented. The "other language" lines are romanised Urdu read by an English voice: a
 * stand-in for Urdu or Hindi speech, not a real speaker.
 */

/** What a script line is, for the metrics. */
export type LineRole =
  'question' | 'answer' | 'meta' | 'statement' | 'backchannel' | 'other-language';

/** Where a listening sound is placed: over another line. */
export interface During {
  /** The line it is said over. */
  anchor: string;
  /** How long after that line starts, in ms. */
  atMs: number;
}

/** One line of the script. */
export interface ScriptLine {
  /** Its id ('t01' for "Them", 'y01' for "You"). */
  id: string;
  /** Who says it: "you" is the user (microphone), "them" the other person (the call's sound). */
  speaker: 'you' | 'them';
  /** The words. */
  text: string;
  /** What it is. */
  role: LineRole;
  /** The question it belongs to (lines with the same id make one question), if any. */
  question?: string;
  /**
   * Silence before it, after the previous line in the timeline ends, in ms (default 700). Ignored for a
   * line placed with `during`.
   */
  gapMs?: number;
  /**
   * Said over another line without moving the timeline (a listening sound): starts `atMs` after the
   * start of line `anchor`.
   */
  during?: During;
  /** Starts this long before the previous line in the timeline ends (talking over its end), in ms. */
  overlapMs?: number;
  /** A notification chime on the call's sound, this long after the line starts, in ms. */
  chimeAtMs?: number;
}

/** The script, in order. */
export const CALL_SCRIPT: readonly ScriptLine[] = [
  // Q1: a long question with a thinking pause in the middle.
  {
    id: 't01',
    speaker: 'them',
    role: 'question',
    question: 'q1',
    text: 'So, to start, could you walk me through the most complex backend system you have built, and',
    gapMs: 1_000,
  },
  {
    id: 't02',
    speaker: 'them',
    role: 'question',
    question: 'q1',
    text: 'what you would change about it if you built it again today?',
    gapMs: 2_200,
  },
  {
    id: 'y01',
    speaker: 'you',
    role: 'answer',
    text: 'Sure. The most complex one was our billing platform. It handled invoices for about two hundred thousand customers, and it ran on a queue of small services. If I built it again, I would keep fewer services and spend more time on the data model.',
    gapMs: 900,
  },
  {
    id: 't03',
    speaker: 'them',
    role: 'backchannel',
    text: 'Mm-hm.',
    during: { anchor: 'y01', atMs: 4_500 },
  },
  {
    id: 't04',
    speaker: 'them',
    role: 'backchannel',
    text: 'Right.',
    during: { anchor: 'y01', atMs: 10_500 },
  },
  // Q2: the user's "um" and "okay" while the question is asked, and a pause of about three seconds.
  {
    id: 't05',
    speaker: 'them',
    role: 'question',
    question: 'q2',
    text: 'Okay. Tell me about a time when a production deployment went wrong,',
    gapMs: 900,
  },
  {
    id: 'y02',
    speaker: 'you',
    role: 'backchannel',
    text: 'Um.',
    during: { anchor: 't05', atMs: 4_600 },
  },
  {
    id: 't06',
    speaker: 'them',
    role: 'question',
    question: 'q2',
    text: 'what happened, how you found the root cause,',
    gapMs: 2_800,
  },
  {
    id: 'y03',
    speaker: 'you',
    role: 'backchannel',
    text: 'Okay.',
    during: { anchor: 't06', atMs: 1_200 },
  },
  {
    id: 't07',
    speaker: 'them',
    role: 'question',
    question: 'q2',
    text: 'and what you changed in the process afterwards.',
    gapMs: 800,
  },
  {
    id: 'y04',
    speaker: 'you',
    role: 'answer',
    text: 'Last spring a release broke the invoice export. We saw the error rate climb on our dashboard within ten minutes, rolled back, and found a missing database index. Afterwards we added a load test to every release.',
    gapMs: 1_000,
  },
  // Q3: three questions in one; the user answers two and asks to hear the third again.
  {
    id: 't08',
    speaker: 'them',
    role: 'question',
    question: 'q3',
    text: 'Three quick things about your current role. First, how big is the team?',
    gapMs: 900,
  },
  {
    id: 't09',
    speaker: 'them',
    role: 'question',
    question: 'q3',
    text: 'Second, what does your on call rotation look like?',
    gapMs: 1_000,
  },
  {
    id: 't10',
    speaker: 'them',
    role: 'question',
    question: 'q3',
    text: 'And third, how do you decide what gets tested before a release?',
    gapMs: 900,
  },
  {
    id: 'y05',
    speaker: 'you',
    role: 'answer',
    text: 'The team is twelve engineers, and we rotate on call every week.',
    gapMs: 1_000,
  },
  { id: 'y06', speaker: 'you', role: 'meta', text: 'Sorry, can you repeat that?', gapMs: 600 },
  {
    id: 't11',
    speaker: 'them',
    role: 'question',
    question: 'q4',
    text: 'How do you decide what gets tested before a release?',
    gapMs: 700,
  },
  {
    id: 'y07',
    speaker: 'you',
    role: 'answer',
    text: 'Anything that touches payments gets tests first, and we review the rest by risk.',
    gapMs: 900,
  },
  // Talk about the call.
  {
    id: 't12',
    speaker: 'them',
    role: 'meta',
    text: 'Can you hear me okay? I think my connection dropped for a second.',
    gapMs: 1_500,
  },
  {
    id: 'y08',
    speaker: 'you',
    role: 'meta',
    text: 'Yes, I can hear you now. Can you hear me?',
    gapMs: 700,
  },
  { id: 't13', speaker: 'them', role: 'statement', text: 'Yes, all good.', gapMs: 600 },
  // Q5 while a notification plays on the computer.
  {
    id: 't14',
    speaker: 'them',
    role: 'question',
    question: 'q5',
    text: 'How would you design a caching layer for an API that serves about ten thousand requests per second?',
    gapMs: 900,
    chimeAtMs: 1_800,
  },
  {
    id: 'y09',
    speaker: 'you',
    role: 'answer',
    text: 'I would put a read through cache in front of the database, with short expiry times and a separate path that clears entries on every write.',
    gapMs: 1_200,
  },
  // A remark, a long pause, more remarks.
  {
    id: 't15',
    speaker: 'them',
    role: 'statement',
    text: "That's a really good answer. Let me just pull up my notes.",
    gapMs: 900,
  },
  { id: 't16', speaker: 'them', role: 'statement', text: 'Okay, moving on.', gapMs: 5_000 },
  {
    id: 't17',
    speaker: 'them',
    role: 'question',
    question: 'q6',
    text: 'Why do you want to leave your current company?',
    gapMs: 800,
  },
  {
    id: 'y10',
    speaker: 'you',
    role: 'answer',
    text: 'I want to work on larger systems and grow into a lead role.',
    gapMs: 1_000,
  },
  // Another language on both sides (a stand-in, see the header).
  {
    id: 't18',
    speaker: 'them',
    role: 'other-language',
    text: 'Theek hai, to basically mera sawal yeh hai ke aap ki team mein kitne log kaam karte hain aaj kal.',
    gapMs: 1_000,
  },
  {
    id: 'y11',
    speaker: 'you',
    role: 'other-language',
    text: 'Haan bilkul, main samajh gaya, hamari team mein takreeban baara log hain aur sab ghar se kaam karte hain.',
    gapMs: 900,
  },
  // Q7, with the user starting before it ends.
  {
    id: 't19',
    speaker: 'them',
    role: 'question',
    question: 'q7',
    text: 'Last one, what questions do you have for us?',
    gapMs: 1_000,
  },
  {
    id: 'y12',
    speaker: 'you',
    role: 'answer',
    text: 'Actually yes, I wanted to ask about how the team is structured.',
    overlapMs: 500,
  },
  {
    id: 't20',
    speaker: 'them',
    role: 'statement',
    text: 'Great, thanks for your time today.',
    gapMs: 1_500,
  },
  { id: 'y13', speaker: 'you', role: 'statement', text: 'Thank you.', gapMs: 500 },
];

/** Silence after the last line (nobody speaks), in ms: noise must not make lines here. */
export const TRAILING_SILENCE_MS = 30_000;

/** Silence before the first line, in ms. */
export const LEADING_SILENCE_MS = 3_000;

/** A question that should get exactly one answer, with the script lines that make it. */
export interface ExpectedQuestion {
  /** The question id ('q1'…). */
  id: string;
  /** Its lines' ids, in order. */
  lineIds: string[];
}

/**
 * The questions of the script, each with its lines.
 *
 * @param script The script (default CALL_SCRIPT).
 * @returns One entry per question id, in order.
 * Called from: stt-calls.ts; tests
 */
export function expectedQuestions(script: readonly ScriptLine[] = CALL_SCRIPT): ExpectedQuestion[] {
  const byId = new Map<string, string[]>();
  for (const line of script) {
    if (!line.question) continue;
    byId.set(line.question, [...(byId.get(line.question) ?? []), line.id]);
  }
  return [...byId].map(([id, lineIds]) => ({ id, lineIds }));
}

/** A script line placed on the timeline. */
export interface PlacedLine extends ScriptLine {
  /** Start, ms from the start of the call audio. */
  startMs: number;
  /** End, ms from the start of the call audio. */
  endMs: number;
}

/**
 * Places the lines on the timeline from their spoken lengths.
 *
 * @param script    The script.
 * @param durations Each line's spoken length in ms, by id.
 * @returns The lines with start and end, in script order, and the call's total length in ms.
 * @throws Error when a line has no length or `during` names an unknown line.
 * Called from: make-calls.ts, stt-calls.ts; tests
 */
export function placeLines(
  script: readonly ScriptLine[],
  durations: ReadonlyMap<string, number>,
): { lines: PlacedLine[]; totalMs: number } {
  const placed: PlacedLine[] = [];
  let cursor = LEADING_SILENCE_MS;
  let lastEnd = cursor;
  for (const line of script) {
    const length = durations.get(line.id);
    if (length === undefined) throw new Error(`no audio length for ${line.id}`);
    if (line.during) {
      const anchor = placed.find((item) => item.id === line.during!.anchor);
      if (!anchor) throw new Error(`${line.id}: unknown anchor ${line.during.anchor}`);
      const startMs = anchor.startMs + line.during.atMs;
      placed.push({ ...line, startMs, endMs: startMs + length });
      lastEnd = Math.max(lastEnd, startMs + length);
      continue;
    }
    const startMs =
      line.overlapMs !== undefined ? cursor - line.overlapMs : cursor + (line.gapMs ?? 700);
    placed.push({ ...line, startMs, endMs: startMs + length });
    cursor = startMs + length;
    lastEnd = Math.max(lastEnd, cursor);
  }
  return { lines: placed, totalMs: lastEnd + TRAILING_SILENCE_MS };
}
