/**
 * File: scripts/test-all.ts
 * Purpose: Runs every free test suite and reports one line per suite, so "all tests pass" means every
 *          suite ran and passed (v1.1.0, item 25: two suites had been failing unnoticed, with most of
 *          their tests skipped by Playwright's serial mode). A suite fails when its command fails, or
 *          when it reports any test as skipped or "did not run".
 * Used by: the "test:all" script in package.json (developers, before a release)
 * Depends on: pnpm, node:child_process
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (Testing); CLAUDE.md "Testing rules"
 *
 * Prints suite names and counts only. A failing suite's full output goes to a file in the system's
 * temporary folder: nothing from a test run is echoed here.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** One suite to run. */
interface Suite {
  /** The name printed for it. */
  name: string;
  /** The pnpm arguments that run it. */
  args: readonly string[];
}

/** Every free suite (no paid request, no sign-in, no production). */
const SUITES: readonly Suite[] = [
  { name: 'lint', args: ['lint'] },
  { name: 'typecheck', args: ['typecheck'] },
  { name: 'unit: web', args: ['--filter', '@kite/web', 'test'] },
  { name: 'unit: desktop', args: ['--filter', '@kite/desktop', 'test:unit'] },
  { name: 'harness: speech', args: ['--filter', '@kite/web', 'test:stt'] },
  { name: 'harness: answers', args: ['--filter', '@kite/web', 'test:answers'] },
  { name: 'harness: screenshot', args: ['--filter', '@kite/web', 'test:screenshot'] },
  { name: 'harness: review', args: ['--filter', '@kite/web', 'test:review'] },
  { name: 'harness: live screens', args: ['--filter', '@kite/web', 'test:live-ui'] },
  { name: 'harness: UI kit', args: ['--filter', '@kite/web', 'test:ui-kit'] },
  { name: 'harness: app shell', args: ['--filter', '@kite/web', 'test:shell'] },
  { name: 'harness: setup', args: ['--filter', '@kite/web', 'test:setup'] },
  { name: 'harness: prepare', args: ['--filter', '@kite/web', 'test:prepare'] },
  { name: 'harness: ask kite', args: ['--filter', '@kite/web', 'test:ask-kite'] },
  { name: 'harness: simulated calls', args: ['--filter', '@kite/web', 'test:sim-calls'] },
  { name: 'harness: database upgrade', args: ['--filter', '@kite/web', 'test:db-upgrade'] },
  { name: 'harness: offline punctuation', args: ['--filter', '@kite/web', 'test:punctuation'] },
  { name: 'desktop smoke', args: ['--filter', '@kite/desktop', 'test'] },
];

/**
 * Whether a suite's output says some tests never ran. Vitest prints "3 skipped"; Playwright prints
 * "3 skipped" and "3 did not run".
 *
 * @param output The suite's output.
 * @returns The number not run, or 0.
 * Called from: the loop below
 */
function notRun(output: string): number {
  // Colour codes would split the numbers from their words.
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const counts = [...plain.matchAll(/(\d+) (?:skipped|did not run)\b/g)];
  return counts.reduce((total, match) => total + Number(match[1]), 0);
}

let failed = 0;
for (const suite of SUITES) {
  const started = Date.now();
  // CI=1: the speech suite then fails on missing model files instead of skipping. The editor's
  // ELECTRON_RUN_AS_NODE would start Electron as plain Node.js.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env;
  const run = spawnSync('pnpm', [...suite.args], {
    encoding: 'utf8',
    shell: true,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...env, CI: '1' },
  });
  const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
  const missing = notRun(output);
  const ok = run.status === 0 && missing === 0;
  const seconds = Math.round((Date.now() - started) / 1000);
  if (ok) {
    console.log(`PASS ${suite.name} (${seconds} s)`);
  } else {
    failed += 1;
    const file = path.join(tmpdir(), `kite-${suite.name.replace(/\W+/g, '-')}.log`);
    writeFileSync(file, output);
    const why = run.status === 0 ? `${missing} test(s) did not run` : `exit ${run.status}`;
    console.log(`FAIL ${suite.name} (${seconds} s): ${why}. Output: ${file}`);
  }
}
console.log(failed === 0 ? `All ${SUITES.length} suites passed.` : `${failed} suite(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
