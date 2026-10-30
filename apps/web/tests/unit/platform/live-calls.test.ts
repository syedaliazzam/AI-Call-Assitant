/**
 * Tests for supportsLiveCalls() in apps/web/src/platform (UI theme stage U3): the browser's
 * isComputerBrowser() accepts Chrome and Edge on Windows and macOS with screen sharing, and
 * refuses Android and iPhone browsers, an iPad that reports a Mac user agent, a browser whose
 * client hints say "mobile", and a browser without getDisplayMedia; the desktop app always
 * supports live calls.
 */
import { describe, expect, it } from 'vitest';
import { isComputerBrowser, type BrowserNavigator } from '@/platform/browser';
import { createDesktopPlatform } from '@/platform/desktop';

/** Screen sharing, as a computer browser has it. */
const SHARING = { getDisplayMedia: () => undefined };

/**
 * A navigator.
 *
 * @param userAgent      The user agent.
 * @param changes        Other fields.
 * @returns The navigator.
 */
function nav(userAgent: string, changes: Partial<BrowserNavigator> = {}): BrowserNavigator {
  return { userAgent, maxTouchPoints: 0, mediaDevices: SHARING, ...changes };
}

/** Chrome on Windows. */
const WINDOWS_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36';
/** Edge on macOS. */
const MAC_EDGE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';

describe('isComputerBrowser', () => {
  it('accepts Chrome and Edge on Windows and macOS with screen sharing', () => {
    expect(isComputerBrowser(nav(WINDOWS_CHROME))).toBe(true);
    expect(isComputerBrowser(nav(MAC_EDGE))).toBe(true);
  });

  it('refuses phones and tablets, and browsers without screen sharing', () => {
    expect(
      isComputerBrowser(
        nav(
          'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/155.0.0.0 Mobile Safari/537.36',
        ),
      ),
    ).toBe(false);
    expect(
      isComputerBrowser(
        nav(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        ),
      ),
    ).toBe(false);
    // iPadOS asks for desktop sites with a Mac user agent; it has touch points.
    expect(isComputerBrowser(nav(MAC_EDGE, { maxTouchPoints: 5 }))).toBe(false);
    expect(isComputerBrowser(nav(WINDOWS_CHROME, { userAgentData: { mobile: true } }))).toBe(false);
    expect(isComputerBrowser(nav(WINDOWS_CHROME, { mediaDevices: {} }))).toBe(false);
    expect(isComputerBrowser({ userAgent: WINDOWS_CHROME, maxTouchPoints: 0 })).toBe(false);
  });
});

describe('desktop supportsLiveCalls', () => {
  it('is always true in the desktop app', () => {
    expect(createDesktopPlatform({ version: '1.2.3', os: 'windows' }).supportsLiveCalls()).toBe(
      true,
    );
    expect(createDesktopPlatform({ version: '1.2.3', os: 'mac' }).supportsLiveCalls()).toBe(true);
  });
});
