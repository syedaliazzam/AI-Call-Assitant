/**
 * File: apps/web/tests/integration/harness/handoff.tsx
 * Purpose: Browser side of the hand-off harness test (spec S8, S9): the real sessions page and
 *          DesktopHandoffPage against this browser's real IndexedDB, with no sign-in.
 * Used by: apps/web/tests/integration/handoff.spec.ts
 * Depends on: src/features/dashboard/Dashboard.tsx, src/features/handoff/DesktopHandoffPage.tsx,
 *             src/core/storage
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S8, S9); ADR-0092
 */
import { createRoot } from 'react-dom/client';
import { createSessionWithDocuments } from '@/core/storage/sessions';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { DesktopHandoffPage } from '@/features/handoff/DesktopHandoffPage';

/** What the test can do on this page. */
export interface HandoffHarness {
  /** Stores an invented session with one document; returns its id. */
  seed: () => Promise<string>;
  /** Shows the sessions page. */
  showDashboard: () => void;
  /** Shows the hand-off page for a session. */
  showHandoff: (id: string) => void;
  /** The address the app last asked to go to. */
  pushed: () => string;
}

declare global {
  interface Window {
    /** See HandoffHarness. */
    kiteHandoffHarness: HandoffHarness;
    /** The paramountai:// links followed so far (set by the test's init script). */
    followed: string[];
  }
}

const root = createRoot(document.getElementById('root')!);
let lastPushed = '';

window.addEventListener('kite-harness-push', (event) => {
  lastPushed = (event as CustomEvent<string>).detail;
});

window.kiteHandoffHarness = {
  seed: async () => {
    const session = await createSessionWithDocuments(
      {
        type: 'interview',
        company: 'Lantern Freight (invented)',
        role: 'Data Analyst',
        description: '',
        preferences: {
          language: 'es',
          model: 'fast',
          style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
          keyTerms: '',
        },
        instructions: '',
        saveTranscript: true,
        autoAnswer: false,
      },
      [
        { name: 'cv.txt', text: 'Invented CV.', kind: 'resume' },
        { name: 'pricing.txt', text: 'Invented pricing.' },
      ],
    );
    return session.id;
  },
  showDashboard: () => root.render(<Dashboard />),
  showHandoff: (id) => root.render(<DesktopHandoffPage sessionId={id} />),
  pushed: () => lastPushed,
};
