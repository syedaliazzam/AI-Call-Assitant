/**
 * Tests for apps/web/src/server/userList.ts: a rollout list holds account ids, `*` means everyone, unset
 * means no one, and spaces and empty entries are ignored.
 */
import { describe, expect, it } from 'vitest';
import { parseUserList } from '@/server/userList';

describe('parseUserList', () => {
  it('is empty when unset or blank', () => {
    expect(parseUserList(undefined)).toEqual(new Set());
    expect(parseUserList(' , ')).toEqual(new Set());
  });

  it('lists the ids, trimmed', () => {
    expect(parseUserList(' u1 ,u2,')).toEqual(new Set(['u1', 'u2']));
  });

  it('is everyone with *', () => {
    expect(parseUserList('*')).toBe('everyone');
    expect(parseUserList('u1,*')).toBe('everyone');
  });
});
