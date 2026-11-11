/**
 * File: apps/web/src/features/live/useAutoAnswer.ts
 * Purpose: Runs auto-answer (beta, off by default; Day 6 Stage 4f; v1.4 ADR-0062) during a live call:
 *          every AUTO_TICK_MS it asks core/answer/autoAnswer.ts whether "Them" has just finished a
 *          question, or went on with the question just answered, and starts an answer marked "Auto"
 *          (or asks again on the same card). The rules (the question window, the waits, the rerun)
 *          live in that core module.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer/autoAnswer.ts, src/core/storage/autoAnswer.ts,
 *             src/core/transcript/transcript.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger), §7.5; ADR-0062
 */
import { useEffect, useRef, useState } from 'react';
import { autoAnswerDue, type AnsweredQuestion, type AutoDecision } from '@/core/answer/autoAnswer';
import { getAutoAnswer } from '@/core/storage/autoAnswer';
import type { Transcript } from '@/core/transcript/transcript';

/** How often the rule is checked, ms (well under the 1.2 s pause). */
export const AUTO_TICK_MS = 250;

/** What useAutoAnswer() needs. */
export interface AutoAnswerInput {
  /** The live transcript. */
  transcript: Transcript;
  /** Whether an answer is streaming now. */
  streaming: boolean;
  /** Starts an answer marked "Auto", or a rerun (useLiveAnswers().autoAnswer). */
  autoAnswer: (decision: AutoDecision) => void;
  /**
   * The lines answered so far, the latest answered question and (1.5.2) when the last answer stopped
   * streaming (useLiveAnswers().answeredState).
   */
  answeredState: () => {
    answeredLineIds: ReadonlySet<string>;
    last: AnsweredQuestion | null;
    idleSince?: number | null;
  };
  /** Overrides the saved setting (the harness turns it on); default: the saved setting. */
  enabled?: boolean;
}

/**
 * A key for a decision, so the same one is never acted on twice (for example when the answer could not
 * start because the computer is offline).
 *
 * @param decision The decision.
 * @returns The key.
 */
function decisionKey(decision: AutoDecision): string {
  return `${decision.kind}:${decision.lineIds.join(',')}:${decision.tEnd}`;
}

/**
 * Checks the auto-answer rule on a timer and starts answers when it is due.
 *
 * @param input See AutoAnswerInput.
 * @returns Whether auto-answer is on for this call (for the top bar's label).
 * Called from: LiveAnswers.tsx
 */
export function useAutoAnswer(input: AutoAnswerInput): boolean {
  // v1.1.0: the overlay's ⋮ can change it during a call, so the choice is read on every render.
  const [fallback] = useState(getAutoAnswer);
  const enabled = input.enabled ?? fallback;
  const latest = useRef(input);
  const acted = useRef(new Set<string>());

  useEffect(() => {
    latest.current = input;
  });

  // 1.5.2 (ADR-0070): the check runs with auto-answer off too: a press that answered grey words is asked
  // again on its card when the person goes on (autoAnswerDue does nothing else then).
  useEffect(() => {
    /** One check: starts an answer (or a rerun) when one is due and was not acted on. */
    const check = () => {
      const { transcript, streaming, autoAnswer, answeredState } = latest.current;
      const due = autoAnswerDue(
        { enabled, streaming, lines: transcript.lines(), ...answeredState() },
        Date.now(),
      );
      if (due === null) return;
      const key = decisionKey(due);
      if (acted.current.has(key)) return;
      acted.current.add(key);
      autoAnswer(due);
    };
    const timer = setInterval(check, AUTO_TICK_MS);
    // 1.5.2 (ADR-0070): also at once when the transcript changes (the end-of-turn judgment of a pause lands
    // on the grey line), not up to a tick later. The waits themselves still need the timer.
    const unsubscribe = latest.current.transcript.subscribe(check);
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [enabled]);

  return enabled;
}
