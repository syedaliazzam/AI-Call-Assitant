/**
 * Tests for the Mac release scripts' helpers (ADR-0109): apps/desktop/scripts/mac/lib.mjs reads
 * latest-mac.yml as electron-builder writes it, hashes files as electron-updater checks them (SHA-512,
 * base64), writes the bridge signing rule only from a well-formed SHA-1 and Team ID, and answers single
 * byte ranges; apps/desktop/scripts/mac/cert-tools.mjs prints a certificate's fingerprints and pins the
 * SHA-256 into an installer script. The certificate is a throwaway test certificate (public part only,
 * tests/fixtures/mac/test-certificate.pem); it signs nothing.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bridgeSigningRule,
  parseRange,
  readUpdateInfo,
  sha512Base64,
} from '../../scripts/mac/lib.mjs';

const desktop = path.resolve(import.meta.dirname, '..', '..');
const certTools = path.join(desktop, 'scripts', 'mac', 'cert-tools.mjs');
const testCertificate = path.join(desktop, 'tests', 'fixtures', 'mac', 'test-certificate.pem');
/** The test certificate's fingerprints (openssl x509 -fingerprint). */
const TEST_SHA1 = '87268EE0F29F3BE418291A8DAE0B488F5879B656';
const TEST_SHA256 = '95f7d92478cef6ee8f37d886b6c1dbd8d1755d4e606b7baf9e7782a76d3d2b02';

/** Folders made by a test, removed after it. */
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A new empty folder for one test.
 *
 * @returns Its path.
 */
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kite-mac-scripts-'));
  made.push(dir);
  return dir;
}

/** A latest-mac.yml as electron-builder 26 writes it (js-yaml). */
const LATEST_MAC = `version: 1.8.0
files:
  - url: Paramount-AI-1.8.0-universal-mac.zip
    sha512: AAAAzip==
    size: 312345678
  - url: Paramount-AI-1.8.0-universal.dmg
    sha512: BBBBdmg==
    size: 320000000
path: Paramount-AI-1.8.0-universal-mac.zip
sha512: AAAAzip==
releaseDate: '2026-11-20T10:00:00.000Z'
`;

describe('readUpdateInfo', () => {
  it('reads the version, the zip, its SHA-512 and every file', () => {
    expect(readUpdateInfo(LATEST_MAC)).toEqual({
      version: '1.8.0',
      path: 'Paramount-AI-1.8.0-universal-mac.zip',
      sha512: 'AAAAzip==',
      files: [
        { url: 'Paramount-AI-1.8.0-universal-mac.zip', sha512: 'AAAAzip==', size: 312345678 },
        { url: 'Paramount-AI-1.8.0-universal.dmg', sha512: 'BBBBdmg==', size: 320000000 },
      ],
    });
  });

  it('accepts Windows line endings and quoted values', () => {
    const text = LATEST_MAC.replace('path: Paramount', "path: 'Paramount").replace(
      '-mac.zip\nsha512',
      "-mac.zip'\nsha512",
    );
    expect(readUpdateInfo(text.replaceAll('\n', '\r\n')).path).toBe(
      'Paramount-AI-1.8.0-universal-mac.zip',
    );
  });

  it('refuses a file without its main fields', () => {
    expect(() => readUpdateInfo('version: 1.8.0\n')).toThrow('latest-mac.yml is missing path');
  });
});

describe('sha512Base64', () => {
  it('matches the base64 SHA-512 electron-updater checks', async () => {
    const file = path.join(tempDir(), 'app.zip');
    writeFileSync(file, 'not really a zip');
    const expected = createHash('sha512').update('not really a zip').digest('base64');
    await expect(sha512Base64(file)).resolves.toBe(expected);
  });
});

describe('bridgeSigningRule', () => {
  it('accepts our certificate or the Developer ID team, with no bundle id', () => {
    const rule = bridgeSigningRule(
      '87:26:8e:e0:f2:9f:3b:e4:18:29:1a:8d:ae:0b:48:8f:58:79:b6:56',
      'AB12CD34EF\n',
    );
    expect(rule).toBe(
      `designated => certificate root = H"${TEST_SHA1}" or (anchor apple generic and certificate leaf[subject.OU] = "AB12CD34EF")\n`,
    );
    expect(rule).not.toContain('identifier');
  });

  it('refuses a malformed fingerprint or Team ID', () => {
    expect(() => bridgeSigningRule('1234', 'AB12CD34EF')).toThrow('not a SHA-1 fingerprint');
    expect(() => bridgeSigningRule(TEST_SHA1, 'ab12cd34ef')).toThrow('not an Apple Team ID');
    expect(() => bridgeSigningRule(TEST_SHA1, 'AB12CD34EF") or (true')).toThrow(
      'not an Apple Team ID',
    );
  });
});

describe('parseRange', () => {
  it('answers no header with the whole file', () => {
    expect(parseRange(undefined, 100)).toBeNull();
  });

  it('reads start-end, start- and suffix ranges, clamped to the file', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
  });

  it('refuses ranges it cannot answer (416)', () => {
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=9-1', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
    expect(parseRange('bytes=-0', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

describe('cert-tools.mjs', () => {
  /**
   * Runs cert-tools.mjs.
   *
   * @param args Its arguments.
   * @returns Its exit code and output.
   */
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [certTools, ...args], { encoding: 'utf8' });

  it('prints the SHA-1 and SHA-256 fingerprints', () => {
    const result = run('fingerprint', testCertificate);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`sha1: ${TEST_SHA1}`);
    expect(result.stdout).toContain(`sha256: ${TEST_SHA256}`);
  });

  it('pins the SHA-256 into an installer script, and only into its PINNED_CERT_SHA256 line', () => {
    const script = path.join(tempDir(), 'install-mac.sh');
    writeFileSync(script, '#!/bin/bash\nPINNED_CERT_SHA256="none-yet"\necho PINNED_CERT_SHA256\n');
    expect(run('pin', testCertificate, script).status).toBe(0);
    expect(readFileSync(script, 'utf8')).toBe(
      `#!/bin/bash\nPINNED_CERT_SHA256="${TEST_SHA256}"\necho PINNED_CERT_SHA256\n`,
    );
  });

  it('writes the bridge rule from a Team ID file', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'team.txt'), 'AB12CD34EF\n');
    const out = path.join(dir, 'requirements.txt');
    expect(run('rule', testCertificate, path.join(dir, 'team.txt'), out).status).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain(`certificate root = H"${TEST_SHA1}"`);
  });

  it('explains its usage for an unknown command', () => {
    expect(run('sign', testCertificate).status).toBe(2);
  });
});
