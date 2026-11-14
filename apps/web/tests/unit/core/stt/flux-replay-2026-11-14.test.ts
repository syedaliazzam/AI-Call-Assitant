/**
 * Replay of the 14 Nov 2026 test call (docs/investigations/2026-11-14-test-call-issues.md, R1, issues 3
 * and 4) through apps/web/src/core/stt/deepgram.ts (FluxAssembler, Batch D P0-A) and
 * apps/web/src/core/transcript/transcript.ts (merge guard, Batch D P1-D).
 *
 * The data is the call timing log's line records: ids and times only (seconds from the call's start,
 * rounded to 0.1 s), no words. For each stretch: the start the app recorded (`a`, which for "Them" was
 * Flux's audio window start, i.e. the previous turn's end), its end (`b`), when its first words reached the
 * app (`p`) and when it became final (`f`). Words in this test are placeholders.
 *
 * What it shows:
 * - P0-A: replayed through FluxAssembler, every "Them" line starts after the user's reply before it, so
 *   the transcript reads Them / You / Them, no "Them" turns join across a reply, and every reply counts as
 *   one (none "started over Them").
 * - P1-D: even with the recorded (wrong) starts, no two "Them" stretches join across the user's reply.
 */
import { describe, expect, it } from 'vitest';
import { FluxAssembler, type CloudEvent } from '@/core/stt/deepgram';
import { lastReplyIndex } from '@/core/transcript/question';
import { startedOverThem } from '@/core/transcript/reply';
import { createTranscript, type Utterance } from '@/core/transcript/transcript';

/** One stretch of the call: id, speaker, recorded start/end, first words shown, final (s from start). */
interface Stretch {
  /** The line id the app gave it (the same id twice means the app joined the stretches). */
  id: string;
  /** Who spoke. */
  s: 'you' | 'them';
  /** Recorded start, s. */
  a: number;
  /** Recorded end, s. */
  b: number;
  /** First words reached the app, s. */
  p: number;
  /** Became final, s. */
  f: number;
}

/** The 14 Nov call's 56 stretches, in the order the log recorded them (ids and times only). */
const CALL: readonly Stretch[] = [
  { id: 'u1', s: 'you', a: 8.1, b: 10.1, p: 3.2, f: 12 },
  { id: 'u2', s: 'them', a: 0.1, b: 16.5, p: 14.7, f: 16.9 },
  { id: 'u3', s: 'you', a: 19.3, b: 21.6, p: 20.3, f: 22.2 },
  { id: 'u4', s: 'them', a: 16.7, b: 23.4, p: 23.4, f: 24 },
  { id: 'u5', s: 'them', a: 23.7, b: 26.1, p: 24.4, f: 26.5 },
  { id: 'u6', s: 'you', a: 28.6, b: 33.9, p: 29.4, f: 34.9 },
  { id: 'u5', s: 'them', a: 26.2, b: 39.6, p: 35.6, f: 40.3 },
  { id: 'u9', s: 'you', a: 42.4, b: 51.1, p: 43.6, f: 52.8 },
  { id: 'u10', s: 'them', a: 40.1, b: 58.5, p: 53.1, f: 58.9 },
  { id: 'u11', s: 'you', a: 61.6, b: 75.6, p: 62.5, f: 76.4 },
  { id: 'u12', s: 'them', a: 58.6, b: 82.5, p: 77.6, f: 82.8 },
  { id: 'u14', s: 'you', a: 87.1, b: 91.6, p: 88.2, f: 92.8 },
  { id: 'u16', s: 'them', a: 82.5, b: 94.1, p: 93.1, f: 94.5 },
  { id: 'u17', s: 'you', a: 94.4, b: 95.8, p: 94.8, f: 97.2 },
  { id: 'u17', s: 'you', a: 97, b: 97.5, p: 98.2, f: 98.2 },
  { id: 'u17', s: 'you', a: 97.1, b: 97.5, p: 99.2, f: 101.6 },
  { id: 'u20', s: 'you', a: 103.7, b: 105.9, p: 104.9, f: 107.5 },
  { id: 'u21', s: 'them', a: 94.2, b: 108.4, p: 107.9, f: 108.7 },
  { id: 'u22', s: 'you', a: 110.5, b: 111.6, p: 111.6, f: 113.4 },
  { id: 'u23', s: 'them', a: 108.5, b: 117.1, p: 113.2, f: 117.4 },
  { id: 'u24', s: 'you', a: 121.9, b: 125.5, p: 123.2, f: 126.7 },
  { id: 'u23', s: 'them', a: 117.2, b: 131.3, p: 127.5, f: 131.6 },
  { id: 'u26', s: 'you', a: 134.3, b: 142.8, p: 135.6, f: 144.4 },
  { id: 'u27', s: 'them', a: 131.3, b: 147.1, p: 144.7, f: 147.4 },
  { id: 'u29', s: 'you', a: 149, b: 151.6, p: 150.3, f: 152.6 },
  { id: 'u30', s: 'them', a: 147.2, b: 154.1, p: 153.4, f: 154.5 },
  { id: 'u31', s: 'them', a: 154.3, b: 154.9, p: 155.1, f: 155.3 },
  { id: 'u32', s: 'you', a: 158.9, b: 161.4, p: 160.1, f: 162.1 },
  { id: 'u31', s: 'them', a: 155, b: 163.3, p: 163.1, f: 163.6 },
  { id: 'u34', s: 'them', a: 163.3, b: 164.2, p: 164, f: 164.5 },
  { id: 'u34', s: 'them', a: 164.3, b: 165.3, p: 165, f: 165.8 },
  { id: 'u36', s: 'you', a: 173.8, b: 175.4, p: 175.2, f: 177.2 },
  { id: 'u34', s: 'them', a: 165.5, b: 178.5, p: 177.3, f: 178.9 },
  { id: 'u38', s: 'you', a: 192.8, b: 195.3, p: 194.2, f: 196.4 },
  { id: 'u39', s: 'them', a: 178.7, b: 201.5, p: 197.5, f: 202 },
  { id: 'u40', s: 'you', a: 204.6, b: 215.1, p: 205.9, f: 217.2 },
  { id: 'u41', s: 'them', a: 201.7, b: 217.2, p: 217.1, f: 217.9 },
  { id: 'u42', s: 'them', a: 217.7, b: 221.4, p: 218.4, f: 221.8 },
  { id: 'u42', s: 'them', a: 221.5, b: 222.1, p: 222.3, f: 222.5 },
  { id: 'u44', s: 'you', a: 225.4, b: 240.5, p: 226, f: 241.8 },
  { id: 'u42', s: 'them', a: 222.2, b: 242.9, p: 242.6, f: 243.2 },
  { id: 'u46', s: 'them', a: 242.9, b: 247.6, p: 243.9, f: 247.9 },
  { id: 'u47', s: 'you', a: 254.1, b: 259.3, p: 254.8, f: 260.3 },
  { id: 'u46', s: 'them', a: 247.7, b: 262.2, p: 261.1, f: 262.6 },
  { id: 'u49', s: 'you', a: 262.4, b: 263.9, p: 263.3, f: 264.7 },
  { id: 'u49', s: 'you', a: 265.3, b: 268.6, p: 266.7, f: 269.4 },
  { id: 'u51', s: 'them', a: 262.3, b: 272.6, p: 270.5, f: 273 },
  { id: 'u52', s: 'them', a: 272.7, b: 273.9, p: 273.4, f: 274.4 },
  { id: 'u53', s: 'you', a: 280.3, b: 284.7, p: 281.4, f: 285.4 },
  { id: 'u52', s: 'them', a: 274.1, b: 291, p: 286.6, f: 291.4 },
  { id: 'u55', s: 'you', a: 295.4, b: 297.4, p: 296.2, f: 298.7 },
  { id: 'u56', s: 'them', a: 291.2, b: 301.1, p: 299.3, f: 301.6 },
  { id: 'u56', s: 'them', a: 301.3, b: 309, p: 307.8, f: 309.5 },
  { id: 'u57', s: 'you', a: 303.5, b: 305.9, p: 305, f: 312.6 },
  { id: 'u59', s: 'you', a: 316.7, b: 318.4, p: 318.2, f: 319.3 },
  { id: 'u60', s: 'them', a: 309.3, b: 324, p: 320.8, f: 324.4 },
];

/** The call's start on the capture clock (Unix ms). */
const BASE = 1_763_000_000_000;

/**
 * Call seconds → Unix ms.
 *
 * @param seconds Seconds from the call's start.
 * @returns Unix ms on the capture clock.
 */
const at = (seconds: number) => Math.round(BASE + seconds * 1000);

/**
 * How long Flux's first words took to reach the app after their audio was processed (s): the measured
 * real-call p50 of investigation C3 (0.30 s), so the first message's window end ≈ p − 0.3.
 */
const ARRIVAL_S = 0.3;

/** Placeholder words (never real call text): different for each side, so no echo rule fires. */
const WORDS = {
  them: 'could you describe the system design please',
  you: 'sure I built pipelines with python',
};

/** A line as Transcript.addFinal() takes it. */
interface ReplayLine {
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** Placeholder words. */
  text: string;
  /** Start (Unix ms). */
  tStart: number;
  /** End (Unix ms). */
  tEnd: number;
  /** The engine's own end of turn ended it. */
  endOfTurn?: boolean;
}

/** A final line ready for Transcript.addFinal(), with when it became final. */
interface FinalAt {
  /** When it became final (s), the order lines reach the transcript. */
  f: number;
  /** The id in the recorded log (for the assertions). */
  id: string;
  /** The line. */
  line: ReplayLine;
}

/**
 * Replays one "Them" stretch as a Flux turn: the window opens at the recorded start (the previous turn's
 * end), silent updates follow, the first words arrive at p − ARRIVAL_S, the words last change at the end,
 * then EndOfTurn.
 *
 * @param flux  The assembler (one per channel, as in the app).
 * @param index The turn index.
 * @param x     The stretch.
 * @returns The final line.
 */
function fluxTurn(flux: FluxAssembler, index: number, x: Stretch): ReplayLine {
  const firstWordsAt = Math.min(x.p - ARRIVAL_S, x.b);
  const events: CloudEvent[] = [];
  const send = (event: string, windowEnd: number, transcript: string) =>
    events.push(
      ...flux.handle({
        type: 'TurnInfo',
        event,
        turn_index: index,
        audio_window_start: x.a,
        audio_window_end: windowEnd,
        transcript,
      }),
    );
  if (firstWordsAt - 0.24 > x.a) send('Update', firstWordsAt - 0.24, '');
  send('StartOfTurn', firstWordsAt, 'could you');
  send('Update', x.b, WORDS.them);
  send('EndOfTurn', Math.max(x.b, x.f - ARRIVAL_S), WORDS.them);
  const final = events.find((event) => event.type === 'final');
  if (final?.type !== 'final') throw new Error('no final line');
  return {
    speaker: 'them',
    text: final.text,
    tStart: final.tStart,
    tEnd: final.tEnd,
    endOfTurn: true,
  };
}

/**
 * Builds the call's final lines, in the order they became final.
 *
 * @param themStart 'flux' replays "Them" through FluxAssembler (P0-A); 'recorded' uses the logged start.
 * @returns The lines.
 */
function finals(themStart: 'flux' | 'recorded'): FinalAt[] {
  const flux = new FluxAssembler((seconds) => at(seconds));
  let turnIndex = 0;
  return CALL.map((x) => ({
    f: x.f,
    id: x.id,
    line:
      x.s === 'them' && themStart === 'flux'
        ? fluxTurn(flux, turnIndex++, x)
        : {
            speaker: x.s,
            text: WORDS[x.s],
            tStart: at(x.a),
            tEnd: at(x.b),
            ...(x.s === 'them' ? { endOfTurn: true } : {}),
          },
  })).sort((left, right) => left.f - right.f);
}

/**
 * Feeds the lines into a transcript and returns its final lines in display order.
 *
 * @param lines The lines in arrival order.
 * @returns The stored final lines.
 */
function replay(lines: readonly FinalAt[]): Utterance[] {
  let now = BASE;
  const transcript = createTranscript(() => now, { schedule: () => () => undefined });
  for (const item of lines) {
    now = at(item.f);
    transcript.addFinal(item.line);
  }
  now = at(400);
  return transcript.lines().filter((line) => line.final && !line.echo);
}

/** The four places the investigation's issue 4 table shows a "Them" join across a reply (by You id). */
const REPLIES_THAT_WERE_SKIPPED = [
  { you: 28.6, themBefore: 26.1, themAfter: 39.6 },
  { you: 121.9, themBefore: 117.1, themAfter: 131.3 },
  { you: 225.4, themBefore: 222.1, themAfter: 242.9 },
  { you: 254.1, themBefore: 247.6, themAfter: 262.2 },
];

/**
 * Whether a "Them" line joins stretches across a real "You" line (one that ends between two of its
 * stretches).
 *
 * @param them  A "Them" line.
 * @param lines All final lines.
 * @returns True when it does.
 */
function joinsAcrossReply(them: Utterance, lines: readonly Utterance[]): boolean {
  const segments = them.segments ?? [];
  return segments.slice(1).some((segment, index) => {
    const before = segments[index]!;
    return lines.some(
      (line) => line.speaker === 'you' && line.tEnd > before.tEnd && line.tEnd <= segment.tEnd,
    );
  });
}

/**
 * Whether a line, or one of its joined stretches, ends at a moment.
 *
 * @param line A line.
 * @param end  The moment (Unix ms).
 * @returns True when it does.
 */
function endsAt(line: Utterance, end: number): boolean {
  return line.tEnd === end || (line.segments ?? []).some((segment) => segment.tEnd === end);
}

describe('14 Nov 2026 call replay (ids and times only)', () => {
  it('P0-A: Them / You / Them order, no joins across replies, every reply counts', () => {
    const lines = replay(finals('flux'));
    // No "Them" line joins two stretches with a reply in between.
    for (const them of lines.filter((line) => line.speaker === 'them')) {
      expect(joinsAcrossReply(them, lines)).toBe(false);
    }
    // The four joins of issue 4 are three lines each, in spoken order.
    for (const place of REPLIES_THAT_WERE_SKIPPED) {
      const you = lines.findIndex(
        (line) => line.speaker === 'you' && line.tStart === at(place.you),
      );
      expect(you).toBeGreaterThan(0);
      const before = lines[you - 1]!;
      const after = lines[you + 1]!;
      expect(before.speaker).toBe('them');
      expect(endsAt(before, at(place.themBefore))).toBe(true);
      expect(after.speaker).toBe('them');
      expect(endsAt(after, at(place.themAfter))).toBe(true);
      expect(after.id).not.toBe(before.id);
      // The next question starts after the reply ended (issue 3: answers no longer sort above replies).
      expect(after.tStart).toBeGreaterThan(lines[you]!.tEnd);
    }
    // Issue 3: the opening "Them" line comes after the user's first line, as it was spoken.
    expect(lines[0]!.speaker).toBe('you');
    expect(lines[1]!.speaker).toBe('them');
    // Issue 1: every real "You" line counts as a reply (none started over Them), so a reply ends a question.
    const replies = lines.filter(
      (line) => line.speaker === 'you' && line.text.split(' ').length > 2,
    );
    expect(replies.length).toBeGreaterThan(10);
    for (const reply of replies) expect(startedOverThem(reply, lines)).toBe(false);
    expect(lastReplyIndex(lines)).toBe(lines.findLastIndex((line) => line.speaker === 'you'));
  });

  it('P1-D: with the recorded (wrong) starts, no "Them" stretches join across a reply', () => {
    const lines = replay(finals('recorded'));
    for (const them of lines.filter((line) => line.speaker === 'them')) {
      expect(joinsAcrossReply(them, lines)).toBe(false);
    }
    // The stretch after each skipped reply is a line of its own (before P1-D it joined the one before).
    for (const place of REPLIES_THAT_WERE_SKIPPED) {
      const after = lines.find(
        (line) => line.speaker === 'them' && endsAt(line, at(place.themAfter)),
      );
      const before = lines.find(
        (line) => line.speaker === 'them' && endsAt(line, at(place.themBefore)),
      );
      expect(after).toBeDefined();
      expect(before).toBeDefined();
      expect(after!.id).not.toBe(before!.id);
    }
  });
});
