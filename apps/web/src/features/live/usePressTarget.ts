/**
 * File: apps/web/src/features/live/usePressTarget.ts
 * Purpose: ADR-0123: who Ctrl+Enter answers right now, for the small hint on the overlay's bar 2: the other
 *          person while they have spoken within ON_CALL_WINDOW_MS, otherwise the user. It changes by itself when
 *          the window runs out (one timer at that moment, no ticking clock), and at once when they speak again.
 * Used by: src/features/live/LiveAnswers.tsx
 * Depends on: src/core/answer/ownQuestion.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5, §6.1; ADR-0123
 */
'use client';

import { useEffect, useState } from 'react';
import {
  lastThemSpeech,
  ON_CALL_WINDOW_MS,
  pressTarget,
  type PressTarget,
} from '@/core/answer/ownQuestion';
import type { Utterance } from '@/core/transcript/transcript';

/** A few ms after the window ends, so the check at the timer is past it. */
const TIMER_SLACK_MS = 50;

/**
 * Who Ctrl+Enter answers now (the same rule the press uses at the moment it is pressed).
 *
 * @param lines         The call's lines.
 * @param themConnected False when the call has no other-side source.
 * @returns 'them' or 'you'.
 * Called from: LiveAnswers.tsx
 */
export function usePressTarget(lines: readonly Utterance[], themConnected: boolean): PressTarget {
  const last = lastThemSpeech(lines);
  // The time the rule is read at: set when this view starts and when the window runs out (a state set from a
  // timer, never while rendering).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (last === null) return;
    const due = Math.max(0, last + ON_CALL_WINDOW_MS - Date.now()) + TIMER_SLACK_MS;
    const timer = setTimeout(() => setClock(Date.now()), due);
    return () => clearTimeout(timer);
  }, [last]);
  // New words of theirs are newer than the clock: the time is at least theirs.
  return pressTarget(lines, Math.max(clock, last ?? 0), themConnected);
}
