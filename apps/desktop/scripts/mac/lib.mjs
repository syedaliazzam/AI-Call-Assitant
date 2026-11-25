/**
 * File: apps/desktop/scripts/mac/lib.mjs
 * Purpose: Small helpers shared by the Mac release scripts (ADR-0109): read electron-builder's
 *          latest-mac.yml, compute a file's SHA-512 the way it does (base64), write the "bridge" signing
 *          rule for a later Developer ID switch, and answer HTTP byte ranges for the local test feed.
 *          Plain JavaScript with no dependencies, so the scripts run with Node alone on the build Mac and
 *          on the developer's laptop.
 * Used by: scripts/mac/publish-mac.mjs, scripts/mac/serve-test-feed.mjs, scripts/mac/cert-tools.mjs;
 *          tests/unit/macScripts.test.ts (types in lib.d.mts)
 * Depends on: node:crypto, node:fs
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md §3, §5, §6
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Removes the quotes js-yaml may put around a value ('2026-11-20T…' or "…").
 *
 * @param {string} value The raw value.
 * @returns {string} The value without surrounding quotes.
 */
function unquote(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Reads the parts of electron-builder's latest-mac.yml the scripts need. It understands exactly the shape
 * electron-builder writes (top-level `key: value` lines and a `files:` list of `url`, `sha512`, `size`),
 * not YAML in general.
 *
 * @param {string} text The file's text.
 * @returns {{ version: string, path: string, sha512: string, files: { url: string, sha512: string, size: number }[] }}
 *          The version, the main file (the zip) and its SHA-512, and every listed file.
 * @throws Error('latest-mac.yml is missing <field>') when version, path or sha512 is absent.
 * Called from: publish-mac.mjs; tests
 */
export function readUpdateInfo(text) {
  /** @type {Record<string, string>} */
  const top = {};
  /** @type {{ url: string, sha512: string, size: number }[]} */
  const files = [];
  /** @type {{ url: string, sha512: string, size: number } | null} */
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const item = /^\s+-\s+url:\s*(.*)$/.exec(raw);
    if (item) {
      current = { url: unquote(item[1] ?? ''), sha512: '', size: 0 };
      files.push(current);
      continue;
    }
    const field = /^\s+(sha512|size):\s*(.*)$/.exec(raw);
    if (field && current) {
      if (field[1] === 'sha512') current.sha512 = unquote(field[2] ?? '');
      else current.size = Number(unquote(field[2] ?? ''));
      continue;
    }
    const pair = /^([A-Za-z][\w]*):\s*(.*)$/.exec(raw);
    if (pair) {
      current = null;
      top[pair[1] ?? ''] = unquote(pair[2] ?? '');
    }
  }
  for (const name of ['version', 'path', 'sha512']) {
    if (!top[name]) throw new Error(`latest-mac.yml is missing ${name}`);
  }
  return {
    version: top.version ?? '',
    path: top.path ?? '',
    sha512: top.sha512 ?? '',
    files,
  };
}

/**
 * A file's SHA-512 in base64, as electron-builder writes it in latest-mac.yml and electron-updater checks.
 *
 * @param {string} filePath The file.
 * @returns {Promise<string>} The hash in base64.
 * Called from: publish-mac.mjs; tests
 */
export function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('base64')));
  });
}

/**
 * The bridge signing rule (ADR-0109 §6): any code signed with our self-signed certificate, or with the
 * company's future Apple Developer ID certificate. It names no bundle id on purpose: electron-builder applies
 * one requirements file to every signed file, including the helper apps, whose bundle ids differ.
 *
 * @param {string} certificateSha1 Our certificate's SHA-1, 40 hex characters (any case, colons allowed).
 * @param {string} teamId          The Apple Team ID, 10 capital letters or digits.
 * @returns {string} The requirements file's text (one line and a newline).
 * @throws Error('not a SHA-1 fingerprint') or Error('not an Apple Team ID') for malformed input.
 * Called from: cert-tools.mjs rule (run by build.sh); tests
 */
export function bridgeSigningRule(certificateSha1, teamId) {
  const sha1 = certificateSha1.replaceAll(':', '').trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(sha1)) throw new Error('not a SHA-1 fingerprint');
  const team = teamId.trim();
  if (!/^[A-Z0-9]{10}$/.test(team)) throw new Error('not an Apple Team ID');
  return `designated => certificate root = H"${sha1}" or (anchor apple generic and certificate leaf[subject.OU] = "${team}")\n`;
}

/**
 * Reads one HTTP byte range ("bytes=0-99", "bytes=100-", "bytes=-50") for a file of a given size. Several
 * ranges in one header are refused (electron-updater asks for one at a time with useMultipleRangeRequest off).
 *
 * @param {string | undefined} header The Range header, if any.
 * @param {number} size The file's size in bytes.
 * @returns {{ start: number, end: number } | null | 'invalid'} The inclusive range; null for the whole file
 *          (no header); 'invalid' for a range the server must answer with 416.
 * Called from: serve-test-feed.mjs; tests
 */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'invalid';
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return 'invalid';
  return { start, end };
}
