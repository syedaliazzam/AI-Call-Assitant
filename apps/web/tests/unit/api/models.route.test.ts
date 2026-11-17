/**
 * Tests apps/web/app/api/models/route.ts (spec §6): it needs a signed-in user and reports the switch, and
 * (ADR-0095) whether Groq may be chosen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for the session read of getCachedSession(). */
const getSessionMock = vi.hoisted(() => vi.fn());
/** Spy standing in for the switch. */
const deepModelMock = vi.hoisted(() => vi.fn(async () => true));
/** ADR-0095: spy standing in for Groq's availability. */
const groqMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@/server/auth', () => ({
  getCachedSession: async () => ({ session: await getSessionMock(), setCookies: [] }),
}));
vi.mock('@/server/modelAccess', () => ({
  getDeepModelEnabled: deepModelMock,
  getGroqEnabled: groqMock,
}));

import { GET } from '../../../app/api/models/route';

/**
 * A request to the route.
 *
 * @returns The request.
 */
const request = () => new Request('https://kite.test/api/models');

beforeEach(() => {
  getSessionMock.mockReset();
  deepModelMock.mockClear();
  groqMock.mockClear();
});

describe('GET /api/models', () => {
  it('needs a signed-in user, and then reads nothing', async () => {
    getSessionMock.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
    expect(deepModelMock).not.toHaveBeenCalled();
  });

  it('reports the switch', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1' } });
    deepModelMock.mockResolvedValueOnce(false);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deepModel: false, groq: false });
  });

  it('says when Groq may be chosen (ADR-0095)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1' } });
    groqMock.mockResolvedValueOnce(true);
    expect(await (await GET(request())).json()).toEqual({ deepModel: true, groq: true });
  });
});
