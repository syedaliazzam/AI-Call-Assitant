/**
 * Tests for apps/web/public/install-mac.sh (ADR-0109 §4), read as text (it is a bash script for macOS and
 * runs only on a Mac): it reads the same update channel electron-builder.yml publishes to, runs nothing
 * until its last line (so a download cut short runs nothing), accepts only https or a feed on the Mac
 * itself, checks the SHA-512, the signature, the pinned certificate and the bundle id before it installs,
 * never asks for an administrator password, and, once the company certificate is committed
 * (build/mac-signing/certificate.pem), pins exactly that certificate's SHA-256.
 */
import { X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const desktop = path.resolve(import.meta.dirname, '..', '..');
const installer = readFileSync(path.join(desktop, '..', 'web', 'public', 'install-mac.sh'), 'utf8');
const builderConfig = readFileSync(path.join(desktop, 'electron-builder.yml'), 'utf8');
const certificate = path.join(desktop, 'build', 'mac-signing', 'certificate.pem');

/**
 * The value of a `NAME="value"` line in the installer.
 *
 * @param name The variable's name.
 * @returns Its value, or undefined.
 */
function variable(name: string): string | undefined {
  return new RegExp(`^${name}="([^"]*)"$`, 'm').exec(installer)?.[1];
}

describe('install-mac.sh', () => {
  it('reads the channel electron-builder.yml publishes the Mac app to', () => {
    const published = /^ {4}url: (https:\/\/\S+)$/m.exec(builderConfig)?.[1];
    expect(published).toBe(
      'https://github.com/Zainpak123/kite-releases/releases/download/mac-latest',
    );
    expect(variable('FEED_DEFAULT')).toBe(published);
    expect(variable('BUNDLE_ID')).toBe('co.paramountintelligence.kite');
  });

  it('runs nothing before its last line', () => {
    const lines = installer.trimEnd().split('\n');
    expect(lines[0]).toBe('#!/bin/bash');
    expect(lines.at(-1)).toBe('main "$@"');
    // Outside main() there are only comments, blank lines and constants.
    const body = installer.slice(0, installer.indexOf('main() {'));
    for (const line of body.split('\n')) {
      expect(line === '' || line.startsWith('#') || /^[A-Z_0-9]+="[^"]*"$/.test(line)).toBe(true);
    }
  });

  it('accepts only https, or a feed on this Mac (the stage-6 test)', () => {
    expect(installer).toContain('https://*) ;;');
    expect(installer).toContain('http://127.0.0.1:* | http://localhost:*) protocols="=http" ;;');
    expect(installer).toContain('--proto "$protocols" --proto-redir "$protocols"');
  });

  it('checks the download, the signature, the certificate and the bundle id before installing', () => {
    const order = [
      'openssl dgst -sha512',
      'codesign --verify --deep --strict',
      'codesign -d --extract-certificates',
      '[ "$signer" = "$PINNED_CERT_SHA256" ]',
      '[ "$bundle_id" = "$BUNDLE_ID" ]',
      'ditto "$app" "$staged"',
      'xattr -dr com.apple.quarantine',
    ].map((text) => installer.indexOf(text));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('never asks for an administrator password', () => {
    expect(installer).not.toMatch(/\bsudo\b/);
  });

  it.skipIf(!existsSync(certificate))(
    'pins the committed company certificate (stage 5 onwards)',
    () => {
      const sha256 = new X509Certificate(readFileSync(certificate)).fingerprint256
        .replaceAll(':', '')
        .toLowerCase();
      expect(variable('PINNED_CERT_SHA256')).toBe(sha256);
    },
  );
});
