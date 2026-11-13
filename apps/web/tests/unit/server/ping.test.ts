/**
 * Tests apps/web/src/server/ping.ts (Batch C, P1-2): the keep-alive ping answers 204 with no body when
 * signed in (401 otherwise), is never cached, and sends back a refreshed session cookie.
 */
import { describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.hoisted(() => vi.fn());
vi.mock('@/server/auth', () => ({ getCachedSession: getSessionMock }));
const { handlePing } = await import('@/server/ping');

describe('handlePing', () => {
  it('answers 204, uncached, with the refreshed cookie, when signed in', async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { user: { id: 'u1' } },
      setCookies: ['session=new; Path=/'],
    });
    const response = await handlePing(
      new Request('https://kite.test/api/answer/ping', { method: 'HEAD' }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('session=new');
    expect(await response.text()).toBe('');
  });

  it('answers 401 when not signed in', async () => {
    getSessionMock.mockResolvedValueOnce({ session: null, setCookies: [] });
    const response = await handlePing(new Request('https://kite.test/api/answer/ping'));
    expect(response.status).toBe(401);
  });
});
