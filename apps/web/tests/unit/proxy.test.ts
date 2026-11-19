/**
 * Tests for apps/web/proxy.ts: without a session cookie, pages and the Google Drive connect and callback
 * addresses (ADR-0072) redirect to /login, other API routes answer 401 JSON, and the public /privacy and
 * /terms pages continue; with a cookie every request continues. No real session is used: the cookie's value is invented.
 * ADR-0109: the matcher leaves out /install-mac.sh, so the Mac installer downloads signed out.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '../../proxy';

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

  it('ADR-0109: never runs for the Mac installer, which Terminal downloads signed out', () => {
    // Next.js runs proxy() only for paths its matcher selects (the pattern is matched against the
    // path without its leading slash). /install-mac.sh must not be one of them, or curl would get the
    // sign-in page instead of the script.
    const pattern = new RegExp(`^${config.matcher[0]?.replace(/^\//, '') ?? ''}$`);
    expect(pattern.test('install-mac.sh')).toBe(false);
    expect(pattern.test('settings')).toBe(true);
  });
});
