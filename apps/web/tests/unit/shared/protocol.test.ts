/**
 * Tests packages/shared/src/protocol.ts (spec S9): a paramountai:// link opens the app or names one
 * session by UUID, and anything else in a link makes it invalid, because any web page can send one.
 * Desktop 1.5.0 (ADR-0068): recording/<id> names one recording, and nothing more.
 */
import {
  DESKTOP_OPEN_LINK,
  desktopRecordingLink,
  desktopSessionLink,
  handoffFileName,
  parseDesktopLink,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';

/** A valid session id. */
const ID = '86495cda-fbd1-4cea-8387-cd29f5c1381b';

describe('handoffFileName', () => {
  it('is paramount-ai-session-<short id>.json', () => {
    expect(handoffFileName(ID)).toBe('paramount-ai-session-86495cda.json');
  });
});

describe('parseDesktopLink', () => {
  it('reads the two shapes a link can have', () => {
    expect(parseDesktopLink(DESKTOP_OPEN_LINK)).toEqual({ kind: 'open' });
    expect(parseDesktopLink(desktopSessionLink(ID))).toEqual({ kind: 'session', sessionId: ID });
  });

  it('reads a one-time sign-in code after the session, and only a well-formed one (ADR-0052)', () => {
    const code = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
    expect(parseDesktopLink(desktopSessionLink(ID, code))).toEqual({
      kind: 'session',
      sessionId: ID,
      code,
    });
    for (const bad of [
      `paramountai://session/${ID}/${code.slice(1)}`,
      `paramountai://session/${ID}/${code}x`,
      `paramountai://session/${ID}/${code.slice(1)}=`,
      `paramountai://session/${ID}/${code}/more`,
    ]) {
      expect(parseDesktopLink(bad), bad).toBeNull();
    }
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

describe('recording links (desktop 1.5.0, ADR-0068)', () => {
  it('names one recording by UUID, and nothing more', () => {
    expect(desktopRecordingLink(ID)).toBe(`paramountai://recording/${ID}`);
    expect(parseDesktopLink(desktopRecordingLink(ID))).toEqual({
      kind: 'recording',
      recordingId: ID,
    });
    expect(parseDesktopLink('paramountai://recording/not-a-uuid')).toBeNull();
    expect(parseDesktopLink(`paramountai://recording/${ID}/extra`)).toBeNull();
    expect(parseDesktopLink(`paramountai://recording/${ID}?play=1`)).toBeNull();
    expect(parseDesktopLink('paramountai://recording')).toBeNull();
  });
});
