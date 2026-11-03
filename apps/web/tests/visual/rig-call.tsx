/**
 * File: apps/web/tests/visual/rig-call.tsx
 * Purpose: The overlay rig's real call page (v1.0.3, item 4): the real LivePage for an invented
 *          session, so in the real desktop shell a real call connects (microphone and the
 *          computer's sound) with the real speech engine, and the message box's microphone can be
 *          tried with a real voice. "Start calls in the overlay" is turned off here so the main
 *          window stays in view. Answers fail on purpose (the rig has no /api/answer): the check
 *          looks at the question a dictated message produced. Served at /call by overlay-rig.ts.
 * Used by: tests/visual/overlay-rig.ts (bundled); apps/desktop/tests/visual/call-mic-check.ts
 * Depends on: src/features/live/LivePage.tsx, react-dom
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 *
 * Invented data only; nothing is saved but this rig's own browser storage.
 */
import { createRoot } from 'react-dom/client';
import type { Session } from '@/core/storage/types';
import { LivePage } from '@/features/live/LivePage';

try {
  localStorage.setItem('kite.startInOverlay', 'off');
} catch {
  // Storage blocked: the overlay may open; the check still works in the main window.
}

/** An invented session. */
const SESSION: Session = {
  id: 'rig-call-session',
  type: 'interview',
  company: 'Northwind Robotics (invented)',
  role: 'AI engineer',
  description: 'Invented rig session.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: '',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

createRoot(document.getElementById('root')!).render(
  <LivePage
    session={SESSION}
    documents={[]}
    lessons={[]}
    hotwords=""
    hotwordCount={0}
    savedLines={[]}
  />,
);
