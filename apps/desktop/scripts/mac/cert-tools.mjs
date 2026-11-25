/**
 * File: apps/desktop/scripts/mac/cert-tools.mjs
 * Purpose: Works with the PUBLIC part of the company's Mac signing certificate (ADR-0109); never with the
 *          private key. Three commands:
 *            fingerprint <certificate.pem>
 *                Prints the SHA-1 (what macOS's signing rule and the keychain show) and the SHA-256 (what
 *                install-mac.sh pins).
 *            pin <certificate.pem> <install-mac.sh>
 *                Writes the SHA-256 into install-mac.sh's PINNED_CERT_SHA256 line.
 *            rule <certificate.pem> <team-id-file> <requirements-out>
 *                Writes the bridge signing rule for a later Developer ID switch (lib.mjs bridgeSigningRule).
 * Used by: scripts/mac/build.sh (fingerprint, rule), scripts/mac/verify-build.sh (fingerprint), the
 *          developer after stage 5 (pin; docs/deploy/mac-signing-certificate.md)
 * Depends on: node:crypto (X509Certificate), node:fs, scripts/mac/lib.mjs
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md §1, §4, §6
 */
import { X509Certificate } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { bridgeSigningRule } from './lib.mjs';

/**
 * Reads a PEM certificate.
 *
 * @param {string} file The .pem file.
 * @returns {X509Certificate} The certificate.
 */
function readCertificate(file) {
  return new X509Certificate(readFileSync(file));
}

/**
 * A fingerprint as plain hex (no colons), the way codesign's rules and shasum print it.
 *
 * @param {string} withColons For example 'AB:CD:…'.
 * @param {'upper' | 'lower'} letterCase The case to print.
 * @returns {string} The hex.
 */
function hex(withColons, letterCase) {
  const plain = withColons.replaceAll(':', '');
  return letterCase === 'upper' ? plain.toUpperCase() : plain.toLowerCase();
}

/**
 * Runs one command.
 *
 * @param {string[]} args The command line after the script's name.
 * @returns {number} The exit code.
 */
function main(args) {
  const [command, pem, second, third] = args;
  if (command === 'fingerprint' && pem) {
    const certificate = readCertificate(pem);
    console.log(`subject: ${certificate.subject.replaceAll('\n', ', ')}`);
    console.log(`valid to: ${certificate.validTo}`);
    console.log(`sha1: ${hex(certificate.fingerprint, 'upper')}`);
    console.log(`sha256: ${hex(certificate.fingerprint256, 'lower')}`);
    return 0;
  }
  if (command === 'pin' && pem && second) {
    const sha256 = hex(readCertificate(pem).fingerprint256, 'lower');
    const script = readFileSync(second, 'utf8');
    const line = /^PINNED_CERT_SHA256=.*$/m;
    if (!line.test(script)) {
      console.error('pin: no PINNED_CERT_SHA256= line in that file');
      return 1;
    }
    writeFileSync(
      second,
      script.replace(line, () => `PINNED_CERT_SHA256="${sha256}"`),
    );
    console.log(`pin: install-mac.sh now expects ${sha256}`);
    return 0;
  }
  if (command === 'rule' && pem && second && third) {
    const sha1 = readCertificate(pem).fingerprint;
    writeFileSync(third, bridgeSigningRule(sha1, readFileSync(second, 'utf8')));
    console.log('rule: bridge signing rule written (our certificate, or the Developer ID team)');
    return 0;
  }
  console.error(
    'usage: cert-tools.mjs fingerprint <certificate.pem>\n' +
      '       cert-tools.mjs pin <certificate.pem> <install-mac.sh>\n' +
      '       cert-tools.mjs rule <certificate.pem> <team-id-file> <requirements-out>',
  );
  return 2;
}

process.exitCode = main(process.argv.slice(2));
