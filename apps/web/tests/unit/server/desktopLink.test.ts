/**
 * Tests for apps/web/src/server/desktopLink.ts and desktopLinkIssue.ts (ADR-0052), the one-time desktop
 * sign-in codes, against a real Postgres in memory (PGlite) with the committed migrations:
 * - issue: only for the account's own (not deleted) session; the code is 43 base64url characters and
 *   only its SHA-256 is stored; at most 10 a minute; expired codes are removed;
 * - peek: shows the binding without using the code;
 * - take: works once (a second try, or two at once, gets nothing), not after 60 s, and only for its own
 *   session and account;
 * - the issuing route: 401 / 403 / 404 (no switch, another account's session) / 400 / 429, never cached.
 */
import { LINK_CODE_PATTERN } from '@kite/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOps } from '@/server/calldata/store';
import { LINK_CODE_TTL_MS, issueLinkCode, peekLinkCode, takeLinkCode } from '@/server/desktopLink';
import { handleIssueLinkCode, type IssueDeps } from '@/server/desktopLinkIssue';
import { ALICE, BOB, createTestDb, type TestDb, resetTestDb } from './calldata/pgliteDb';

// The real sign-in and database modules need production settings; the route tests pass their own.
vi.mock('@/server/auth', () => ({ auth: {} }));
vi.mock('@/server/db', () => ({ db: {} }));

/** Invented session ids. */
const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let t: TestDb;

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

beforeEach(async () => {
  await resetTestDb(t);
  // Alice owns SESSION; Bob owns OTHER.
  await applyOps({ db: t.db, keys: t.keys, userId: ALICE }, [
    { op: 'put', kind: 'session', id: SESSION, baseRev: null, record: { id: SESSION } },
  ]);
  await applyOps({ db: t.db, keys: t.keys, userId: BOB }, [
    { op: 'put', kind: 'session', id: OTHER, baseRev: null, record: { id: OTHER } },
  ]);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

/**
 * Issues a code that must succeed.
 *
 * @param now The time.
 * @returns The code.
 */
async function issued(now = new Date()): Promise<string> {
  const result = await issueLinkCode(t.db, ALICE, SESSION, now);
  if (typeof result === 'string') throw new Error(`expected a code, got ${result}`);
  return result.code;
}

describe('issueLinkCode', () => {
  it('makes a 43-character code, and stores only its hash', async () => {
    const code = await issued();
    expect(code).toMatch(LINK_CODE_PATTERN);
    const rows = (
      await t.pg.query<{ identifier: string; value: string }>(
        'SELECT identifier, value FROM verification',
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).toMatch(/^desktop-link:[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it("refuses another account's session, and a deleted one", async () => {
    expect(await issueLinkCode(t.db, ALICE, OTHER)).toBe('not_found');
    await applyOps({ db: t.db, keys: t.keys, userId: ALICE }, [
      { op: 'delete', kind: 'session', id: SESSION },
    ]);
    expect(await issueLinkCode(t.db, ALICE, SESSION)).toBe('not_found');
  });

  it('allows 10 a minute, then refuses; expired codes are removed', async () => {
    const now = new Date();
    for (let n = 0; n < 10; n += 1) await issued(now);
    expect(await issueLinkCode(t.db, ALICE, SESSION, now)).toBe('too_many');
    // Bob is not held back by Alice's codes.
    expect(typeof (await issueLinkCode(t.db, BOB, OTHER, now))).toBe('object');
    // Two minutes later the old ones have expired and go.
    await issued(new Date(now.getTime() + 120_000));
    const left = await t.pg.query('SELECT 1 FROM verification');
    expect(left.rows).toHaveLength(1);
  });
});

describe('peek and take', () => {
  it('peek shows the binding without using the code; take works once', async () => {
    const code = await issued();
    expect(await peekLinkCode(t.db, code)).toEqual({ userId: ALICE, sessionId: SESSION });
    expect(await takeLinkCode(t.db, code)).toEqual({ userId: ALICE, sessionId: SESSION });
    expect(await takeLinkCode(t.db, code)).toBeNull();
    expect(await peekLinkCode(t.db, code)).toBeNull();
  });

  it('two takes at once: only one gets the binding (replay-safe)', async () => {
    const code = await issued();
    const results = await Promise.all([takeLinkCode(t.db, code), takeLinkCode(t.db, code)]);
    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('does nothing after 60 seconds', async () => {
    const now = new Date();
    const code = await issued(now);
    const later = new Date(now.getTime() + LINK_CODE_TTL_MS + 1);
    expect(await peekLinkCode(t.db, code, later)).toBeNull();
    expect(await takeLinkCode(t.db, code, later)).toBeNull();
  });

  it('refuses a malformed or unknown code', async () => {
    expect(await takeLinkCode(t.db, 'short')).toBeNull();
    expect(await takeLinkCode(t.db, 'A'.repeat(43))).toBeNull();
  });

  it('a code is bound to its account and session (the plugin compares the session it is shown)', async () => {
    const code = await issued();
    const binding = await takeLinkCode(t.db, code);
    expect(binding).toEqual({ userId: ALICE, sessionId: SESSION });
    expect(binding?.sessionId).not.toBe(OTHER);
    expect(binding?.userId).not.toBe(BOB);
  });
});

describe('POST /api/desktop/link-code', () => {
  /**
   * The route's dependencies for one signed-in state.
   *
   * @param user    Who is signed in, or a refusal.
   * @returns The dependencies.
   */
  const deps = (user: string | 'signed-out' | 'password'): IssueDeps => ({
    user: async () => (user === 'signed-out' || user === 'password' ? user : { id: user }),
    db: () => t.db,
  });

  /**
   * A request.
   *
   * @param body The body.
   * @returns The request.
   */
  const request = (body: unknown) =>
    new Request('https://kite.test/api/desktop/link-code', {
      method: 'POST',
      body: JSON.stringify(body),
    });

  it('gives a code for the account’s own session, never cached', async () => {
    const response = await handleIssueLinkCode(request({ sessionId: SESSION }), deps(ALICE));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(((await response.json()) as { code: string }).code).toMatch(LINK_CODE_PATTERN);
  });

  it('refuses signed out, before a password change, and for another account', async () => {
    const body = { sessionId: SESSION };
    expect((await handleIssueLinkCode(request(body), deps('signed-out'))).status).toBe(401);
    expect((await handleIssueLinkCode(request(body), deps('password'))).status).toBe(403);
    expect((await handleIssueLinkCode(request(body), deps(BOB))).status).toBe(404);
    expect((await handleIssueLinkCode(request({ sessionId: 'x' }), deps(ALICE))).status).toBe(400);
  });

  it('answers 429 after 10 codes in a minute', async () => {
    for (let n = 0; n < 10; n += 1) {
      expect((await handleIssueLinkCode(request({ sessionId: SESSION }), deps(ALICE))).status).toBe(
        200,
      );
    }
    expect((await handleIssueLinkCode(request({ sessionId: SESSION }), deps(ALICE))).status).toBe(
      429,
    );
  });
});
