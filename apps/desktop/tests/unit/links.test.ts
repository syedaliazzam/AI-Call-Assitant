/**
 * Tests for apps/desktop/src/links.ts (spec S9; ADR-0052): a paramountai:// link is found among the
 * process's arguments, with or without a one-time sign-in code; anything else, or a malformed link or
 * code, is ignored; the protocol is registered only by an installed app on its own profile.
 */
import { describe, expect, it } from 'vitest';
import { linkFromArgv, shouldRegisterProtocol } from '../../src/links';

/** An invented session id. */
const ID = '86495cda-1b2c-4d3e-8f90-123456789abc';

/** An invented one-time code: 43 base64url characters. */
const CODE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';

describe('linkFromArgv', () => {
  it('finds a valid link among the arguments', () => {
    expect(linkFromArgv(['app.exe', '--flag', `paramountai://session/${ID}`])).toEqual({
      kind: 'session',
      sessionId: ID,
    });
    expect(linkFromArgv(['app.exe', 'paramountai://open'])).toEqual({ kind: 'open' });
  });

  it('reads a one-time code after the session (ADR-0052)', () => {
    expect(linkFromArgv(['app.exe', `paramountai://session/${ID}/${CODE}`])).toEqual({
      kind: 'session',
      sessionId: ID,
      code: CODE,
    });
  });

  it('ignores anything else, an invalid link, and a malformed code', () => {
    expect(linkFromArgv(['app.exe', '--flag'])).toBeNull();
    expect(linkFromArgv(['app.exe', 'paramountai://session/not-a-uuid'])).toBeNull();
    expect(linkFromArgv(['app.exe', `https://session/${ID}`])).toBeNull();
    expect(linkFromArgv(['app.exe', `paramountai://session/${ID}/short`])).toBeNull();
    expect(linkFromArgv(['app.exe', `paramountai://session/${ID}/${CODE}/more`])).toBeNull();
    expect(linkFromArgv(['app.exe', `paramountai://session/${ID}/${CODE}?x=1`])).toBeNull();
  });
});

describe('shouldRegisterProtocol', () => {
  it('registers only for an installed app on its own profile', () => {
    expect(shouldRegisterProtocol({ isPackaged: true, hasUserDataDirSwitch: false })).toBe(true);
    // A test run must never change what the person's computer opens.
    expect(shouldRegisterProtocol({ isPackaged: true, hasUserDataDirSwitch: true })).toBe(false);
    expect(shouldRegisterProtocol({ isPackaged: false, hasUserDataDirSwitch: false })).toBe(false);
  });
});
