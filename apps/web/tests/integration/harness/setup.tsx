/**
 * File: apps/web/tests/integration/harness/setup.tsx
 * Purpose: Browser side of the session setup harness test (parity Phase 2). Renders the real
 *          Dashboard, SessionWizard and LibraryPage against this browser's real IndexedDB, with no
 *          sign-in. The next/navigation stand-in reports where the app wants to go, and this page
 *          follows it, so going from the dashboard into the wizard and back is real. Exposes
 *          helpers on `window.kiteSetupHarness`.
 * Used by: tests/integration/setup.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/features/dashboard/Dashboard.tsx, src/features/session-setup/SessionWizard.tsx,
 *             src/features/library/LibraryPage.tsx, src/core/storage (sessions, documents, library,
 *             settings), react-dom
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); ADR-0029
 *
 * Why a harness: these routes need a signed-in user (database, secrets), which CI does not have.
 * All text is invented.
 */
import { createRoot } from 'react-dom/client';
import { listDocuments } from '@/core/storage/documents';
import { addLibraryItem, listLibrary } from '@/core/storage/library';
import { createSession, listSessions } from '@/core/storage/sessions';
import { getSessionDefaults } from '@/core/storage/settings';
import type { LibraryKind, SessionType } from '@/core/storage/types';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { LibraryPage } from '@/features/library/LibraryPage';
import { SessionWizard } from '@/features/session-setup/SessionWizard';

/** What the test can do on this page. */
export interface SetupHarness {
  /** Stores an invented session; returns its id. */
  seedSession: (
    type: SessionType,
    company: string,
    role: string,
    createdAt: number,
    status?: 'not-started' | 'ended',
  ) => Promise<string>;
  /** Stores an invented library item. */
  seedLibrary: (kind: LibraryKind, name: string, text: string) => Promise<void>;
  /** Goes to an address, as the app's router would. */
  go: (href: string) => void;
  /** What is stored, without the document text. */
  stored: () => Promise<StoredSummary[]>;
  /** The document text of the newest session. */
  newestDocuments: () => Promise<{ name: string; text: string; kind?: string }[]>;
  /** What the libraries hold, by name. */
  library: (kind: LibraryKind) => Promise<string[]>;
  /** The saved default answer tone. */
  defaultTone: () => Promise<string>;
  /** The last address the app wanted that this page does not show. */
  pushed: () => string;
}

/** A stored session as the test reads it. */
export interface StoredSummary {
  /** Its id. */
  id: string;
  /** Its type. */
  type: string;
  /** Its company. */
  company: string;
  /** Its role or topic. */
  role: string;
  /** Its description. */
  description: string;
  /** Its answer language. */
  language: string;
  /** Its answer format. */
  format: string;
  /** Its answer tone. */
  tone: string;
  /** Its AI instructions. */
  instructions: string;
  /** Its auto-answer switch. */
  autoAnswer: boolean;
}

declare global {
  interface Window {
    /** See SetupHarness. */
    kiteSetupHarness: SetupHarness;
  }
}

const root = createRoot(document.getElementById('root')!);
let lastPushed = '';

/**
 * Shows the page for an address, or records it when this harness has no such page.
 *
 * @param href The address.
 */
function go(href: string) {
  const url = new URL(href, location.origin);
  // A new key each time, so going to the same page starts it afresh, as a route change does.
  const key = `${href}#${Date.now()}`;
  if (url.pathname === '/') root.render(<Dashboard key={key} />);
  else if (url.pathname === '/sessions/new') {
    const type = url.searchParams.get('type');
    root.render(<SessionWizard key={key} mode="create" {...(type ? { initialType: type } : {})} />);
  } else if (/^\/sessions\/[^/]+\/edit$/.test(url.pathname)) {
    root.render(<SessionWizard key={key} mode="edit" sessionId={url.pathname.split('/')[2]!} />);
  } else if (url.pathname === '/resumes') root.render(<LibraryPage key={key} kind="resume" />);
  else if (url.pathname === '/documents') root.render(<LibraryPage key={key} kind="document" />);
  else lastPushed = href;
}

window.addEventListener('kite-harness-push', (event) => go((event as CustomEvent<string>).detail));

window.kiteSetupHarness = {
  seedSession: async (type, company, role, createdAt, status = 'not-started') => {
    const session = await createSession(
      {
        type,
        company,
        role,
        description: '',
        preferences: {
          language: 'en',
          model: 'fast',
          style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
          keyTerms: '',
        },
        instructions: '',
        saveTranscript: type !== 'mock',
        autoAnswer: false,
      },
      createdAt,
    );
    if (status === 'ended') {
      const { updateSession } = await import('@/core/storage/sessions');
      await updateSession(session.id, {
        status: 'ended',
        lastActiveAt: createdAt,
        lastCallMs: 413_000,
      });
    }
    return session.id;
  },
  seedLibrary: async (kind, name, text) => {
    await addLibraryItem(kind, name, text);
  },
  go,
  stored: async () =>
    (await listSessions()).map((session) => ({
      id: session.id,
      type: session.type,
      company: session.company,
      role: session.role,
      description: session.description,
      language: session.preferences.language,
      format: session.preferences.style.format,
      tone: session.preferences.style.tone,
      instructions: session.instructions,
      autoAnswer: session.autoAnswer,
    })),
  newestDocuments: async () => {
    const [newest] = await listSessions();
    if (!newest) return [];
    return (await listDocuments(newest.id)).map(({ name, text, kind }) => ({
      name,
      text,
      ...(kind ? { kind } : {}),
    }));
  },
  library: async (kind) => (await listLibrary(kind)).map((item) => item.name),
  defaultTone: async () => (await getSessionDefaults()).style.tone,
  pushed: () => lastPushed,
};
