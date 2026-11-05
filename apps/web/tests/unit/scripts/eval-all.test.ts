/**
 * Tests apps/web/scripts/lib/eval-all.ts and the real "pnpm run eval:all --dry-run": every option
 * reaches every evaluation, the first failure stops the rest, and a dry run sends no request at all.
 * The real commands talk to a counting server on this computer with an invented key, which takes
 * priority over any key in .env.local, so these tests cannot reach Claude or spend anything. A
 * control run without --dry-run shows the counter does see requests.
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVAL_SCRIPTS, evalCommand, runEvalAll } from '../../../scripts/lib/eval-all';

/** apps/web, where the package.json scripts run. */
const WEB_DIR = path.resolve(__dirname, '../../..');

/** How long a real command may take, in ms: each evaluation loads its scenarios first. */
const COMMAND_LIMIT_MS = 120_000;

describe('runEvalAll', () => {
  it('gives every evaluation every option', () => {
    const run = vi.fn<(command: string) => number>(() => 0);
    expect(runEvalAll(['--dry-run', '--runs=1'], run)).toBe(0);
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      'pnpm run eval:answers --dry-run --runs=1',
      'pnpm run eval:notes --dry-run --runs=1',
    ]);
  });

  it('runs every evaluation in the package', () => {
    expect(EVAL_SCRIPTS.map((script) => evalCommand(script, []))).toEqual([
      'pnpm run eval:answers',
      'pnpm run eval:notes',
    ]);
  });

  it('stops at the first failure and returns its code', () => {
    const run = vi.fn<(command: string) => number>(() => 3);
    expect(runEvalAll(['--dry-run'], run)).toBe(3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs nothing when an option could mean something to a shell', () => {
    const run = vi.fn<(command: string) => number>(() => 0);
    expect(() => runEvalAll(['--dry-run', '&&', 'other'], run)).toThrow();
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the real commands against a counting server', () => {
  let server: Server;
  let requests = 0;

  beforeAll(async () => {
    // Answers every request as refused, so a run that does send stops at its first request.
    server = createServer((request, response) => {
      requests += 1;
      request.resume();
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error' } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = 0;
  });

  /**
   * Runs a package.json script on the counting server.
   *
   * @param command The command line.
   * @returns Its exit code and what it printed.
   */
  function runCommand(command: string): Promise<{ code: number | null; output: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: WEB_DIR,
        shell: true,
        env: {
          ...process.env,
          // The environment wins over --env-file, so a real key in .env.local is never used.
          ANTHROPIC_API_KEY: 'invented-key-for-tests',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
          KITE_MODEL_FAST: 'invented-fast-model',
          KITE_MODEL_SMART: 'invented-smart-model',
        },
      });
      let output = '';
      child.stdout.on('data', (piece: Buffer) => (output += piece.toString()));
      child.stderr.on('data', (piece: Buffer) => (output += piece.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    });
  }

  it(
    'eval:all --dry-run estimates both evaluations and sends nothing',
    async () => {
      const { code, output } = await runCommand('pnpm run eval:all --dry-run');
      expect(code).toBe(0);
      // One estimate from each evaluation shows both really started, and both stopped there.
      expect(output.match(/= \d+ Claude requests/g)).toHaveLength(EVAL_SCRIPTS.length);
      expect(requests).toBe(0);
    },
    COMMAND_LIMIT_MS,
  );

  it(
    'without --dry-run a request does reach the counter (the control)',
    async () => {
      const { code } = await runCommand('pnpm run eval:notes --runs=1');
      expect(code).not.toBe(0);
      expect(requests).toBeGreaterThan(0);
    },
    COMMAND_LIMIT_MS,
  );
});
