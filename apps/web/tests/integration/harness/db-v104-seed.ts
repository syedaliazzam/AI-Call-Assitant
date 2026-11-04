/**
 * File: apps/web/tests/integration/harness/db-v104-seed.ts
 * Purpose: Fills this browser's real IndexedDB through the storage code of a past release. The test
 *          checks that code out of git and bundles this file against it, so the database is exactly
 *          what that release would have written, at that release's schema version.
 * Used by: tests/integration/db-upgrade.spec.ts (bundled with esbuild against the old code)
 * Depends on: the old release's src/core/storage/* (the `@/` alias points there in the bundle)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4; ADR-0041
 *
 * All text is invented.
 */
import { saveAnswer } from '@/core/storage/answers';
import { saveChat } from '@/core/storage/chats';
import { getDb } from '@/core/storage/db';
import { addDocument } from '@/core/storage/documents';
import { saveLesson } from '@/core/storage/lessons';
import { addLibraryItem } from '@/core/storage/library';
import { saveNotes } from '@/core/storage/notes';
import { createSession } from '@/core/storage/sessions';
import { saveUtterance } from '@/core/storage/utterances';

/** What the test does through the page. */
declare global {
  interface Window {
    /** Fills the database, and returns the schema version it wrote. */
    seedOldDatabase: () => Promise<number>;
  }
}

/** A long gap: two calls of one session, further apart than anything in one call. */
const SECOND_CALL = 2 * 60 * 60 * 1000;

window.seedOldDatabase = async () => {
  const session = await createSession(
    {
      type: 'regular',
      company: 'Northwind Routes (invented)',
      role: 'Pilot review',
      description: 'Results of the route planning pilot.',
      preferences: {
        language: 'en',
        model: 'fast',
        style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
        keyTerms: 'Northwind\nBluefin Route',
      },
      instructions: 'Keep answers short.',
      saveTranscript: true,
      autoAnswer: false,
    },
    1_000,
  );
  await addDocument(
    { sessionId: session.id, name: 'pricing.txt', text: 'Professional plan: 52 dollars per seat.' },
    1_000,
  );
  const line = (id: string, tStart: number, text: string) =>
    saveUtterance({
      id,
      sessionId: session.id,
      speaker: 'them',
      text,
      tStart,
      tEnd: tStart + 2_000,
    } as Parameters<typeof saveUtterance>[0]);
  await line('u1', 10_000, 'WHAT DOES THE PLAN COST');
  await line('u2', 70_000, 'AND FOR FORTY SEATS');
  await line('u3', SECOND_CALL, 'THANKS FOR COMING BACK');
  await line('u4', SECOND_CALL + 200_000, 'WHAT ABOUT ONBOARDING');
  const answer = (id: string, createdAt: number, question: string, text: string) =>
    saveAnswer({
      id,
      sessionId: session.id,
      mode: 'answer',
      question,
      text,
      model: 'fast',
      createdAt,
      rating: 'up',
      note: 'Good one.',
    } as Parameters<typeof saveAnswer>[0]);
  await answer('a1', 20_000, 'WHAT DOES THE PLAN COST', 'Forty seats cost 2,080 dollars a month.');
  await answer('a2', SECOND_CALL + 100_000, 'WHAT DOES THE PLAN COST', 'Still 2,080 a month.');
  await saveNotes({ sessionId: session.id, summary: ['Invented notes.'] } as never);
  await saveLesson({
    id: 'l1',
    text: 'Say the price first.',
    status: 'approved',
    scope: 'all',
    decidedAt: 3_000,
  } as Parameters<typeof saveLesson>[0]);
  await addLibraryItem('resume', 'cv.txt', 'Invented CV.', 4_000);
  await saveChat({
    id: 'c1',
    title: 'Invented chat',
    createdAt: 5_000,
    updatedAt: 5_000,
    turns: [{ role: 'you', text: 'Hello' }],
  } as unknown as Parameters<typeof saveChat>[0]);
  const db = getDb();
  await db.open();
  const version = db.verno;
  db.close();
  return version;
};
