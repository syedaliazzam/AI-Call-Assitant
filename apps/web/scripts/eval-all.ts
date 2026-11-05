/**
 * File: apps/web/scripts/eval-all.ts
 * Purpose: The full evaluation suite: eval:answers, then eval:notes, each with every option given
 *          here. Paid unless --dry-run is given (CLAUDE.md "Evaluation cost").
 *          Usage: pnpm --filter web eval:all [--runs=N] [--show] [--dry-run]
 *          --only goes to the single evaluations, whose groups differ.
 * Used by: the "eval:all" script in apps/web/package.json (run by a developer by hand)
 * Depends on: scripts/lib/eval-all.ts
 * Architecture: docs/testing/answer-eval.md (groups and gates)
 */
import { spawnSync } from 'node:child_process';
import { runEvalAll } from './lib/eval-all';

process.exitCode = runEvalAll(
  process.argv.slice(2),
  // A shell, because pnpm is a .cmd file on Windows. A process that could not start counts as failed.
  (command) => spawnSync(command, { shell: true, stdio: 'inherit' }).status ?? 1,
);
