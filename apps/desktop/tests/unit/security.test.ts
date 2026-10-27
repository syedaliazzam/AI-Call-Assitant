/**
 * Tests for apps/desktop/src/security.ts, with the `electron` module mocked:
 * - isAllowedUrl() accepts only the exact Kite origin;
 * - only http: and https: links ever reach shell.openExternal (file:, javascript:, custom
 *   schemes and invalid URLs are refused), and test mode records instead of opening;
 * - lockNavigation() cancels navigation/redirects to other origins and denies every new window;
 * - only an audio-only 'media' request from the Kite origin is granted;
 * - the web preferences keep the sandbox, context isolation and no Node.js.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Spy standing in for Electron's shell.openExternal. */
const openExternal = vi.fn(async () => {});

vi.mock('electron', () => ({ shell: { openExternal } }));

const security = await import('../../src/security');
const {
  isAllowedUrl,
  isExternalOpenAllowed,
  isPermissionAllowed,
  lockNavigation,
  NO_EXTERNAL_OPEN_ENV,
  openInSystemBrowser,
  recordedExternalOpens,
  secureWebPreferences,
} = security;

/** The Kite origin used in these tests. */
const ORIGIN = 'https://kite-call-assistant.vercel.app';

beforeEach(() => {
  openExternal.mockClear();
  recordedExternalOpens.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('isAllowedUrl', () => {
  it('allows any page on the Kite origin', () => {
    expect(isAllowedUrl(`${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(isAllowedUrl(`${ORIGIN}/admin/users?x=1`, ORIGIN)).toBe(true);
  });

  it('blocks other origins, including look-alikes, other ports and plain http', () => {
    expect(isAllowedUrl('https://example.com/', ORIGIN)).toBe(false);
    expect(isAllowedUrl('https://kite-call-assistant.vercel.app.evil.com/', ORIGIN)).toBe(false);
    expect(isAllowedUrl('https://kite-call-assistant.vercel.app:8443/', ORIGIN)).toBe(false);
    expect(isAllowedUrl('http://kite-call-assistant.vercel.app/', ORIGIN)).toBe(false);
  });

  it('blocks invalid URLs and non-web schemes', () => {
    expect(isAllowedUrl('not a url', ORIGIN)).toBe(false);
    expect(isAllowedUrl('file:///C:/Windows/', ORIGIN)).toBe(false);
    expect(isAllowedUrl('javascript:alert(1)', ORIGIN)).toBe(false);
  });
});

describe('external opens', () => {
  it('allows only http: and https:', () => {
    expect(isExternalOpenAllowed('https://example.com/docs')).toBe(true);
    expect(isExternalOpenAllowed('http://example.com/')).toBe(true);
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'mailto:someone@example.com',
      'ms-settings:privacy',
      'smb://server/share',
      'data:text/html,<script>alert(1)</script>',
      'not a url',
      '',
    ]) {
      expect(isExternalOpenAllowed(url), url).toBe(false);
    }
  });

  it('passes http(s) links to shell.openExternal', () => {
    expect(openInSystemBrowser('https://example.com/help')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/help');
  });

  it('never passes other schemes to shell.openExternal', () => {
    expect(openInSystemBrowser('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(openInSystemBrowser('ms-settings:privacy')).toBe(false);
    expect(openInSystemBrowser('javascript:alert(1)')).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('records instead of opening in smoke-test mode', () => {
    vi.stubEnv(NO_EXTERNAL_OPEN_ENV, '1');
    expect(openInSystemBrowser('https://example.com/')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
    expect(recordedExternalOpens).toEqual(['https://example.com/']);
  });

  it('still refuses non-http(s) links in smoke-test mode', () => {
    vi.stubEnv(NO_EXTERNAL_OPEN_ENV, '1');
    expect(openInSystemBrowser('file:///etc/passwd')).toBe(false);
    expect(recordedExternalOpens).toEqual([]);
  });
});

/** A fake WebContents that records the handlers lockNavigation() installs. */
function fakeContents() {
  const listeners: Record<string, (event: { url?: string; preventDefault: () => void }) => void> =
    {};
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | undefined;
  return {
    on: vi.fn((name: string, listener: (typeof listeners)[string]) => {
      listeners[name] = listener;
    }),
    setWindowOpenHandler: vi.fn((handler: typeof windowOpenHandler) => {
      windowOpenHandler = handler;
    }),
    /** Fires an event and reports whether the handler cancelled it. */
    fire(name: string, url?: string): boolean {
      const event = { url, preventDefault: vi.fn() };
      listeners[name]?.(event);
      return event.preventDefault.mock.calls.length > 0;
    },
    openWindow(url: string) {
      return windowOpenHandler?.({ url });
    },
  };
}

describe('lockNavigation', () => {
  it('lets navigation and redirects stay on the Kite origin', () => {
    const contents = fakeContents();
    lockNavigation(contents as never, ORIGIN);
    expect(contents.fire('will-navigate', `${ORIGIN}/login`)).toBe(false);
    expect(contents.fire('will-redirect', `${ORIGIN}/`)).toBe(false);
  });

  it('cancels navigation and redirects to other origins without opening them', () => {
    const contents = fakeContents();
    lockNavigation(contents as never, ORIGIN);
    expect(contents.fire('will-navigate', 'https://evil.example.com/')).toBe(true);
    expect(contents.fire('will-redirect', 'https://evil.example.com/')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses <webview> tags', () => {
    const contents = fakeContents();
    lockNavigation(contents as never, ORIGIN);
    expect(contents.fire('will-attach-webview')).toBe(true);
  });

  it('denies every new window; http(s) targets go to the system browser only', () => {
    const contents = fakeContents();
    lockNavigation(contents as never, ORIGIN);

    expect(contents.openWindow('https://example.com/')).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledWith('https://example.com/');

    openExternal.mockClear();
    expect(contents.openWindow('file:///C:/')).toEqual({ action: 'deny' });
    expect(openExternal).not.toHaveBeenCalled();
  });
});

describe('isPermissionAllowed', () => {
  it('grants the microphone (audio only) to the Kite origin', () => {
    expect(
      isPermissionAllowed(
        { permission: 'media', requestingUrl: `${ORIGIN}/live/1`, mediaTypes: ['audio'] },
        ORIGIN,
      ),
    ).toBe(true);
  });

  it('denies the camera, or camera plus microphone', () => {
    const base = { permission: 'media', requestingUrl: `${ORIGIN}/` };
    expect(isPermissionAllowed({ ...base, mediaTypes: ['video'] }, ORIGIN)).toBe(false);
    expect(isPermissionAllowed({ ...base, mediaTypes: ['audio', 'video'] }, ORIGIN)).toBe(false);
    expect(isPermissionAllowed({ ...base, mediaTypes: [] }, ORIGIN)).toBe(false);
    expect(isPermissionAllowed(base, ORIGIN)).toBe(false);
  });

  it('denies the microphone to any other origin', () => {
    expect(
      isPermissionAllowed(
        { permission: 'media', requestingUrl: 'https://evil.example.com/', mediaTypes: ['audio'] },
        ORIGIN,
      ),
    ).toBe(false);
  });

  it('denies every other permission, even for the Kite origin', () => {
    for (const permission of [
      'notifications',
      'geolocation',
      'clipboard-read',
      'display-capture',
    ]) {
      expect(isPermissionAllowed({ permission, requestingUrl: `${ORIGIN}/` }, ORIGIN)).toBe(false);
    }
  });
});

describe('secureWebPreferences', () => {
  it('keeps the sandbox and context isolation on and Node.js off', () => {
    const prefs = secureWebPreferences('/app/dist/preload.js', '0.1.0');
    expect(prefs).toMatchObject({
      preload: '/app/dist/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      additionalArguments: ['--kite-version=0.1.0'],
    });
  });
});
