/**
 * Upgrade test on a real database (v1.1.0, item 31): the real storage code of release v1.0.4, checked
 * out of git, fills a real IndexedDB in Chromium, at its own schema version. Then today's code opens the
 * same database, as an updated app does. Covers: every session, document, transcript line, answer,
 * note, lesson, library item and Ask Kite chat survives, word for word; the only changes are the fields
 * version 8 adds; answers get the call they belong to, estimated from long gaps; sessions get the length
 * of their latest call; and a second opening changes nothing. All text is invented.
 *
 * Needs git and the commit that v1.0.4 was merged in (the repository has it).
 */
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { build } from 'esbuild';

/** apps/web. */
const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The repository's root. */
const ROOT = path.resolve(WEB_DIR, '..', '..');

/** The merge of release v1.0.4 into main. */
const V104_COMMIT = 'a088534';

/** The schema version v1.0.4 wrote. */
const V104_SCHEMA = 7;

/**
 * The schema version today's code upgrades it to (9 adds only the sync bookkeeping stores, ADR-0049;
 * 10 only the recording records, ADR-0068; 11 only the Drive uploads, ADR-0072; 12 only the calls, their
 * notes and their Drive uploads, ADR-0077).
 */
const CURRENT_SCHEMA = 12;

let work = '';
let oldCode = '';
let server: Server | null = null;
let browser: Browser | null = null;
let origin = '';

test.beforeAll(async () => {
  work = mkdtempSync(path.join(tmpdir(), 'kite-db-upgrade-'));
  oldCode = path.join(work, 'v104');
  // Its own folder, so nothing in the working copy changes.
  execFileSync('git', ['worktree', 'add', '--detach', oldCode, V104_COMMIT], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  const options = {
    bundle: true,
    platform: 'browser',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
  } as const;
  await build({
    ...options,
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'db-v104-seed.ts')],
    outfile: path.join(work, 'seed.js'),
    // Its imports, resolved in the old code; packages from today's install.
    alias: {
      '@/core/storage': path.join(oldCode, 'apps', 'web', 'src', 'core', 'storage'),
      '@kite/shared': path.join(oldCode, 'packages', 'shared', 'src', 'index.ts'),
    },
    nodePaths: [path.join(WEB_DIR, 'node_modules')],
  });
  await build({
    ...options,
    entryPoints: [path.join(WEB_DIR, 'tests', 'integration', 'harness', 'db-v104-read.ts')],
    outfile: path.join(work, 'read.js'),
    tsconfig: path.join(WEB_DIR, 'tsconfig.json'),
  });
  server = createServer((req, res) => {
    if (req.url === '/seed.js' || req.url === '/read.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(readFileSync(path.join(work, req.url.slice(1))));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    const script = req.url?.startsWith('/read') ? 'read' : 'seed';
    res.end(
      `<!doctype html><title>Database upgrade</title><script type="module" src="/${script}.js"></script>`,
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch();
});

test.afterAll(async () => {
  await browser?.close();
  server?.close();
  if (oldCode) {
    execFileSync('git', ['worktree', 'remove', '--force', oldCode], { cwd: ROOT, stdio: 'ignore' });
  }
  if (work) rmSync(work, { recursive: true, force: true });
});

test('a database from v1.0.4 keeps everything, and gains only the new fields', async () => {
  test.setTimeout(120_000);
  const context = await browser!.newContext();
  const seed = await context.newPage();
  await seed.goto(`${origin}/seed`);
  await seed.waitForFunction(() => typeof window.seedOldDatabase === 'function');
  expect(await seed.evaluate(() => window.seedOldDatabase())).toBe(V104_SCHEMA);
  // What v1.0.4 itself stored, read straight from the browser's database.
  const before = await seed.evaluate(
    () =>
      new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const opened = indexedDB.open('kite');
        opened.onerror = () => reject(new Error('open failed'));
        opened.onsuccess = () => {
          const db = opened.result;
          const names = [...db.objectStoreNames];
          const out: Record<string, unknown[]> = {};
          let left = names.length;
          for (const name of names) {
            const all = db.transaction(name).objectStore(name).getAll();
            all.onsuccess = () => {
              out[name] = all.result as unknown[];
              left -= 1;
              if (left === 0) {
                db.close();
                resolve(out);
              }
            };
          }
        };
      }),
  );
  await seed.close();
  for (const store of ['sessions', 'documents', 'utterances', 'answers', 'library', 'chats']) {
    expect(before[store], store).toBeTruthy();
    expect(before[store]!.length, store).toBeGreaterThan(0);
  }

  const reader = await context.newPage();
  await reader.goto(`${origin}/read`);
  await reader.waitForFunction(() => typeof window.readDatabase === 'function');
  const after = await reader.evaluate(() => window.readDatabase());
  expect(after.version).toBe(CURRENT_SCHEMA);

  // Every store has the same rows, word for word, apart from the fields the upgrade adds.
  const without = (row: unknown, ...fields: string[]) => {
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of fields) delete copy[field];
    return copy;
  };
  const byId = (rows: unknown[]) =>
    [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const [store, rows] of Object.entries(before)) {
    const now = after.rows[store] ?? [];
    expect(now.length, store).toBe(rows.length);
    if (store === 'answers') {
      expect(byId(now.map((row) => without(row, 'callStartedAt')))).toEqual(byId(rows));
    } else if (store === 'sessions') {
      expect(byId(now.map((row) => without(row, 'lastCallMs')))).toEqual(byId(rows));
    } else {
      expect(byId(now), store).toEqual(byId(rows));
    }
  }

  // The answers know their calls, estimated from the long gap between them.
  const answers = after.rows.answers as { id: string; callStartedAt: number }[];
  const first = answers.find((row) => row.id === 'a1')!;
  const second = answers.find((row) => row.id === 'a2')!;
  expect(first.callStartedAt).toBeLessThan(second.callStartedAt);
  expect(first.callStartedAt).toBe(10_000);
  // The session has its latest call's length: from u3's start to u4's end.
  const [session] = after.rows.sessions as { lastCallMs: number }[];
  expect(session!.lastCallMs).toBe(202_000);

  // Opening it again changes nothing.
  await reader.reload();
  await reader.waitForFunction(() => typeof window.readDatabase === 'function');
  expect(await reader.evaluate(() => window.readDatabase())).toEqual(after);
  await context.close();
});
