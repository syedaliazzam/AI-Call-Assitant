/**
 * Tests for apps/web/src/core/drive/runner.ts, addresses.ts and picker.ts (ADR-0072):
 * - the uploader runs only in the window that gets the Web Lock (another window's run is "busy"), and in
 *   a browser it has no shell host (no recordings, no native notifications); ADR-0080: the recordings it
 *   tells the server to expect never have a stereo file;
 * - an "Also notify" list is lower-cased, de-duplicated, capped at 20, and names what is not an address;
 * - the Picker shows folders only (My Drive and Shared Drives), with setSelectFolderEnabled, the project
 *   number (setAppId) and a token Google Identity Services gives this browser (ADR-0074: never Kite's; the
 *   popup is asked for inside the click, with the company account as the hint), and answers the picked
 *   folder's id, or null on Cancel or when Google's popup is refused.
 * Google's script is a fake; no real Google call is made. All values are invented.
 */
import { DRIVE_FOLDER_MIME, type LocalRecording } from '@kite/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAddressList } from '@/core/drive/addresses';
import { preparePicker } from '@/core/drive/picker';
import { UPLOADER_LOCK, createUploaderDeps, runUploaderOnce } from '@/core/drive/runner';
import type { UploaderDeps } from '@/core/drive/uploader';
import type { Platform } from '@/platform/types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runUploaderOnce', () => {
  it('runs only with the lock, and says "busy" when another window holds it', async () => {
    const deps = {
      callActive: async () => true,
    } as unknown as UploaderDeps;
    const asked: string[] = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: async (name: string, _options: unknown, callback: (lock: unknown) => unknown) => {
          asked.push(name);
          return callback(null);
        },
      },
    });
    expect(await runUploaderOnce(deps)).toBe('busy');
    expect(asked).toEqual([UPLOADER_LOCK]);
    vi.stubGlobal('navigator', {
      locks: {
        request: async (_name: string, _options: unknown, callback: (lock: unknown) => unknown) =>
          callback({ name: UPLOADER_LOCK }),
      },
    });
    // With the lock it runs (and stops at once: a call is live).
    expect(await runUploaderOnce(deps)).toBe('call');
  });

  it('has no shell host in a browser', () => {
    const deps = createUploaderDeps({ drive: null, recording: null }, null);
    expect(deps.host).toBeNull();
    expect(() => deps.notice({ title: 't', body: 'b' })).not.toThrow();
  });

  it('ADR-0080: tells the server to expect each part without a stereo file (main video only)', async () => {
    const part: LocalRecording = {
      id: '22222222-2222-4222-8222-222222222222',
      sessionId: 'session-1',
      meetingId: 'meeting-1',
      part: 1,
      kind: 'screen',
      startedAt: 1_000,
      durationMs: 60_000,
      bytes: 1_000,
      fileName: 'x.mkv',
      hasStereo: true,
      status: 'complete',
    };
    const platform = {
      drive: {} as NonNullable<Platform['drive']>,
      recording: { list: async () => [part] } as unknown as NonNullable<Platform['recording']>,
    };
    const deps = createUploaderDeps(platform, null);
    expect(await deps.expectedRecordings('session-1')).toEqual([
      { id: part.id, part: 1, stereo: false, startedAt: 1_000, meetingId: 'meeting-1' },
    ]);
  });
});

describe('parseAddressList', () => {
  it('cleans the list and names what is not an address', () => {
    expect(parseAddressList('A@x.io, a@x.io; b@y.io\nnot-an-address')).toEqual({
      valid: ['a@x.io', 'b@y.io'],
      invalid: ['not-an-address'],
      tooMany: false,
    });
    const many = Array.from({ length: 25 }, (_, i) => `p${i}@x.io`).join(' ');
    const parsed = parseAddressList(many);
    expect(parsed.valid).toHaveLength(20);
    expect(parsed.tooMany).toBe(true);
    expect(parseAddressList('')).toEqual({ valid: [], invalid: [], tooMany: false });
  });
});

describe('preparePicker (ADR-0074: the Picker token comes from Google to this browser)', () => {
  it('opens a folders-only Picker with Shared Drives and the project number', async () => {
    const calls: string[] = [];
    let callback: ((data: { action: string; docs?: { id: string }[] }) => void) | null = null;
    /** A fake view that records its settings. */
    class View {
      /**
       * @param id The view id.
       */
      constructor(id: string) {
        calls.push(`view:${id}`);
      }
      /**
       * @param on Recorded.
       * @returns this
       */
      setIncludeFolders(on: boolean) {
        calls.push(`includeFolders:${on}`);
        return this;
      }
      /**
       * @param on Recorded.
       * @returns this
       */
      setSelectFolderEnabled(on: boolean) {
        calls.push(`selectFolder:${on}`);
        return this;
      }
      /**
       * @param types Recorded.
       * @returns this
       */
      setMimeTypes(types: string) {
        calls.push(`mime:${types}`);
        return this;
      }
      /**
       * @param on Recorded.
       * @returns this
       */
      setEnableDrives(on: boolean) {
        calls.push(`drives:${on}`);
        return this;
      }
    }
    /** A fake builder that records its settings. */
    class Builder {
      /** @returns this */
      addView() {
        return this;
      }
      /**
       * @param feature Recorded.
       * @returns this
       */
      enableFeature(feature: string) {
        calls.push(`feature:${feature}`);
        return this;
      }
      /**
       * @param token Recorded.
       * @returns this
       */
      setOAuthToken(token: string) {
        calls.push(`token:${token}`);
        return this;
      }
      /**
       * @param key Recorded.
       * @returns this
       */
      setDeveloperKey(key: string) {
        calls.push(`key:${key}`);
        return this;
      }
      /**
       * @param id Recorded.
       * @returns this
       */
      setAppId(id: string) {
        calls.push(`app:${id}`);
        return this;
      }
      /** @returns this */
      setTitle() {
        return this;
      }
      /**
       * @param cb Recorded.
       * @returns this
       */
      setCallback(cb: typeof callback) {
        callback = cb;
        return this;
      }
      /** @returns The picker. */
      build() {
        return { setVisible: () => calls.push('visible') };
      }
    }
    /** What Google Identity Services was asked. */
    const identity: { config?: Record<string, unknown>; requests: number; answer: object } = {
      requests: 0,
      answer: { access_token: 'browser-token' },
    };
    vi.stubGlobal('window', {
      gapi: { load: (_name: string, done: () => void) => done() },
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: Record<string, unknown>) => {
              identity.config = config;
              return {
                requestAccessToken: () => {
                  identity.requests += 1;
                  (config.callback as (r: object) => void)(identity.answer);
                },
              };
            },
          },
        },
        picker: {
          DocsView: View,
          PickerBuilder: Builder,
          ViewId: { FOLDERS: 'folders' },
          Feature: { SUPPORT_DRIVES: 'sdr' },
          Action: { PICKED: 'picked', CANCEL: 'cancel' },
        },
      },
    });
    const api = {
      pickerConfig: async () => ({
        apiKey: 'picker-key',
        appId: '1234',
        clientId: 'client.apps.googleusercontent.com',
        account: 'company@example.com',
      }),
    };
    const ready = await preparePicker(api);
    const picked = ready.pick();
    // Google's popup is asked for at once, inside the click (no await before it).
    expect(identity.requests).toBe(1);
    expect(identity.config).toMatchObject({
      client_id: 'client.apps.googleusercontent.com',
      scope: 'https://www.googleapis.com/auth/drive.file',
      hint: 'company@example.com',
    });
    await vi.waitFor(() => expect(callback).not.toBeNull());
    callback!({ action: 'picked', docs: [{ id: 'FOLDER-9' }] });
    expect(await picked).toBe('FOLDER-9');
    expect(calls).toContain(`mime:${DRIVE_FOLDER_MIME}`);
    expect(calls).toContain('selectFolder:true');
    expect(calls).toContain('drives:true');
    expect(calls).toContain('feature:sdr');
    expect(calls).toContain('app:1234');
    expect(calls).toContain('token:browser-token');
    expect(calls).toContain('key:picker-key');

    const cancelled = ready.pick();
    await vi.waitFor(() => expect(calls.filter((c) => c === 'visible')).toHaveLength(2));
    callback!({ action: 'cancel' });
    expect(await cancelled).toBeNull();

    // Google's popup closed or refused: no Picker, nothing picked.
    identity.answer = { error: 'access_denied' };
    expect(await ready.pick()).toBeNull();
    expect(calls.filter((c) => c === 'visible')).toHaveLength(2);
  });
});
