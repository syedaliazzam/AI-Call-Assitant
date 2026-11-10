/**
 * File: apps/web/src/features/notices/AcceptableUseNotice.tsx
 * Purpose: The acceptable-use notice (v1.1.0, the developer's wording): shown once per device on the
 *          first page that opens, including for people upgrading, and never during a call (the overlay
 *          does not render it). The same words are in docs/user-guide/using-kite.md.
 * Used by: app/(app)/layout.tsx, src/features/home/HomePanel.tsx
 * Depends on: src/core/storage/hintPrefs.ts, src/ui (Button, Dialog)
 * Architecture: docs/implementation/v1.1.0-plan.md ("Added at approval")
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { hintSeen, markHintSeen } from '@/core/storage/hintPrefs';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

/** The notice's words, exactly as the developer wrote them. */
export const ACCEPTABLE_USE_TEXT =
  "Use Paramount AI in calls where AI assistance is allowed — your own meetings, client calls, practice and mock interviews. Don't use it to get hidden help in interviews, exams or assessments where outside help isn't permitted. Screen-share protection only hides Paramount AI's windows; it does nothing against monitoring or proctoring tools. Record a meeting only when everyone on it has agreed; recording or transcribing others may require their consent.";

/**
 * Nothing to subscribe to: only this component marks the notice as seen, and it holds that in state.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether the notice has been seen. Server render: yes, so it never flashes before the browser has
 * read the device's answer.
 *
 * @returns True once seen.
 */
const seen = () => hintSeen('acceptable-use');

/**
 * The notice, until it is dismissed.
 *
 * @returns The dialog.
 * Rendered by: app/(app)/layout.tsx, HomePanel.tsx
 */
export function AcceptableUseNotice() {
  const alreadySeen = useSyncExternalStore(subscribeNever, seen, () => true);
  const [dismissed, setDismissed] = useState(false);
  /** Remembers it on this device and closes it. */
  const dismiss = () => {
    markHintSeen('acceptable-use');
    setDismissed(true);
  };
  return (
    <Dialog
      open={!alreadySeen && !dismissed}
      onClose={dismiss}
      title="Using Paramount AI"
      footer={<Button onClick={dismiss}>Got it</Button>}
    >
      <p>{ACCEPTABLE_USE_TEXT}</p>
    </Dialog>
  );
}
