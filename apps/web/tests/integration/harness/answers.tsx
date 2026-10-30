/**
 * File: apps/web/tests/integration/harness/answers.tsx
 * Purpose: Browser side of the answer harness test. Renders the live view's real answer part
 *          (LiveAnswers: top bar, chat box, answer panel, in-page hotkeys) for an invented
 *          session and a fixture transcript, with no sign-in. Answers go to the test server's
 *          mocked /api/answer, which streams a fixed answer slowly. Exposes what was copied on
 *          `window.kiteAnswerHarness` for the Playwright test.
 * Used by: tests/integration/answers.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/live/LiveAnswers.tsx, src/core/transcript/transcript.ts, react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); day-04-answers.md
 *               Stage 6
 *
 * Why a harness: the live page needs a signed-in user (database, secrets), which CI does not
 * have. The harness uses the same components and modules; only sign-in, the session loader and
 * the microphone are left out. All text here is invented.
 */
import { createRoot } from 'react-dom/client';
import type { Session } from '@/core/storage/types';
import { createTranscript } from '@/core/transcript/transcript';
import { LiveAnswers } from '@/features/live/LiveAnswers';

/** What the Playwright test reads from the page. */
export interface KiteAnswerHarness {
  /** Text put on the clipboard by Copy, in order. */
  copied: string[];
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteAnswerHarness: KiteAnswerHarness;
  }
}

/** An invented session. */
const SESSION: Session = {
  id: 'harness-session',
  type: 'sales',
  company: 'Harbor Lane Freight (invented)',
  role: 'Pilot review',
  description: 'Invented harness session.',
  preferences: {
    language: 'en',
    model: 'fast',
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    keyTerms: 'Harbor Lane\nProfessional plan',
  },
  instructions: '',
  saveTranscript: false,
  autoAnswer: false,
  createdAt: 1,
  status: 'live',
  lastActiveAt: null,
};

const callStartedAt = Date.now() - 120_000;
const transcript = createTranscript();
// Fixture lines, old enough to be stable (core/transcript/stability.ts), and a question.
const at = (seconds: number) => callStartedAt + seconds * 1000;
transcript.addFinal({
  speaker: 'you',
  text: 'THANKS FOR JOINING LET US GO THROUGH THE PILOT',
  tStart: at(5),
  tEnd: at(8),
});
transcript.addFinal({
  speaker: 'them',
  text: 'GREAT THE OPERATIONS TEAM LIKED THE RESULTS',
  tStart: at(20),
  tEnd: at(24),
});
transcript.addFinal({
  speaker: 'them',
  text: 'SO WHAT WOULD THE PROFESSIONAL PLAN COST',
  tStart: at(30),
  tEnd: at(33),
});
// Starts 2 s after the line before: beyond the 1.5 s merge gap, so it stays its own line.
transcript.addFinal({ speaker: 'them', text: 'FOR FORTY SEATS', tStart: at(35), tEnd: at(36) });

window.kiteAnswerHarness = { copied: [] };

createRoot(document.getElementById('root')!).render(
  <LiveAnswers
    session={SESSION}
    documents={[]}
    transcript={transcript}
    callStartedAt={callStartedAt}
    ending={false}
    onEnd={() => undefined}
    copy={async (text) => {
      window.kiteAnswerHarness.copied.push(text);
    }}
  />,
);
