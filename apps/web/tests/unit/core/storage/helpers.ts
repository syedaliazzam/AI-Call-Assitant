/**
 * File: apps/web/tests/unit/core/storage/helpers.ts
 * Purpose: Test helper (not a test): invented session input and a fresh, empty database before
 *          each storage test. All values are made up; no real customer data.
 * Used by: tests/unit/core/storage/*.test.ts
 * Depends on: fake-indexeddb (imported by each test file first), src/core/storage/db.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.4, §11; day-03-sessions.md Stage 1
 */
import { forgetDb, getDb } from '@/core/storage/db';
import type { NewSessionInput } from '@/core/storage/sessions';

/**
 * Deletes the test database and forgets the instance, so the next test starts empty.
 *
 * Called from: beforeEach() in the storage tests
 */
export async function resetDb(): Promise<void> {
  await getDb().delete();
  forgetDb();
}

/**
 * Invented input for createSession(), with optional changes.
 *
 * @param changes Fields to override.
 * @returns The input.
 * Called from: the storage tests
 */
export function sessionInput(changes: Partial<NewSessionInput> = {}): NewSessionInput {
  return {
    type: 'sales',
    company: 'Bluefin Route',
    role: 'Quarterly account review',
    description: 'Renewal of the professional plan',
    preferences: {
      language: 'en',
      model: 'fast',
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      keyTerms: 'Bluefin Route\nNorthwind Logistics',
    },
    instructions: 'Keep answers short.',
    saveTranscript: true,
    autoAnswer: false,
    ...changes,
  };
}
