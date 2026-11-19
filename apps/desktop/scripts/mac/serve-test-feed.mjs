/**
 * File: apps/desktop/scripts/mac/serve-test-feed.mjs
 * Purpose: The real-Mac update test's update feed (ADR-0109 §5; docs/testing/mac-release-test.md): serves
 *          one folder (a build's latest-mac.yml, .zip and .blockmap) on http://127.0.0.1:<port>/ only, with
 *          single byte ranges, as GitHub serves the mac-latest files. The installed app reads it when
 *          test-update-feed.txt in its data folder names this address (src/updater.ts testUpdateFeed()).
 *          Usage: node apps/desktop/scripts/mac/serve-test-feed.mjs <folder> [port, default 8765]
 * Used by: the teammate running the stage-6 test, on the Mac; not part of the automated suites
 * Depends on: node:http, node:fs, node:path, scripts/mac/lib.mjs (parseRange)
 * Architecture: docs/decisions/ADR-0109-macos-internal-release.md §5
 *
 * Logs each request's file name, range and status only (the files are app builds, never call content).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseRange } from './lib.mjs';

const [folderArg, portArg] = process.argv.slice(2);
if (!folderArg || !existsSync(folderArg) || !statSync(folderArg).isDirectory()) {
  console.error('usage: node serve-test-feed.mjs <folder with latest-mac.yml and the zip> [port]');
  process.exit(2);
}
const folder = path.resolve(folderArg);
const port = Number(portArg ?? 8765);

/**
 * The file a request asks for, if it is directly inside the folder (no sub-folders, no "..").
 *
 * @param {string | undefined} url The request's path.
 * @returns {string | null} The file's path, or null.
 */
function fileFor(url) {
  const name = decodeURIComponent(new URL(url ?? '/', 'http://127.0.0.1').pathname).replace(
    /^\/+/,
    '',
  );
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  const file = path.join(folder, name);
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const server = createServer((req, res) => {
  const file = fileFor(req.url);
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    res.writeHead(404).end();
    console.log(`${req.method} ${req.url} 404`);
    return;
  }
  const size = statSync(file).size;
  const range = parseRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    console.log(`${req.method} ${path.basename(file)} ${req.headers.range} 416`);
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  res.writeHead(range ? 206 : 200, {
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  console.log(
    `${req.method} ${path.basename(file)} ${range ? `${start}-${end}` : 'whole'} ${range ? 206 : 200}`,
  );
  if (req.method === 'HEAD' || size === 0) {
    res.end();
    return;
  }
  createReadStream(file, { start, end }).pipe(res);
});

// 127.0.0.1 only: nothing on the network can reach it.
server.listen(port, '127.0.0.1', () => {
  console.log(`Test update feed: http://127.0.0.1:${port}/ (folder ${folder}). Stop with Ctrl+C.`);
});
