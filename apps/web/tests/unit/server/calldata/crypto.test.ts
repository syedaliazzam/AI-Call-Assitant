/**
 * Tests for apps/web/src/server/calldata/crypto.ts (ADR-0049): AES-256-GCM round trip; a fresh IV per
 * record; the ciphertext is bound to its account, kind, id and key version; a changed byte fails;
 * keys are read from KITE_DATA_KEY_V<n> with the highest as current; a missing or malformed key gives
 * a DataKeyError that names the variable and never shows a value.
 */
import { describe, expect, it } from 'vitest';
import { DataKeyError, loadDataKeys, open, seal } from '@/server/calldata/crypto';
import { testKeyEnv } from './pgliteDb';

/** A row the tests encrypt for. */
const ROW = { userId: 'user-a', kind: 'session', id: 'id-1' };

describe('seal and open', () => {
  it('round-trips, with a fresh IV each time', () => {
    const keys = loadDataKeys(testKeyEnv([1]));
    const a = seal(keys, ROW, '{"company":"Invented"}');
    const b = seal(keys, ROW, '{"company":"Invented"}');
    expect(a.content).not.toBe(b.content);
    expect(a.keyVersion).toBe(1);
    expect(open(keys, ROW, a.keyVersion, a.content)).toBe('{"company":"Invented"}');
  });

  it('fails for another account, kind, id or version, and for a changed byte', () => {
    const keys = loadDataKeys(testKeyEnv([1, 2]));
    const sealed = seal(keys, ROW, 'text');
    expect(sealed.keyVersion).toBe(2);
    expect(() => open(keys, { ...ROW, userId: 'user-b' }, 2, sealed.content)).toThrow();
    expect(() => open(keys, { ...ROW, kind: 'answer' }, 2, sealed.content)).toThrow();
    expect(() => open(keys, { ...ROW, id: 'id-2' }, 2, sealed.content)).toThrow();
    expect(() => open(keys, ROW, 1, sealed.content)).toThrow();
    const bytes = Buffer.from(sealed.content, 'base64');
    bytes[bytes.length - 1] = bytes.at(-1)! ^ 1;
    expect(() => open(keys, ROW, 2, bytes.toString('base64'))).toThrow();
  });
});

describe('loadDataKeys', () => {
  it('uses the highest version as current', () => {
    const keys = loadDataKeys(testKeyEnv([1, 3]));
    expect(keys.current).toBe(3);
    expect([...keys.keys.keys()]).toEqual([1, 3]);
  });

  it('refuses a missing or malformed key, naming the variable only', () => {
    expect(() => loadDataKeys({})).toThrow(DataKeyError);
    const short = Buffer.from('short-secret-value').toString('base64');
    let message = '';
    try {
      loadDataKeys({ KITE_DATA_KEY_V1: short });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('KITE_DATA_KEY_V1 must be 32 bytes, base64-encoded (it decodes to 18).');
    expect(message).not.toContain(short);
  });
});
