/**
 * File: apps/web/src/features/live/useAutoAnswer.ts
 * Purpose: Runs auto-answer (beta, off by default; Day 6 Stage 4f) during a live call: every
 *          AUTO_TICK_MS it asks core/answer/autoAnswer.ts whether "Them" has just finished a
 *          question, and if so starts an answer marked "Auto". The rules (pause, one per 15 s,
 *          never while streaming, once per line) live in that core module.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer/autoAnswer.ts, src/core/storage/autoAnswer.ts,
 *             src/core/transcript/transcript.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); day-06 Stage 4
 */
import { useEffect, useRef, useState } from 'react';
import { autoAnswerDue } from '@/core/answer/autoAnswer';
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
  /** Starts an answer marked "Auto" (useLiveAnswers().autoAnswer). */
  autoAnswer: () => void;
  /** Overrides the saved setting (the harness turns it on); default: the saved setting. */
  enabled?: boolean;
}

/**
 * Checks the auto-answer rule on a timer and starts answers when it is due.
 *
 * @param input See AutoAnswerInput.
 * @returns Whether auto-answer is on for this call (for the top bar's label).
 * Called from: LiveAnswers.tsx
 */
export function useAutoAnswer(input: AutoAnswerInput): boolean {
  // Read once per call: the setting is changed on the Settings page, not during a call.
  // v1.1.0: the overlay's ⋮ can change it during a call, so the choice is read on every render.
  const [fallback] = useState(getAutoAnswer);
  const enabled = input.enabled ?? fallback;
  const latest = useRef(input);
  const last = useRef<{ at: number | null; lineEnd: number | null }>({ at: null, lineEnd: null });

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const { transcript, streaming, autoAnswer } = latest.current;
      const now = Date.now();
      const due = autoAnswerDue(
        {
          enabled,
          streaming,
          lines: transcript.lines(),
          lastAutoAt: last.current.at,
          lastAutoLineEnd: last.current.lineEnd,
        },
        now,
      );
      if (due === null) return;
      last.current = { at: now, lineEnd: due.tEnd };
      autoAnswer();
    }, AUTO_TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return enabled;
}
