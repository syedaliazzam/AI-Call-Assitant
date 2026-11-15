/**
 * Tests for apps/web/src/core/drive/api.ts, the account header (privacy fix of 14 Nov 2026): on a
 * signed-in page every Drive call (GET, JSON POST, file upload) names the page's account
 * (ACCOUNT_HEADER), so the server can refuse a window left open from before a sign-in as someone else;
 * outside a signed-in page the calls are sent as before, without it; the 409 'account_changed' reply
 * becomes a DriveApiError with status 0 (like an unreachable server, so the job is kept and tried again
 * later) and the route's code. Invented ids only.
 */
import { ACCOUNT_HEADER } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDriveApi, DriveApiError } from '@/core/drive/api';
import { enterAccount, forgetPageAccount } from '@/core/storage/accountScope';

/**
 * A fetch stand-in that answers every call with the same JSON and keeps the requests.
 *
 * @param status The HTTP status.
 * @param body   The JSON body.
 * @returns The fetch and its calls.
 */
function fakeFetch(status = 200, body: unknown = {}) {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const fetchFn = async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return Response.json(body, { status });
  };
  return { fetchFn, calls };
}

/**
 * The account header a call carried, if any.
 *
 * @param init The call's options.
 * @returns The header's value, or undefined.
 */
function namedAccount(init: RequestInit | undefined): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[ACCOUNT_HEADER];
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    length: 0,
    key: () => null,
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  vi.stubGlobal('sessionStorage', { removeItem: () => undefined });
  vi.stubGlobal('window', {});
  forgetPageAccount();
});

afterEach(() => {
  forgetPageAccount();
});

describe('createDriveApi', () => {
  it("names the page's account on every kind of call", async () => {
    enterAccount('account-a');
    const { fetchFn, calls } = fakeFetch(200, { folder: { id: 'f', name: 'F' } });
    const api = createDriveApi(fetchFn);
    await api.status();
    await api.setFolder('folder-1');
    await api.uploadFile({
      sessionId: 's1',
      key: 'k',
      name: 'n.txt',
      blob: new Blob(['invented']),
    });
    expect(calls.map((call) => namedAccount(call.init))).toEqual([
      'account-a',
      'account-a',
      'account-a',
    ]);
    // The JSON POST keeps its content type.
    expect((calls[1]!.init!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('sends calls as before outside a signed-in page', async () => {
    const { fetchFn, calls } = fakeFetch();
    await createDriveApi(fetchFn).status();
    expect(calls[0]!.init).toEqual({ cache: 'no-store' });
  });

  it('turns a refusal for another account into a DriveApiError', async () => {
    enterAccount('account-a');
    const { fetchFn } = fakeFetch(409, { code: 'account_changed', message: 'Reload the page.' });
    const failure = await createDriveApi(fetchFn)
      .status()
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DriveApiError);
    // Status 0, like an unreachable server: the uploader keeps the job for its own account.
    expect(failure).toMatchObject({ status: 0, code: 'account_changed' });
  });
});
