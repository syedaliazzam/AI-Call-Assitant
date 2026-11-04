/**
 * File: apps/web/tests/integration/harness/handoff.tsx
 * Purpose: Browser side of the hand-off harness test (spec S8–S10, S12): the real sessions page,
 *          DesktopHandoffPage and HomePanel against this browser's real IndexedDB, with no sign-in. A
 *          test's init script can add a fake window.kiteDesktop to act as the desktop app.
 * Used by: apps/web/tests/integration/handoff.spec.ts
 * Depends on: src/features/dashboard/Dashboard.tsx, src/features/handoff/DesktopHandoffPage.tsx,
 *             src/features/home/HomePanel.tsx, src/core/storage
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S8–S10, S12)
 */
import { createRoot } from 'react-dom/client';
import { createSessionWithDocuments, getSession, listSessions } from '@/core/storage/sessions';
import { listDocuments } from '@/core/storage/documents';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { DesktopHandoffPage } from '@/features/handoff/DesktopHandoffPage';
import { HomePanel } from '@/features/home/HomePanel';

/** What the test can do on this page. */
export interface HandoffHarness {
  /** Stores an invented session with one document; returns its id. */
  seed: () => Promise<string>;
  /** Shows the sessions page. */
  showDashboard: () => void;
  /** Shows the hand-off page for a session. */
  showHandoff: (id: string) => void;
  /** Shows the home panel, on a session's start card if an id is given. */
  showHome: (id?: string) => void;
  /** The address the app last asked to go to. */
  pushed: () => string;
  /** What this browser holds for a session. */
  stored: (id: string) => Promise<{ company: string; documents: string[] } | null>;
  /** How many sessions this browser holds. */
  count: () => Promise<number>;
}

declare global {
  interface Window {
    /** See HandoffHarness. */
    kiteHandoffHarness: HandoffHarness;
    /** The paramountai:// links followed so far (set by the test's init script). */
    followed: string[];
    /** The fake desktop app's record (set by the test's init script). */
    desktop: {
      /** The pages the app asked to open in the main window. */
      opened: string[];
      /** How many times the app asked to delete the picked file. */
      deleted: number;
      /** What the fake file dialog answers. */
      pick: unknown;
    };
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
  showHome: (id) =>
    root.render(
      <HomePanel
        key={id ?? 'list'}
        email="sam.lee@example.com"
        {...(id ? { startSessionId: id } : {})}
      />,
    ),
  pushed: () => lastPushed,
  stored: async (id) => {
    const session = await getSession(id);
    if (!session) return null;
    const documents = await listDocuments(id);
    return { company: session.company, documents: documents.map((document) => document.text) };
  },
  count: async () => (await listSessions()).length,
};
