/**
 * Tests for apps/web/src/features/sync/SyncScope.tsx (privacy fix of 14 Nov 2026), rendered as React
 * renders it before effects run: it selects the signed-in account's own database before any child
 * renders ('kite-u-<id>' with account sync, 'kite-l-<id>' without), never the shared 'kite' database;
 * it records the page's account (removing a previous account's stored values); and after a sign-out and
 * a sign-in as someone else on the same page it renders nothing and keeps the previous account's
 * database until the page reloads. Invented ids only.
 */
import 'fake-indexeddb/auto';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_ACCOUNT_KEY, currentAccountId, forgetPageAccount } from '@/core/storage/accountScope';
import {
  DB_NAME,
  accountDbName,
  activeDatabaseName,
  forgetDb,
  localAccountDbName,
  selectAccountDatabase,
  usingAccountDatabase,
} from '@/core/storage/db';

// The sync engine and the platform are not under test (effects never run in renderToString).
vi.mock('@/core/sync/client', () => ({ startAccountSync: () => () => undefined }));
vi.mock('@/platform', () => ({ getPlatform: () => ({ keepPopupsInWindow: () => undefined }) }));
const { SyncScope, useSyncAccount } = await import('@/features/sync/SyncScope');

/**
 * A child that shows, while it renders, which database and synced account it sees.
 *
 * @returns The database name and the synced account's id (or 'none').
 */
function Probe() {
  const account = useSyncAccount();
  // One text node, so the HTML has no separators between the parts.
  return <p>{`${activeDatabaseName()}|${account?.userId ?? 'none'}`}</p>;
}

/**
 * Renders a page of an account the way the routes do.
 *
 * @param accountId The signed-in account.
 * @param sync      Whether it has account sync.
 * @returns The HTML.
 */
function page(accountId: string, sync: boolean): string {
  return renderToString(
    <SyncScope accountId={accountId} syncUserId={sync ? accountId : null} email="a@example.test">
      <Probe />
    </SyncScope>,
  );
}

let local: Map<string, string>;

beforeEach(() => {
  local = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return local.size;
    },
    key: (index: number) => [...local.keys()][index] ?? null,
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  });
  vi.stubGlobal('sessionStorage', { removeItem: () => undefined });
  // A browser page: SyncScope records the account only there.
  vi.stubGlobal('window', { location: { reload: () => undefined } });
  forgetPageAccount();
  selectAccountDatabase(null, false);
});

afterEach(() => {
  forgetPageAccount();
  selectAccountDatabase(null, false);
  forgetDb();
});

describe('SyncScope', () => {
  it("selects a synced account's own cache before the children render", () => {
    expect(page('account-a', true)).toContain(`${accountDbName('account-a')}|account-a`);
    expect(usingAccountDatabase()).toBe(true);
    expect(currentAccountId()).toBe('account-a');
  });

  it("selects an account's own local database without account sync, never 'kite'", () => {
    const html = page('account-a', false);
    expect(html).toContain(`${localAccountDbName('account-a')}|none`);
    expect(html).not.toContain(`>${DB_NAME}|`);
    expect(usingAccountDatabase()).toBe(false);
  });

  it('records the account on this browser profile (removing the previous one’s values)', () => {
    local.set(LAST_ACCOUNT_KEY, 'account-a');
    local.set('kite.autoAnswer', 'on');
    page('account-b', true);
    expect(local.get(LAST_ACCOUNT_KEY)).toBe('account-b');
    expect(local.has('kite.autoAnswer')).toBe(false);
  });

  it('renders nothing after a sign-in as someone else on the same page, keeping the old database', () => {
    expect(page('account-a', true)).toContain('account-a');
    const html = page('account-b', true);
    expect(html).toBe('');
    // Work still running for the previous account keeps writing to its own database, never B's.
    expect(activeDatabaseName()).toBe(accountDbName('account-a'));
  });
});
