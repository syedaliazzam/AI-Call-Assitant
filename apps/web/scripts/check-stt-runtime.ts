/**
 * File: apps/web/scripts/check-stt-runtime.ts
 * Purpose: Fails the build when the speech-to-text runtime files (streaming v1.13.7, second
 *          pass v1.13.2, Silero VAD) are missing or do not match their pinned SHA-256, so a
 *          deploy can never ship without working, verified runtimes.
 *          Runs after `fetch-models --runtime-only` and before `next build`.
 *          Usage: pnpm --filter web exec tsx scripts/check-stt-runtime.ts (part of `pnpm build`)
 * Used by: the "build" script in apps/web/package.json (locally and on Vercel)
 * Depends on: scripts/fetch-models.ts (paths and checksum helpers), src/core/stt/models.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10 (hosting); ADR-0020
 */
import path from 'node:path';
import { RUNTIME_FILES, SECOND_PASS_RUNTIME_FILES, SILERO_VAD } from '../src/core/stt/models';
import { isInstalled, RUNTIME_DIR, SECOND_PASS_RUNTIME_DIR } from './fetch-models';

/**
 * Checks each runtime file and exits non-zero if any is missing or wrong.
 */
async function main(): Promise<void> {
  const problems: string[] = [];
  const expected = [
    ...Object.values(RUNTIME_FILES).map((file) => ({ dir: RUNTIME_DIR, file })),
    ...[...Object.values(SECOND_PASS_RUNTIME_FILES), SILERO_VAD].map((file) => ({
      dir: SECOND_PASS_RUNTIME_DIR,
      file,
    })),
  ];
  for (const { dir, file } of expected) {
    if (!(await isInstalled(path.join(dir, file.name), file))) problems.push(file.name);
  }
  if (problems.length > 0) {
    console.error(
      `Speech-to-text runtime missing or wrong in public/stt-runtime: ${problems.join(', ')}.\n` +
        'Run: pnpm --filter web fetch-models --runtime-only',
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Speech-to-text runtimes: ${expected.length}/${expected.length} files present and verified`,
  );
}

void main();
