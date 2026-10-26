/**
 * Tests for apps/desktop/src/config.ts:
 * KITE_URL defaults to production, the --kite-url flag and the KITE_URL variable override it
 * (variable first), ALLOWED_ORIGIN is derived from KITE_URL only, and only https (or http to
 * localhost) is accepted.
 */
import { describe, expect, it } from 'vitest';
import { parseKiteUrl, PRODUCTION_URL, resolveConfig } from '../../src/config';

describe('resolveConfig', () => {
  it('opens production by default', () => {
    expect(resolveConfig({}, [])).toEqual({
      kiteUrl: 'https://kite-call-assistant.vercel.app/',
      allowedOrigin: 'https://kite-call-assistant.vercel.app',
    });
    expect(PRODUCTION_URL).toBe('https://kite-call-assistant.vercel.app');
  });

  it('uses the --kite-url flag (the dev script passes localhost:3000)', () => {
    expect(resolveConfig({}, ['electron', '.', '--kite-url=http://localhost:3000'])).toEqual({
      kiteUrl: 'http://localhost:3000/',
      allowedOrigin: 'http://localhost:3000',
    });
  });

  it('lets the KITE_URL variable override the flag and the default', () => {
    const config = resolveConfig({ KITE_URL: 'https://staging.example.com/app' }, [
      '--kite-url=http://localhost:3000',
    ]);
    expect(config.kiteUrl).toBe('https://staging.example.com/app');
    expect(config.allowedOrigin).toBe('https://staging.example.com');
  });

  it('ignores an empty KITE_URL', () => {
    expect(resolveConfig({ KITE_URL: '' }, []).allowedOrigin).toBe(
      'https://kite-call-assistant.vercel.app',
    );
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
