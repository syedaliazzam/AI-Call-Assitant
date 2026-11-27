/**
 * Tests apps/web/src/features/dashboard/duplicate.ts and copyName() / sessionCardTitle() in sessionCardParts.ts
 * (ADR-0129): the copy is named "Copy of" and the title the original's card shows (the company, or the topic of a
 * regular call, or "<Type> call"); the card, the desktop app's list and the session page show a copy's name; the
 * company and topic themselves stay as they were (they go to Claude and the speech hotwords). Uses an in-memory
 * IndexedDB; all data is invented.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSession, getSession } from '@/core/storage/sessions';
import { duplicateAsCopy } from '@/features/dashboard/duplicate';
import { copyName, sessionCardLine, sessionCardTitle } from '@/features/dashboard/sessionCardParts';
import { resetDb, sessionInput } from '../../core/storage/helpers';

beforeEach(resetDb);

describe('copyName', () => {
  it('is "Copy of" and the card’s title', () => {
    expect(copyName({ type: 'interview', company: 'Alder', role: 'Engineer' })).toBe(
      'Copy of Alder',
    );
    expect(copyName({ type: 'regular', company: 'Alder', role: 'Pilot review' })).toBe(
      'Copy of Pilot review',
    );
    expect(copyName({ type: 'mock', company: '', role: '' })).toBe('Copy of Mock call');
    // A copy of a copy.
    expect(copyName({ type: 'interview', company: 'Alder', role: '', name: 'Copy of Alder' })).toBe(
      'Copy of Copy of Alder',
    );
  });
});

describe('a copy’s card', () => {
  it('shows its name, with the role or company under it', () => {
    const copy = {
      type: 'interview' as const,
      company: 'Alder',
      role: 'Engineer',
      name: 'Copy of Alder',
    };
    expect(sessionCardTitle(copy)).toBe('Copy of Alder');
    expect(sessionCardLine(copy)).toBe('Engineer');
    const regular = {
      type: 'regular' as const,
      company: 'Alder',
      role: 'Pilot',
      name: 'Copy of Pilot',
    };
    expect(sessionCardLine(regular)).toBe('Alder');
    // A blank name is no name.
    expect(sessionCardTitle({ type: 'interview', company: 'Alder', role: '', name: '  ' })).toBe(
      'Alder',
    );
  });
});

describe('duplicateAsCopy', () => {
  it('stores "Copy of <name>" and keeps the company and topic for the answers', async () => {
    const source = await createSession(
      sessionInput({ type: 'regular', company: 'Alder', role: 'Pilot' }),
    );
    const copy = await duplicateAsCopy(source);
    expect(await getSession(copy.id)).toMatchObject({
      name: 'Copy of Pilot',
      company: 'Alder',
      role: 'Pilot',
      status: 'not-started',
    });
  });
});
