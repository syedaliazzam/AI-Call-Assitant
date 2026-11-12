/**
 * Tests for apps/web/proxy.ts: without a session cookie, pages and the Google Drive connect and callback
 * addresses (ADR-0072) redirect to /login, other API routes answer 401 JSON, and the public /privacy and
 * /terms pages continue; with a cookie every request continues. No real session is used: the cookie's value is invented.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '../../proxy';

/**
 * A request, signed in or out.
 * @param path     The path.
 * @param signedIn True to send a session cookie.
 * @returns The request.
 */
function request(path: string, signedIn = false): NextRequest {
  return new NextRequest(`https://kite.example${path}`, {
    headers: signedIn ? { cookie: 'better-auth.session_token=invented' } : {},
  });
}

describe('proxy', () => {
  it('sends signed-out pages and the Google OAuth addresses to sign-in', () => {
    for (const path of ['/settings', '/api/google/connect', '/api/google/callback']) {
      const out = proxy(request(path));
      expect(out.status).toBe(307);
      expect(out.headers.get('location')).toBe('https://kite.example/login');
    }
  });

  it('lets signed-out visitors open the public /privacy and /terms pages', () => {
    for (const path of ['/privacy', '/terms']) {
      const out = proxy(request(path));
      expect(out.status).toBe(200);
      expect(out.headers.get('x-middleware-next')).toBe('1');
      expect(out.headers.get('location')).toBeNull();
    }
    // Only those exact pages: a path under them still needs sign-in.
    expect(proxy(request('/privacy/other')).status).toBe(307);
  });

  it('answers 401 for other signed-out API routes, and lets signed-in requests through', async () => {
    const out = proxy(request('/api/google/status'));
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ code: 'unauthorized', message: 'Sign in required' });
    expect(proxy(request('/api/google/connect', true)).headers.get('x-middleware-next')).toBe('1');
  });
});
