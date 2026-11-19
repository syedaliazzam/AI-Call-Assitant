/**
 * Tests for apps/web/src/features/shell/MacInstall.tsx (ADR-0109 §4): the install steps show the one-line
 * Terminal command (the same one Help shows) with Copy and "Read the script first", say what macOS asks the
 * first time, and keep the .dmg fallback with Open Anyway; the link says "Need it for macOS?" on other
 * computers (the server render; hiding it inside the Mac app is decided in the browser).
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The link asks which computer and app this is; server rendering uses the hook's server answer
// (not a Mac, not the app) whatever these say.
vi.mock('@/platform', () => ({
  isMacComputer: () => false,
  isDesktop: () => false,
}));

const { MacInstallLink, MacInstallSteps } = await import('@/features/shell/MacInstall');
const { MAC_INSTALL_COMMAND, MAC_INSTALL_SCRIPT_URL, MAC_RELEASE_PAGE_URL } =
  await import('@/features/session-setup/labels');
const { USER_GUIDE_MD } = await import('@/features/help/guideText');

describe('MacInstallSteps', () => {
  it('shows the Terminal command with Copy, the script and the dmg fallback', () => {
    const html = renderToString(<MacInstallSteps />);
    expect(html).toContain(MAC_INSTALL_COMMAND);
    expect(html).toContain('>Copy<');
    expect(html).toContain(`href="${MAC_INSTALL_SCRIPT_URL}"`);
    expect(html).toContain('Read the script first');
    expect(html).toContain('Screen &amp; System Audio Recording');
    expect(html).toContain('quit and reopen');
    expect(html).toContain(`href="${MAC_RELEASE_PAGE_URL}"`);
    expect(html).toContain('Open Anyway');
  });

  it('uses the installer on the company domain, as Help does', () => {
    expect(MAC_INSTALL_COMMAND).toBe(`curl -fsSL ${MAC_INSTALL_SCRIPT_URL} | bash`);
    expect(MAC_INSTALL_SCRIPT_URL).toBe('https://call.paramountintelligence.co/install-mac.sh');
    expect(USER_GUIDE_MD).toContain(MAC_INSTALL_COMMAND);
  });
});

describe('MacInstallLink', () => {
  it('says "Need it for macOS?" where the computer is not known yet (server render)', () => {
    const html = renderToString(<MacInstallLink />);
    expect(html).toMatch(/<button type="button"[^>]*>Need it for macOS\?<\/button>/);
  });

  it('takes its own words', () => {
    expect(renderToString(<MacInstallLink label="Get it for Mac" />)).toContain('Get it for Mac');
  });
});
