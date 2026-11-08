/**
 * File: apps/web/tests/e2e-prod/harness/seed-legacy.ts
 * Purpose: Browser side of the one-time upload check (ADR-0049, Phase 4): bundled and run on a
 *          production address before sign-in, it creates an invented session with a document in that
 *          address's own 'kite' database, exactly as the app did before account sync, through the real
 *          storage modules. Exposes window.kiteSeedLegacy(company) → the session's id.
 * Used by: tests/e2e-prod/legacy-upload.spec.ts (bundled with esbuild, added as a script tag)
 * Depends on: src/core/storage (db, sessions, documents)
 * Architecture: ADR-0049 (migration); ADR-0050 (test account only, invented data)
 */
import { getDb, selectAccountDatabase } from '@/core/storage/db';
import { addDocument } from '@/core/storage/documents';
import { createSession } from '@/core/storage/sessions';

/** The window with the seeding function. */
interface SeedWindow {
  /**
   * Creates an invented session with a document in this address's own database.
   *
   * @param company The session's company (unique per run).
   * @returns The session's id.
   */
  kiteSeedLegacy(company: string): Promise<string>;
}

(window as unknown as SeedWindow).kiteSeedLegacy = async (company: string) => {
  // This device's own database, as before account sync.
  selectAccountDatabase(null);
  const session = await createSession({
    type: 'regular',
    company,
    role: 'Pilot review',
    description: 'Invented session for the one-time upload check.',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      keyTerms: 'Northwind',
    },
    instructions: '',
    saveTranscript: true,
    autoAnswer: false,
  });
  await addDocument({ sessionId: session.id, name: 'invented.txt', text: 'Invented text.' });
  getDb().close();
  return session.id;
};
