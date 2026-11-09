/**
 * File: apps/web/scripts/check-stt-runtime.ts
 * Purpose: Fails the build when the speech-to-text runtime files or the punctuation files (v1.1.0) are
 *          missing or do not match their pinned SHA-256, so a deploy can never ship without a
 *          working, verified runtime.
 *          Runs after `fetch-models --runtime-only` and before `next build`.
 *          Usage: pnpm --filter web exec tsx scripts/check-stt-runtime.ts (part of `pnpm build`)
 * Used by: the "build" script in apps/web/package.json (locally and on Vercel)
 * Depends on: scripts/fetch-models.ts (paths and checksum helpers), src/core/stt/models.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10 (hosting); ADR-0020
 */
import path from 'node:path';
import { RUNTIME_FILES } from '../src/core/stt/models';
import { PUNCT_MODEL_FILES, PUNCT_RUNTIME_FILES } from '../src/core/punctuation/model';
import { TURN_MODEL_FILE } from '../src/core/turn/model';
import { isInstalled, PUNCT_DIR, PUNCT_RUNTIME_DIR, RUNTIME_DIR, TURN_DIR } from './fetch-models';

/**
 * Checks each runtime file and exits non-zero if any is missing or wrong.
 */
async function main(): Promise<void> {
  const problems: string[] = [];
  for (const file of Object.values(RUNTIME_FILES)) {
    if (!(await isInstalled(path.join(RUNTIME_DIR, file.name), file))) problems.push(file.name);
  }
  for (const file of Object.values(PUNCT_RUNTIME_FILES)) {
    if (!(await isInstalled(path.join(PUNCT_RUNTIME_DIR, file.name), file))) {
      problems.push(file.name);
    }
  }
  for (const file of Object.values(PUNCT_MODEL_FILES)) {
    if (!(await isInstalled(path.join(PUNCT_DIR, file.name), file))) problems.push(file.name);
  }
  // v1.4 (ADR-0065): the end-of-turn model.
  if (!(await isInstalled(path.join(TURN_DIR, TURN_MODEL_FILE.name), TURN_MODEL_FILE))) {
    problems.push(TURN_MODEL_FILE.name);
  }
  if (problems.length > 0) {
    console.error(
      `Runtime files missing or wrong in public/stt-runtime, public/punct or public/turn: ${problems.join(', ')}.\n` +
        'Run: pnpm --filter web fetch-models --runtime-only',
    );
    process.exitCode = 1;
    return;
  }
  console.log('Speech-to-text runtime and punctuation files: present and verified');
}

void main();
