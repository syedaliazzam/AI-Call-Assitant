/**
 * File: apps/web/src/features/settings/AutoAnswerSetting.tsx
 * Purpose: The Settings switch for auto-answer (beta, off by default; Day 6 Stage 4f), with a
 *          short explanation of what it does.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/autoAnswer.ts, src/ui/Toggle.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 (Trigger); day-06 Stage 4
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { getAutoAnswer, setAutoAnswer } from '@/core/storage/autoAnswer';
import { Toggle } from '@/ui/Toggle';

/**
 * The setting never changes from outside this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: AutoAnswerSetting (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * The auto-answer switch. The server render shows it off (no localStorage there); the browser
 * shows the saved value, then the user's choice.
 *
 * @returns The switch.
 * Rendered by: Settings.tsx
 */
export function AutoAnswerSetting() {
  const saved = useSyncExternalStore(subscribeNever, getAutoAnswer, () => false);
  const [choice, setChoice] = useState<boolean | null>(null);
  const on = choice ?? saved;
  return (
    <Toggle
      label="Auto-answer (beta)"
      hint="On: when the other person finishes a question and pauses for a moment, Paramount AI answers by itself. At most one automatic answer every 15 seconds, never while another answer is showing up; these answers are marked Auto. Takes effect from the next call."
      checked={on}
      onChange={(next) => {
        setAutoAnswer(next);
        setChoice(next);
      }}
    />
  );
}
