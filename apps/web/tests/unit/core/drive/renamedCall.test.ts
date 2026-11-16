/**
 * Tests for apps/web/src/core/drive/renamedCall.ts and the renamed call's PDFs (ADR-0093): after a
 * rename, a call already saved to Drive gets its transcript PDF and notes PDF made again and replaced
 * (replace: true, the call's own keys and names); a call not saved yet, or with nothing to save, is left
 * to its upload; a failed upload says so. The PDFs' text carries the new name, the notes read with it in
 * place of "Them", and no notes request is made. All data is invented.
 */
import type { CallNotes } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import { notesParagraphs } from '@/core/drive/callFiles';
import type { DriveSmallFile } from '@/core/drive/api';
import { callFileDriveName } from '@/core/drive/names';
import { refreshRenamedCall, type RenamedCallDeps } from '@/core/drive/renamedCall';
import type { CallView } from '@/core/review/calls';
import { conversationItems, transcriptText } from '@/core/review/conversation';
import type { Session, StoredCall, StoredUtterance } from '@/core/storage/types';
import { relabelNotes, theirLabel, withTheirName } from '@/core/transcript/theirName';

/** An invented session (no contact name). */
const SESSION = {
  id: 'session-1',
  type: 'interview',
  company: 'Lantern Freight',
  role: 'Data Analyst',
} as Session;

/** When the invented call started. */
const STARTED = 1_794_389_400_000;

/**
 * An invented call.
 *
 * @param state     Its Drive state.
 * @param themName  Its own name for the other person.
 * @returns The call.
 */
function call(state: StoredCall['drive']['state'], themName?: string): CallView {
  return {
    id: 'call-1',
    startedAt: STARTED,
    record: { drive: { state }, ...(themName ? { themName } : {}) } as StoredCall,
    lines: [],
    answers: [],
    notes: null,
  } as unknown as CallView;
}

/**
 * Fake dependencies.
 *
 * @param view  The call.
 * @param fail  True to make every upload fail.
 * @returns The fakes and the upload spy.
 */
function fakes(view: CallView, fail = false) {
  const uploadFile = vi.fn(async (_file: DriveSmallFile) => {
    if (fail) throw new Error('offline');
    return { fileId: 'new' };
  });
  const files = vi.fn(async () => [
    { kind: 'transcript-pdf' as const, blob: new Blob(['t']) },
    { kind: 'notes-pdf' as const, blob: new Blob(['n']) },
  ]);
  const deps: RenamedCallDeps = {
    session: async () => SESSION,
    calls: async () => [view],
    files,
    api: { uploadFile },
  };
  return { deps, uploadFile, files };
}

describe('refreshRenamedCall', () => {
  it('replaces both PDFs of a call saved to Drive, under its own keys and names', async () => {
    const view = call('done', 'Sarah');
    const { deps, uploadFile, files } = fakes(view);
    expect(await refreshRenamedCall('session-1', 'call-1', null, deps)).toBe('replaced');
    expect(files).toHaveBeenCalledWith(SESSION, view, 'Lantern Freight – Data Analyst');
    expect(uploadFile.mock.calls.map(([file]) => [file.key, file.name, file.replace])).toEqual([
      [`call:${STARTED}:transcript-pdf`, callFileDriveName(STARTED, 'transcript-pdf'), true],
      [`call:${STARTED}:notes-pdf`, callFileDriveName(STARTED, 'notes-pdf'), true],
    ]);
  });

  it('leaves a call that is not saved yet to its upload', async () => {
    for (const state of ['waiting', 'queued', 'uploading', 'off'] as const) {
      const { deps, uploadFile } = fakes(call(state));
      expect(await refreshRenamedCall('session-1', 'call-1', null, deps)).toBe('not-saved');
      expect(uploadFile).not.toHaveBeenCalled();
    }
  });

  it('says so when a file could not be replaced', async () => {
    const { deps } = fakes(call('done'), true);
    expect(await refreshRenamedCall('session-1', 'call-1', null, deps)).toBe('failed');
  });
});

describe("a renamed call's PDF text", () => {
  it('names the other person on their turns, with "Interviewer" before any name', () => {
    const line = {
      id: 'l1',
      speaker: 'them',
      text: 'Tell me about yourself.',
      tStart: STARTED + 4_000,
      tEnd: STARTED + 6_000,
      final: true,
    } as unknown as StoredUtterance;
    const items = conversationItems([line], []);
    expect(transcriptText(withTheirName(SESSION, null), items, [])).toContain('Interviewer  00:00');
    const renamed = withTheirName(SESSION, { themName: 'Sarah Chen' });
    expect(transcriptText(renamed, items, [])).toContain('Sarah Chen  00:00');
  });

  it('shows the notes with the new name, and "With …" and "Questions from …" on the notes PDF', () => {
    const notes: CallNotes = {
      summary: ['Them asked about SQL.'],
      questions: [{ question: 'Why this role?', at: 30, answered: 'yes', rating: null }],
      nextSteps: [],
      unclear: [],
      lessons: [],
    };
    const label = theirLabel(SESSION, { themName: 'Sarah' });
    const text = notesParagraphs('Lantern Freight', relabelNotes(notes, undefined, label), label)
      .map((line) => line.text)
      .join('\n');
    expect(text).toContain('With Sarah');
    expect(text).toContain('Questions from Sarah');
    expect(text).toContain('Sarah asked about SQL.');
    // The fallback label is not a name: no "With" line.
    expect(notesParagraphs('X', notes, 'Interviewer').map((line) => line.text)).not.toContain(
      'With Interviewer',
    );
  });
});
