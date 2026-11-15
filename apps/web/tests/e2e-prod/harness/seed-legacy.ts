/**
 * File: apps/web/tests/e2e-prod/harness/seed-legacy.ts
 * Purpose: Browser side of the one-time upload check (ADR-0049, Phase 4; privacy fix of 14 Nov 2026):
 *          bundled and run on a production address after sign-in, it creates an invented session with
 *          a document in the signed-in account's OWN local database ('kite-l-<id>', what the account
 *          made on this device while it had no account sync), and another invented session in the old
 *          shared database 'kite' (which records no owner and must never be offered), through the real
 *          storage modules. It also forgets the "upload done" flag the first dashboard visit set (the
 *          account had no local database then). Exposes window.kiteSeedLegacy(own, shared) → the own
 *          session's id. The account id is read in the page and never returned or printed.
 * Used by: tests/e2e-prod/legacy-upload.spec.ts (bundled with esbuild, added as a script tag)
 * Depends on: src/core/storage (db, sessions, documents)
 * Architecture: ADR-0049 (migration); ADR-0050 (test account only, invented data)
 */
import { forgetDb, getDb, selectAccountDatabase } from '@/core/storage/db';
import { addDocument } from '@/core/storage/documents';
import { createSession } from '@/core/storage/sessions';

/** The window with the seeding function. */
interface SeedWindow {
  /**
   * Creates an invented session in the signed-in account's own local database, and another in the
   * old shared database.
   *
   * @param ownCompany    The company of the account's own session (unique per run).
   * @param sharedCompany The company of the shared database's session (must never be offered).
   * @returns The account's own session's id.
   */
  kiteSeedLegacy(ownCompany: string, sharedCompany: string): Promise<string>;
}

/**
 * Creates an invented session with a document in the database selected now.
 *
 * @param company The session's company.
 * @returns The session's id.
 */
async function seedOne(company: string): Promise<string> {
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
  forgetDb();
  return session.id;
}

(window as unknown as SeedWindow).kiteSeedLegacy = async (ownCompany, sharedCompany) => {
  // The signed-in account's id, read here and kept in the page (Better Auth's session endpoint).
  const session = (await (await fetch('/api/auth/get-session')).json()) as {
    /** The signed-in user. */
    user: {
      /** The account's id. */
      id: string;
    };
  };
  const accountId = session.user.id;
  // The old shared database, as before 9 Nov 2026: it must never be offered to anyone.
  selectAccountDatabase(null, false);
  await seedOne(sharedCompany);
  // The account's own local database, as the app keeps it for an account without account sync.
  selectAccountDatabase(accountId, false);
  const id = await seedOne(ownCompany);
  // The first dashboard visit found no local database and marked the upload done; ask again.
  localStorage.removeItem(`kite.localUpload.done.${accountId}`);
  return id;
};
