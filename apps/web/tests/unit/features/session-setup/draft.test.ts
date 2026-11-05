/**
 * Tests: apps/web/src/features/session-setup/draft.ts and labels.ts (parity Phase 2). A session has
 * one resume; a library item is copied in; a removed stored document is deleted on save; the type
 * chosen on the dashboard is used; and the words for summaries.
 */
import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@/core/storage/types';
import {
  draftToInput,
  emptyDraft,
  newDocuments,
  validateDetails,
  withLibraryItem,
  withoutDocument,
} from '@/features/session-setup/draft';
import { sessionSummary, styleSummary } from '@/features/session-setup/labels';

const DEFAULTS = {
  model: 'fast',
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  instructions: '',
  saveTranscript: true,
} as const;

/**
 * A library item.
 *
 * @param kind Which library.
 * @param id   Its id.
 * @returns The item.
 */
function item(kind: LibraryItem['kind'], id: string): LibraryItem {
  return { id, kind, name: `${id}.pdf`, text: `${id} text`, chars: 7, addedAt: 1 };
}

describe('emptyDraft', () => {
  it('starts with the type chosen on the dashboard', () => {
    expect(emptyDraft({ ...DEFAULTS, style: { ...DEFAULTS.style } }, 'mock').type).toBe('mock');
    expect(emptyDraft({ ...DEFAULTS, style: { ...DEFAULTS.style } }).type).toBe('interview');
  });
});

describe('withLibraryItem', () => {
  const start = { documents: [], removedIds: [] };

  it('copies the item, remembering where it came from', () => {
    const next = withLibraryItem(start, item('document', 'a'), 'k1');
    expect(next.documents[0]).toMatchObject({
      key: 'k1',
      text: 'a text',
      kind: 'document',
      sourceId: 'a',
    });
  });

  it('keeps several documents but only one resume', () => {
    let draft = withLibraryItem(start, item('document', 'a'), 'k1');
    draft = withLibraryItem(draft, item('document', 'b'), 'k2');
    draft = withLibraryItem(draft, item('resume', 'r1'), 'k3');
    draft = withLibraryItem(draft, item('resume', 'r2'), 'k4');
    expect(draft.documents.map((document) => document.key)).toEqual(['k1', 'k2', 'k4']);
  });

  it('deletes a stored resume when a new one replaces it', () => {
    const next = withLibraryItem(
      {
        documents: [
          { key: 'old', storedId: 'stored-1', name: 'x', text: 'x', chars: 1, kind: 'resume' },
        ],
        removedIds: [],
      },
      item('resume', 'r'),
      'k',
    );
    expect(next.removedIds).toEqual(['stored-1']);
  });
});

describe('withoutDocument', () => {
  it('records only stored documents for deletion', () => {
    const documents = [
      { key: 'a', storedId: 's1', name: 'a', text: 'a', chars: 1 },
      { key: 'b', name: 'b', text: 'b', chars: 1 },
    ];
    expect(withoutDocument({ documents, removedIds: [] }, 'a').removedIds).toEqual(['s1']);
    expect(withoutDocument({ documents, removedIds: [] }, 'b').removedIds).toEqual([]);
  });
});

describe('a picked company (ADR-0048)', () => {
  const draft = emptyDraft({ ...DEFAULTS, style: { ...DEFAULTS.style } }, 'regular');

  it('starts with no domain, and a typed name saves none', () => {
    expect(draft.companyDomain).toBe('');
    expect(draftToInput({ ...draft, company: 'Alder' })).not.toHaveProperty('companyDomain');
  });

  it('saves the domain of a picked company', () => {
    const input = draftToInput({ ...draft, company: 'Alder', companyDomain: 'alder.example' });
    expect(input.companyDomain).toBe('alder.example');
  });
});

describe('saving a draft', () => {
  it('passes on auto-answer and where documents came from', () => {
    const draft = {
      ...emptyDraft({ ...DEFAULTS, style: { ...DEFAULTS.style } }),
      autoAnswer: true,
      ...withLibraryItem({ documents: [], removedIds: [] }, item('resume', 'r'), 'k'),
    };
    expect(draftToInput(draft).autoAnswer).toBe(true);
    expect(newDocuments(draft)).toEqual([
      { name: 'r.pdf', text: 'r text', kind: 'resume', sourceId: 'r' },
    ]);
  });
});

describe('validateDetails', () => {
  it('asks for a role on interviews and mocks, a topic on regular calls', () => {
    const base = emptyDraft({ ...DEFAULTS, style: { ...DEFAULTS.style } });
    expect(validateDetails({ ...base, type: 'mock' }).role).toContain('role');
    expect(validateDetails({ ...base, type: 'regular' }).role).toContain('about');
  });
});

describe('sessionSummary', () => {
  it('says what the session is', () => {
    expect(sessionSummary({ type: 'interview', role: 'Analyst', company: 'Lantern' })).toBe(
      'This is an Interview session for Analyst at Lantern.',
    );
    expect(sessionSummary({ type: 'mock', role: 'Analyst', company: 'Lantern' })).toBe(
      'This is a Mock session for Analyst at Lantern.',
    );
    expect(sessionSummary({ type: 'regular', role: 'Renewal', company: 'Lantern' })).toBe(
      'This is a Regular session about Renewal with Lantern.',
    );
  });
});

describe('styleSummary', () => {
  it('uses the words on screen, not the stored names', () => {
    expect(styleSummary({ format: 'headline+bullets', length: 'medium', tone: 'technical' })).toBe(
      'Opening line + bullets · Balanced · Technical',
    );
  });
});
