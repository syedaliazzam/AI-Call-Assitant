/**
 * Tests for apps/web/src/core/sync/outbox.ts (ADR-0049): entries of one record combine into one change
 * (changed fields add up; a delete wins; a re-created or new record is whole), changes keep the order
 * in which they began, and a merge takes only this device's changed fields over the server copy.
 */
import { describe, expect, it } from 'vitest';
import type { OutboxEntry } from '@/core/sync/capture';
import { coalesce, mergeChanged } from '@/core/sync/outbox';

/**
 * An entry.
 *
 * @param seq     Its sequence.
 * @param ref     Its record.
 * @param op      Put or delete.
 * @param changed Changed fields (null: whole record).
 * @returns The entry.
 */
const entry = (
  seq: number,
  ref: string,
  op: 'put' | 'delete',
  changed: string[] | null,
): OutboxEntry => ({ seq, ref, op, changed, at: seq });

describe('coalesce', () => {
  it('adds up changed fields and keeps the first and last sequence', () => {
    expect(
      coalesce([entry(3, 's|1', 'put', ['role']), entry(1, 's|1', 'put', ['company'])]),
    ).toEqual([{ ref: 's|1', op: 'put', changed: ['company', 'role'], firstSeq: 1, lastSeq: 3 }]);
  });

  it('lets a delete win, and makes a record re-created after it whole', () => {
    expect(
      coalesce([entry(1, 's|1', 'put', ['a']), entry(2, 's|1', 'delete', null)])[0],
    ).toMatchObject({ op: 'delete', changed: null });
    expect(
      coalesce([entry(1, 's|1', 'delete', null), entry(2, 's|1', 'put', ['a'])])[0],
    ).toMatchObject({ op: 'put', changed: null });
  });

  it('keeps a new record whole and orders records by when they began', () => {
    const changes = coalesce([
      entry(2, 'u|line', 'put', null),
      entry(1, 's|1', 'put', null),
      entry(3, 's|1', 'put', ['status']),
    ]);
    expect(changes.map((change) => [change.ref, change.changed])).toEqual([
      ['s|1', null],
      ['u|line', null],
    ]);
  });
});

describe('mergeChanged', () => {
  it('takes only the fields this device changed, removing one it removed', () => {
    const server = { id: 1, company: 'Server', role: 'Server', note: 'kept?' };
    const local = { id: 1, company: 'Old', role: 'Mine' };
    expect(mergeChanged(server, local, ['role', 'note'])).toEqual({
      id: 1,
      company: 'Server',
      role: 'Mine',
    });
  });

  it('takes the whole local copy when everything changed', () => {
    expect(mergeChanged({ a: 1 }, { b: 2 }, null)).toEqual({ b: 2 });
  });
});
