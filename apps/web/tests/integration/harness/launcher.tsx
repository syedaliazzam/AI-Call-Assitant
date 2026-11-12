/**
 * File: apps/web/tests/integration/harness/launcher.tsx
 * Purpose: Browser side of the launcher harness test (ADR-0055): the real HomePanel inside a SyncScope
 *          for an invented account (no sync engine, no network), so it shows the launcher: the sessions
 *          card, the Start card and the Connect card. The test's init script adds a fake
 *          window.kiteDesktop (desktop 1.3.0) and records window.open.
 * Used by: apps/web/tests/integration/launcher.spec.ts
 * Depends on: src/features/home/HomePanel.tsx, src/features/sync/SyncScope.tsx, src/core/storage
 *             (db, sessions, driveUploads),
 *             src/core/stt (modelCache, download)
 * Architecture: ADR-0051, ADR-0055
 */
import { createRoot } from 'react-dom/client';
import { selectAccountDatabase } from '@/core/storage/db';
import { putDriveJob } from '@/core/storage/driveUploads';
import { createSessionWithDocuments, updateSession } from '@/core/storage/sessions';
import { cacheKey, STT_CACHE_NAME } from '@/core/stt/download';
import { speechModelFiles } from '@/core/stt/modelCache';
import { HomePanel } from '@/features/home/HomePanel';
import { SyncScope } from '@/features/sync/SyncScope';

/** The invented account. */
const USER_ID = 'harness-user';

/** The invented account's email. */
export const HARNESS_EMAIL = 'sam.lee@example.com';

/** What the test can do on this page. */
export interface LauncherHarness {
  /** Stores an invented session (each one newer than the last); returns its id. */
  seed: (company: string, role: string) => Promise<string>;
  /** Marks a session as a call that ended just now. */
  endNow: (id: string) => Promise<void>;
  /** Shows the launcher; with an id, as opened by the browser's link for that session. */
  show: (fromBrowserId?: string) => void;
  /** Puts placeholder entries for every speech model file in Cache Storage ("already downloaded"). */
  fakeModelCached: () => Promise<void>;
  /** 1.6.1: stores a session's Drive upload waiting for Google Drive to be reconnected. */
  waitForReconnect: (id: string) => Promise<void>;
}

declare global {
  interface Window {
    /** See LauncherHarness. */
    kiteLauncherHarness: LauncherHarness;
    /** What the fake desktop app was asked to do (set by the test's init script). */
    launcherDesktop: {
      /** Pages asked for in the main window. */
      opened: string[];
      /** Sessions whose call window was asked for. */
      callWindows: string[];
      /** Sizes the panel asked for. */
      sizes: { width: number; height: number }[];
      /** Window actions asked for. */
      controls: string[];
    };
    /** Addresses window.open was asked for (set by the test's init script). */
    windowOpened: string[];
  }
}

// The account's own cache, as SyncScope selects it for an account with sync.
selectAccountDatabase(USER_ID);

const root = createRoot(document.getElementById('root')!);

window.kiteLauncherHarness = {
  seed: async (company, role) => {
    const session = await createSessionWithDocuments(
      {
        type: 'interview',
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
        saveTranscript: true,
        autoAnswer: false,
      },
      [],
    );
    // A moment apart, so the newest-first order is certain.
    await new Promise((resolve) => setTimeout(resolve, 5));
    return session.id;
  },
  endNow: async (id) => {
    await updateSession(id, { status: 'ended', lastActiveAt: Date.now() });
  },
  show: (fromBrowserId) =>
    root.render(
      <SyncScope syncUserId={USER_ID} runEngine={false} email={HARNESS_EMAIL}>
        <HomePanel
          key={fromBrowserId ?? 'list'}
          email={HARNESS_EMAIL}
          {...(fromBrowserId ? { startSessionId: fromBrowserId } : {})}
        />
      </SyncScope>,
    ),
  fakeModelCached: async () => {
    const cache = await caches.open(STT_CACHE_NAME);
    for (const file of speechModelFiles(location.origin)) {
      await cache.put(cacheKey(location.origin, file), new Response('placeholder'));
    }
  },
  waitForReconnect: async (id) => {
    const now = Date.now();
    await putDriveJob({
      sessionId: id,
      calls: [{ startedAt: now - 60_000, endedAt: now }],
      files: [],
      state: 'waiting',
      reason: 'reconnect',
      notified: false,
      noticeShown: false,
      reportedFiles: 0,
      queuedAt: now,
      updatedAt: now,
    });
  },
};
