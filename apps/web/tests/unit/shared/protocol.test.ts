/**
 * Tests packages/shared/src/protocol.ts (spec S9): a paramountai:// link opens the app or names one
 * session by UUID, and anything else in a link makes it invalid, because any web page can send one.
 */
import { DESKTOP_OPEN_LINK, desktopSessionLink, parseDesktopLink } from '@kite/shared';
import { describe, expect, it } from 'vitest';

/** A valid session id. */
const ID = '86495cda-fbd1-4cea-8387-cd29f5c1381b';

describe('parseDesktopLink', () => {
  it('reads the two shapes a link can have', () => {
    expect(parseDesktopLink(DESKTOP_OPEN_LINK)).toEqual({ kind: 'open' });
    expect(parseDesktopLink(desktopSessionLink(ID))).toEqual({ kind: 'session', sessionId: ID });
  });

  it('refuses anything that is not exactly a UUID', () => {
    for (const bad of [
      'paramountai://session/',
      'paramountai://session/123',
      'paramountai://session/../../etc/passwd',
      `paramountai://session/${ID}/extra`,
      `paramountai://session/${ID}x`,
      'paramountai://session/%2e%2e%2fsettings',
    ]) {
      expect(parseDesktopLink(bad), bad).toBeNull();
    }
  });

  it('refuses extra parts, so nothing but the id can reach the app', () => {
    for (const bad of [
      `paramountai://session/${ID}?start=true`,
      `paramountai://session/${ID}#start`,
      `paramountai://user:pass@session/${ID}`,
      `paramountai://session:8080/${ID}`,
      'paramountai://open?x=1',
      'paramountai://open/settings',
    ]) {
      expect(parseDesktopLink(bad), bad).toBeNull();
    }
  });

  it('refuses other schemes and non-links', () => {
    for (const bad of [`https://session/${ID}`, `kite://session/${ID}`, 'not a link', '']) {
      expect(parseDesktopLink(bad), bad).toBeNull();
    }
  });

  it('refuses other hosts', () => {
    expect(parseDesktopLink(`paramountai://settings/${ID}`)).toBeNull();
  });
});
