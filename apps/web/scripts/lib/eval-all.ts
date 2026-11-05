/**
 * File: apps/web/scripts/lib/eval-all.ts
 * Purpose: Runs every evaluation in turn with the same options. Chaining them in package.json with
 *          "&&" gave the options to the last one only, so "eval:all --dry-run" really ran
 *          eval:answers and spent money (v1.2.0 release, 5 Nov 2026). Here each one gets them all.
 * Used by: scripts/eval-all.ts; tests
 * Depends on: nothing
 * Architecture: docs/testing/answer-eval.md (groups and gates); CLAUDE.md "Evaluation cost"
 */

/** The package.json scripts eval:all runs, in order. */
export const EVAL_SCRIPTS: readonly string[] = ['eval:answers', 'eval:notes'];

/** What an option may contain: these go through a shell, and none of them needs more. */
const SAFE_OPTION = /^[\w=.:-]+$/;

/**
 * The command line for one evaluation.
 *
 * @param script The package.json script.
 * @param argv   The options given to eval:all.
 * @returns The command to run.
 * Called from: runEvalAll(); tests
 */
export function evalCommand(script: string, argv: readonly string[]): string {
  return ['pnpm', 'run', script, ...argv].join(' ');
}

/**
 * Runs every evaluation with the same options, stopping at the first that fails.
 *
 * @param argv The options given to eval:all.
 * @param run  Runs one command line and returns its exit code.
 * @returns The exit code: 0, or the first failure's.
 * @throws Error when an option has characters a shell could act on; nothing has run by then.
 * Called from: scripts/eval-all.ts; tests
 */
export function runEvalAll(argv: readonly string[], run: (command: string) => number): number {
  const unsafe = argv.find((option) => !SAFE_OPTION.test(option));
  if (unsafe !== undefined) throw new Error('eval:all: an option has characters it cannot pass on');
  for (const script of EVAL_SCRIPTS) {
    const code = run(evalCommand(script, argv));
    if (code !== 0) return code;
  }
  return 0;
}
