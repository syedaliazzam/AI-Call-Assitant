/**
 * File: apps/web/src/server/job-page.ts
 * Purpose: Fetches a public job page for "Paste a job link" and turns it into plain text. The
 *          server fetches a URL a user typed, so it must never reach anything private (SSRF):
 *          only http and https on the usual ports; every address a host name resolves to is
 *          checked, and the connection uses only those checked addresses, so a host cannot
 *          change its answer between the check and the connection; every redirect is checked
 *          the same way; and time and size are limited.
 * Used by: app/api/job-import/route.ts
 * Depends on: node:dns, node:http, node:https, node:net, node:zlib
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2, §8; ADR-0029
 *
 * Page text is never logged.
 */
import 'server-only';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

/** Time limit for one page, redirects included, in ms. */
export const JOB_PAGE_TIMEOUT_MS = 10_000;

/** Largest page read, in bytes (after decompression). Job pages are far smaller. */
export const MAX_JOB_PAGE_BYTES = 3 * 1024 * 1024;

/** How many redirects are followed. */
export const MAX_JOB_PAGE_REDIRECTS = 3;

/** Most page text sent to Claude, in characters (about 7,500 tokens). */
export const MAX_JOB_TEXT_CHARS = 30_000;

/** Why a page could not be read. */
export type JobPageFailure =
  /** Not an http(s) URL on a usual port. */
  | 'bad_url'
  /** The address is private or otherwise not public. */
  | 'blocked'
  /** The site refused, timed out, or the page is not text. */
  | 'unreadable';

/** A page failure, carrying its reason. */
export class JobPageError extends Error {
  /** Why the page could not be read. */
  readonly reason: JobPageFailure;

  /**
   * @param reason Why the page could not be read.
   */
  constructor(reason: JobPageFailure) {
    super(reason);
    this.name = 'JobPageError';
    this.reason = reason;
  }
}

/** Addresses that are not on the public internet: loopback, private, link-local and so on. */
const PRIVATE_ADDRESSES = new BlockList();
PRIVATE_ADDRESSES.addSubnet('0.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('100.64.0.0', 10, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
// Includes the cloud metadata address 169.254.169.254.
PRIVATE_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('192.0.0.0', 24, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('198.18.0.0', 15, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('224.0.0.0', 4, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('240.0.0.0', 4, 'ipv4');
PRIVATE_ADDRESSES.addAddress('::', 'ipv6');
PRIVATE_ADDRESSES.addAddress('::1', 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('ff00::', 8, 'ipv6');

/**
 * Tells whether an address is on the public internet. An IPv6 form of an IPv4 address
 * (::ffff:10.0.0.1, or the older ::10.0.0.1, or 64:ff9b::a00:1) is judged by the IPv4 address.
 *
 * @param address An IP address.
 * @returns True only for a public address.
 * Called from: checkedLookup(), checkUrl(); tests
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 4) return !PRIVATE_ADDRESSES.check(address, 'ipv4');
  const embedded = embeddedIpv4(address);
  if (embedded) return !PRIVATE_ADDRESSES.check(embedded, 'ipv4');
  return !PRIVATE_ADDRESSES.check(address, 'ipv6');
}

/**
 * The IPv4 address inside an IPv6 one, if it has one.
 *
 * @param address An IPv6 address.
 * @returns The IPv4 address, or null.
 * Called from: isPublicAddress()
 */
function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /^(?:::(?:ffff:)?|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted?.[1]) return dotted[1];
  // Written in hex, as URL parsers normalise it: ::ffff:a00:1, ::a00:1 or 64:ff9b::a00:1.
  const hex = /^(?:::(?:ffff:)?|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex?.[1] || !hex[2]) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * Checks a URL before connecting: scheme, port, no credentials, and, when the host is written as
 * an IP address, that it is public. (A host name is checked when it resolves: checkedLookup().)
 *
 * @param text The URL.
 * @returns The parsed URL.
 * @throws JobPageError('bad_url' or 'blocked').
 * Called from: fetchJobPage(); tests
 */
export function checkUrl(text: string): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new JobPageError('bad_url');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new JobPageError('bad_url');
  if (url.username || url.password) throw new JobPageError('bad_url');
  if (url.port && url.port !== '80' && url.port !== '443') throw new JobPageError('bad_url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw new JobPageError('blocked');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new JobPageError('blocked');
  }
  return url;
}

/**
 * A DNS lookup for the connection that refuses any non-public answer. Passing this to the request
 * means the address that was checked is the address connected to.
 *
 * @param hostname The host.
 * @param options  Node's lookup options.
 * @param callback Receives the addresses, or an error.
 * Called from: the connection, in requestOnce(); tests
 */
export function checkedLookup(
  hostname: string,
  options: { all?: boolean } & Record<string, unknown>,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, '');
      return;
    }
    // Refused if any answer is private, so one public record cannot hide a private one.
    if (addresses.length === 0 || addresses.some((item) => !isPublicAddress(item.address))) {
      callback(new JobPageError('blocked'), '');
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
}

/**
 * Sends one request (no redirects followed).
 *
 * @param url    The checked URL.
 * @param signal Cancels it when time runs out.
 * @returns The response.
 * Called from: fetchJobPage()
 */
export function requestOnce(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: 'GET',
        signal,
        lookup: checkedLookup as never,
        headers: {
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'accept-encoding': 'gzip, deflate, br',
          // Says what this is; some sites refuse requests with no user agent.
          'user-agent': 'Mozilla/5.0 (compatible; KiteJobImport/1.0)',
        },
      },
      resolve,
    );
    request.on('error', reject);
    request.end();
  });
}

/**
 * Reads a response's body, decompressing it and stopping at the size limit (which also stops a
 * small compressed body that would expand enormously).
 *
 * @param response The response.
 * @returns The body as text.
 * @throws JobPageError('unreadable') when it is too large or cannot be read.
 * Called from: fetchJobPage()
 */
async function readBody(response: IncomingMessage): Promise<string> {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  let stream: Readable = response;
  if (encoding === 'gzip') stream = response.pipe(createGunzip());
  else if (encoding === 'deflate') stream = response.pipe(createInflate());
  else if (encoding === 'br') stream = response.pipe(createBrotliDecompress());
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_JOB_PAGE_BYTES) {
        response.destroy();
        throw new JobPageError('unreadable');
      }
      chunks.push(buffer);
    }
  } catch {
    throw new JobPageError('unreadable');
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetches a public page, following a few checked redirects.
 *
 * @param text The URL the user pasted.
 * @param send Sends one request (tests replace it).
 * @returns The page's address after redirects, and its body.
 * @throws JobPageError: 'bad_url', 'blocked' or 'unreadable'.
 * Called from: app/api/job-import/route.ts; tests
 */
export async function fetchJobPage(
  text: string,
  send: typeof requestOnce = requestOnce,
): Promise<{ url: URL; body: string }> {
  let url = checkUrl(text);
  const signal = AbortSignal.timeout(JOB_PAGE_TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_JOB_PAGE_REDIRECTS; hop += 1) {
    let response: IncomingMessage;
    try {
      response = await send(url, signal);
    } catch (error) {
      // The lookup's refusal arrives here as the request's error.
      if (error instanceof JobPageError) throw error;
      throw new JobPageError('unreadable');
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.destroy();
      url = checkUrl(new URL(response.headers.location, url).toString());
      continue;
    }
    if (status !== 200) {
      response.destroy();
      throw new JobPageError('unreadable');
    }
    const type = String(response.headers['content-type'] ?? '').toLowerCase();
    if (type && !type.includes('html') && !type.includes('text/plain')) {
      response.destroy();
      throw new JobPageError('unreadable');
    }
    return { url, body: await readBody(response) };
  }
  throw new JobPageError('unreadable');
}

/** Named HTML entities common in job pages. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  hellip: '…',
};

/**
 * Replaces HTML entities with their characters.
 *
 * @param text Text with entities.
 * @returns The text with them replaced (unknown ones stay).
 * Called from: pageText()
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/**
 * Plain text of an HTML page for Claude to read. Many job sites keep the posting in a JSON-LD
 * block, and show it only through scripts, so those blocks are kept; every other script and
 * style is dropped.
 *
 * @param html The page.
 * @returns Its text, cut to MAX_JOB_TEXT_CHARS.
 * Called from: app/api/job-import/route.ts; tests
 */
export function pageText(html: string): string {
  const structured = [
    ...html.matchAll(
      /<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .map((match) => match[1] ?? '')
    .filter((block) => /jobposting/i.test(block))
    .join('\n');
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '';
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // Block-level ends become line breaks, so a list does not run together.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities([title, structured, body].filter(Boolean).join('\n'))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return text.slice(0, MAX_JOB_TEXT_CHARS);
}
