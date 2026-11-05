/**
 * Tests for apps/desktop/src/config.ts:
 * KITE_URL defaults to production, the --kite-url flag and the KITE_URL variable override it
 * (variable first), production allows exactly its two addresses, any other address allows only
 * itself, and only https (or http to localhost) is accepted. Also the rename's pinned data folder (spec §2).
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  APP_NAME,
  DATA_FOLDER_NAME,
  parseKiteUrl,
  pinnedDataFolder,
  PRODUCTION_ORIGINS,
  PRODUCTION_URL,
  resolveConfig,
} from '../../src/config';

describe('the rename keeps the data folder (spec §2)', () => {
  const appData = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming');

  it('shows the new name and keeps the old folder', () => {
    expect(APP_NAME).toBe('Paramount AI');
    expect(DATA_FOLDER_NAME).toBe('Kite');
  });

  it('pins an installed app to the folder it has always used', () => {
    expect(pinnedDataFolder({ isPackaged: true, hasUserDataDirSwitch: false, appData })).toBe(
      path.join(appData, 'Kite'),
    );
  });

  it('never overrides --user-data-dir: test runs must not reach a real profile', () => {
    expect(pinnedDataFolder({ isPackaged: true, hasUserDataDirSwitch: true, appData })).toBeNull();
  });

  it('leaves a development run alone', () => {
    expect(
      pinnedDataFolder({ isPackaged: false, hasUserDataDirSwitch: false, appData }),
    ).toBeNull();
  });
});

describe('resolveConfig', () => {
  it('opens production by default', () => {
    expect(resolveConfig({}, [])).toEqual({
      kiteUrl: 'https://call.paramountintelligence.co/',
      allowedOrigins: [
        'https://call.paramountintelligence.co',
        'https://kite-call-assistant.vercel.app',
      ],
    });
    expect(PRODUCTION_URL).toBe('https://call.paramountintelligence.co');
  });

  it('uses the --kite-url flag (the dev script passes localhost:3000)', () => {
    expect(resolveConfig({}, ['electron', '.', '--kite-url=http://localhost:3000'])).toEqual({
      kiteUrl: 'http://localhost:3000/',
      allowedOrigins: ['http://localhost:3000'],
    });
  });

  it('lets the KITE_URL variable override the flag and the default', () => {
    const config = resolveConfig({ KITE_URL: 'https://staging.example.com/app' }, [
      '--kite-url=http://localhost:3000',
    ]);
    expect(config.kiteUrl).toBe('https://staging.example.com/app');
    expect(config.allowedOrigins).toEqual(['https://staging.example.com']);
  });

  it('ignores an empty KITE_URL', () => {
    expect(resolveConfig({ KITE_URL: '' }, []).allowedOrigins).toEqual(PRODUCTION_ORIGINS);
  });

  it('allows exactly the two production addresses, the new one first (ADR-0046)', () => {
    expect(PRODUCTION_ORIGINS).toEqual([
      'https://call.paramountintelligence.co',
      'https://kite-call-assistant.vercel.app',
    ]);
  });

  it('allows both production addresses when opened on the old one', () => {
    const config = resolveConfig({ KITE_URL: 'https://kite-call-assistant.vercel.app/' }, []);
    expect(config.kiteUrl).toBe('https://kite-call-assistant.vercel.app/');
    expect(config.allowedOrigins).toEqual(PRODUCTION_ORIGINS);
  });

  it('never widens the list for a look-alike of a production address', () => {
    const config = resolveConfig(
      { KITE_URL: 'https://call.paramountintelligence.co.evil.com/' },
      [],
    );
    expect(config.allowedOrigins).toEqual(['https://call.paramountintelligence.co.evil.com']);
  });
});

describe('parseKiteUrl', () => {
  it('accepts https and http to this computer only', () => {
    expect(parseKiteUrl('https://kite-call-assistant.vercel.app').origin).toBe(
      'https://kite-call-assistant.vercel.app',
    );
    expect(parseKiteUrl('http://127.0.0.1:5123').origin).toBe('http://127.0.0.1:5123');
    expect(parseKiteUrl('http://localhost:3000').origin).toBe('http://localhost:3000');
  });

  it('rejects plain http to another host', () => {
    expect(() => parseKiteUrl('http://kite-call-assistant.vercel.app')).toThrow(/must use https/);
  });

  it('rejects other schemes and non-URLs', () => {
    expect(() => parseKiteUrl('file:///C:/kite/index.html')).toThrow(/must use https/);
    expect(() => parseKiteUrl('not a url')).toThrow(/is not a URL/);
  });
});
