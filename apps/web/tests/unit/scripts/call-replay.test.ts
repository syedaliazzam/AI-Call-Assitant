/**
 * Tests for apps/web/scripts/lib/call-replay.ts (v1.4, ADR-0063) with the app's real modules: a question
 * cut by a thinking pause becomes one line and one card with the whole question; talk about the call gets
 * no card; another language is marked; a fragment answer is asked again on the same card (a rerun); and
 * with the rules from before ADR-0062 (a stand-in for that version's autoAnswerDue) the same call gives a
 * card for the fragment.
 */
import { describe, expect, it } from 'vitest';
import * as autoAnswer from '@/core/answer/autoAnswer';
import { createRepeatGuard, themSpan } from '@/core/answer/repeatGuard';
import { looksNonEnglish } from '@/core/stt/language';
import { groupLines } from '@/core/transcript/group';
import { pickQuestion } from '@/core/transcript/questionKind';
import { createTranscript } from '@/core/transcript/transcript';
import { mergeTurns } from '@/core/transcript/turns';
import { replayCall, type CallEvent, type CallLogic } from '../../../scripts/lib/call-replay';

const LOGIC = {
  createTranscript,
  ...autoAnswer,
  pickQuestion,
  createRepeatGuard,
  themSpan,
  looksNonEnglish,
  groupLines,
  mergeTurns,
} as unknown as CallLogic;

const T = 1_700_000_000_000;

/**
 * A final line that reaches the page 1 s after it ends.
 *
 * @param channel Who.
 * @param text    Words.
 * @param tStart  Start.
 * @param tEnd    End.
 * @param extra   A confidence.
 * @returns The event.
 */
const final = (
  channel: 'you' | 'them',
  text: string,
  tStart: number,
  tEnd: number,
  extra: Partial<CallEvent> = {},
): CallEvent => ({ type: 'final', channel, text, tStart, tEnd, arrivedAt: tEnd + 1_000, ...extra });

describe('replayCall', () => {
  it('turns a question cut by a pause into one card, skips talk about the call, marks another language', () => {
    const result = replayCall(
      [
        final('them', 'COULD YOU WALK ME THROUGH THE SYSTEM YOU BUILT AND', T, T + 3_000),
        // The grey words of the second half show before the 3 s wait is over.
        {
          type: 'partial',
          channel: 'them',
          text: 'WHAT YOU',
          tStart: T + 5_200,
          arrivedAt: T + 5_900,
        },
        final('them', 'WHAT YOU WOULD CHANGE TODAY', T + 5_200, T + 7_000),
        final('you', 'WE WOULD KEEP FEWER SERVICES AND A SIMPLER MODEL', T + 10_000, T + 14_000),
        final('them', 'CAN YOU HEAR ME OKAY', T + 16_000, T + 17_000),
        final('them', 'MERA NAAM HAI PICHLE SAAL KAAM', T + 20_000, T + 23_000, {
          confidence: { tokens: 20, meanLogProb: -0.95, lowShare: 0.45 },
        }),
      ],
      LOGIC,
    );
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]!.reruns).toBe(0);
    const themLines = result.lines.filter((line) => line.speaker === 'them' && !line.hidden);
    expect(themLines[0]!.text).toContain('WHAT YOU WOULD CHANGE TODAY');
    expect(result.answers[0]!.lineIds).toEqual([themLines[0]!.id]);
    expect(themLines.some((line) => line.nonEnglish)).toBe(true);
  });

  it('asks again on the same card when the other person goes on', () => {
    const result = replayCall(
      [
        final('them', 'FIRST HOW BIG IS THE TEAM', T, T + 2_000),
        final('them', 'SECOND WHAT DOES YOUR ON CALL ROTATION LOOK LIKE', T + 4_200, T + 6_500),
      ],
      LOGIC,
    );
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]!.reruns).toBe(1);
  });

  it('measures the older rules too: a card for the fragment', () => {
    // The rules before ADR-0062, as that version's autoAnswerDue: the last line, if it opens like a question.
    const older = {
      ...LOGIC,
      questionWindow: undefined,
      autoAnswerDue: (
        state: {
          lines: { id: string; speaker: string; text: string; final: boolean; tEnd: number }[];
          lastAutoLineEnd: number | null;
        },
        now: number,
      ) => {
        const last = state.lines.at(-1);
        if (!last || last.speaker !== 'them' || !last.final || now - last.tEnd < 1_200) return null;
        if (state.lastAutoLineEnd !== null && last.tEnd <= state.lastAutoLineEnd) return null;
        return /^(COULD|WHAT|HOW)\b/.test(last.text) ? { id: last.id, tEnd: last.tEnd } : null;
      },
    } as unknown as CallLogic;
    const result = replayCall(
      [final('them', 'COULD YOU WALK ME THROUGH THE SYSTEM YOU BUILT AND', T, T + 3_000)],
      older,
    );
    expect(result.answers).toHaveLength(1);
  });
});
