/**
 * File: apps/web/tests/visual/rig-call.tsx
 * Purpose: The overlay rig's real call page (v1.0.3, item 4): the real LivePage for an invented
 *          session, so in the real desktop shell a real call connects (microphone and the
 *          computer's sound) with the real speech engine, and the message box's microphone can be
 *          tried with a real voice. "Start calls in the overlay" is turned off here so the main
 *          window stays in view, unless the address has ?overlay=on (ADR-0053: Connect then opens
 *          the overlay first, inside its click). Answers fail on purpose (the rig has no /api/answer): the check
 *          looks at the question a dictated message produced. Served at /call by overlay-rig.ts.
 *          Desktop 1.5.0 (ADR-0068): ?save=on makes the session save its transcript (recordings then keep
 *          their stereo file).
 * Used by: tests/visual/overlay-rig.ts (bundled); apps/desktop/tests/visual/call-mic-check.ts,
 *          apps/desktop/tests/manual/recording.spec.ts
 * Depends on: src/features/live/LivePage.tsx, react-dom
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 *
 * Invented data only; nothing is saved but this rig's own browser storage.
 */
import { createRoot } from 'react-dom/client';
import type { Session } from '@/core/storage/types';
import { LivePage } from '@/features/live/LivePage';

try {
  // Set either way, so a profile reused between runs never keeps the other choice.
  const overlayOn = new URLSearchParams(window.location.search).get('overlay') === 'on';
  localStorage.setItem('kite.startInOverlay', overlayOn ? 'on' : 'off');
} catch {
  // Storage blocked: the overlay may open; the check still works in the main window.
}

/** An invented session. */
const SESSION: Session = {
  // A UUID, as real sessions have (desktop 1.5.0: the shell refuses a recording for any other id).
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
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
  // ?save=on: the session saves its transcript (a recording then keeps its stereo file too).
  saveTranscript: new URLSearchParams(window.location.search).get('save') === 'on',
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
