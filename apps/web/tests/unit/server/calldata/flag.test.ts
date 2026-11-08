/**
 * Tests for apps/web/src/server/calldata/flag.ts (ADR-0049 rollout): KITE_SYNC_USERS lists the user ids
 * with account sync, `*` means everyone, unset means no one, and spaces and empty entries are ignored.
 */
import { describe, expect, it } from 'vitest';
import { parseSyncUsers, syncEnabledFor } from '@/server/calldata/flag';

describe('accountSync switch', () => {
  it('is off for everyone when unset or empty', () => {
    expect(syncEnabledFor('u1', {})).toBe(false);
    expect(syncEnabledFor('u1', { KITE_SYNC_USERS: ' , ' })).toBe(false);
  });

  it('is on for listed ids only', () => {
    const env = { KITE_SYNC_USERS: ' u1 ,u2,' };
    expect(syncEnabledFor('u1', env)).toBe(true);
    expect(syncEnabledFor('u2', env)).toBe(true);
    expect(syncEnabledFor('u3', env)).toBe(false);
  });

  it('is on for everyone with *', () => {
    expect(parseSyncUsers('*')).toBe('everyone');
    expect(syncEnabledFor('anyone', { KITE_SYNC_USERS: 'u1,*' })).toBe(true);
  });
});
