/**
 * Tests for apps/web/src/core/drive/callFiles.ts, queue.ts and reasons.ts (ADR-0072):
 * - a call's slice keeps only its own lines and answers; the notes PDF has the summary, questions, next
 *   steps and unclear parts but not the proposed lessons; with "Save transcript" off only notes are made;
 * - a call is queued only when the account saves to Drive (and, offline, when it did last time);
 * - a live call is seen through the call lock;
 * - the reason words, and which need Settings.
 * All values are invented.
 */
import 'fake-indexeddb/auto';
import type { CallNotes, DriveStatusResponse } from '@kite/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCallFiles, callSlice, notesParagraphs } from '@/core/drive/callFiles';
import { callIsLive, driveSavesNow, savesToDrive } from '@/core/drive/queue';
import { driveReasonNeedsSettings, driveReasonText } from '@/core/drive/reasons';
import { CALL_LOCK_NAME } from '@/core/live/callLock';
import { saveNotes } from '@/core/storage/notes';
import type { Session, StoredAnswer, StoredUtterance } from '@/core/storage/types';
import { resetDb } from '../storage/helpers';

beforeEach(resetDb);

/** Invented notes. */
const NOTES: CallNotes = {
  summary: ['Discussed the plan'],
  questions: [{ question: 'Start date?', at: 65, answered: 'yes', rating: null }],
  nextSteps: [{ step: 'Send the offer', owner: 'Sam' }],
  unclear: [{ from: 120, to: 130, reason: 'crosstalk' }],
  lessons: [{ text: 'A PRIVATE LESSON', evidence: 'x' }],
};

describe('call files', () => {
  it('slices one call out of the session', () => {
    const line = (tStart: number) => ({ id: String(tStart), tStart }) as StoredUtterance;
    const answer = (createdAt: number, callStartedAt?: number) =>
      ({ id: String(createdAt), createdAt, callStartedAt }) as StoredAnswer;
    const slice = callSlice(
      [line(500), line(10_000), line(999_999_999)],
      [answer(10_500, 10_000), answer(10_600, 1), answer(10_700)],
      { startedAt: 10_000, endedAt: 20_000 },
    );
    expect(slice.lines.map((l) => l.tStart)).toEqual([10_000]);
    expect(slice.answers.map((a) => a.createdAt)).toEqual([10_500, 10_700]);
  });

  it('writes the notes without the proposed lessons', () => {
    const text = notesParagraphs('Acme', NOTES).map((line) => line.text);
    expect(text).toContain('- Discussed the plan');
    expect(text).toContain('- 1:05  Start date? (answered)');
    expect(text).toContain('- Send the offer (Sam)');
    expect(text).toContain('- 2:00–2:10: crosstalk');
    expect(text.join('\n')).not.toContain('A PRIVATE LESSON');
  });

  it('makes only the notes when "Save transcript" is off, and nothing for another call', async () => {
    await saveNotes({ sessionId: 's1', notes: NOTES, callStartedAt: 1_000, createdAt: 2_000 });
    const session = {
      id: 's1',
      saveTranscript: false,
      company: 'Acme',
      preferences: { keyTerms: '' },
    } as unknown as Session;
    const files = await buildCallFiles(session, { startedAt: 1_000, endedAt: 1_500 }, 'Acme', null);
    expect(files.map((file) => file.kind)).toEqual(['notes-pdf']);
    expect(
      await buildCallFiles(session, { startedAt: 9_000, endedAt: 9_500 }, 'Acme', null),
    ).toEqual([]);
  });
});

describe('driveSavesNow', () => {
  const status = (changes: Partial<DriveStatusResponse>): DriveStatusResponse => ({
    configured: true,
    status: 'connected',
    folder: null,
    admin: false,
    account: null,
    saveEnabled: true,
    email: { configured: false, enabled: true, alsoNotify: [] },
    ...changes,
  });

  it('says yes only when the account saves to Drive; offline, the last answer decides', async () => {
    expect(savesToDrive(status({}))).toBe(true);
    expect(savesToDrive(status({ status: 'reconnect' }))).toBe(true);
    expect(savesToDrive(status({ saveEnabled: false }))).toBe(false);
    expect(savesToDrive(status({ status: 'not-connected' }))).toBe(false);
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    });
    vi.stubGlobal('fetch', async () => Response.json(status({ status: 'not-connected' })));
    expect(await driveSavesNow()).toBe(false);
    vi.stubGlobal('fetch', async () => Response.json(status({})));
    expect(await driveSavesNow()).toBe(true);
    // Offline: the answer remembered last time.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    expect(await driveSavesNow()).toBe(true);
  });
});

describe('callIsLive', () => {
  it('reads the call lock', async () => {
    vi.stubGlobal('navigator', {
      locks: { query: async () => ({ held: [{ name: CALL_LOCK_NAME }] }) },
    });
    expect(await callIsLive()).toBe(true);
    vi.stubGlobal('navigator', { locks: { query: async () => ({ held: [] }) } });
    expect(await callIsLive()).toBe(false);
  });
});

describe('reasons', () => {
  it('has words for every code and says which need Settings', () => {
    // ADR-0074: an admin reconnects the company account.
    expect(driveReasonText('reconnect')).toMatch(/admin to reconnect/);
    expect(driveReasonText('update-desktop')).toMatch(/Update Paramount AI/);
    expect(driveReasonNeedsSettings('update-desktop')).toBe(false);
    expect(driveReasonText('unknown-code')).toMatch(/Retry/);
    expect(driveReasonNeedsSettings('no-folder')).toBe(true);
    expect(driveReasonNeedsSettings('network')).toBe(false);
  });
});
