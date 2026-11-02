/**
 * File: apps/web/scripts/lib/eval-results.ts
 * Purpose: Saves every evaluation run's per-scenario scores and grader reasons to a git-ignored
 *          JSON file (apps/web/eval-results/), so a score drop can be diagnosed without paying for
 *          another run. Answers and notes themselves are not saved: the file holds numbers and the
 *          grader's one-sentence reasons only.
 * Used by: scripts/eval-answers.ts, scripts/eval-notes.ts
 * Depends on: node:fs, node:path
 * Architecture: docs/testing/answer-eval.md (results and how to read them)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** One graded run of one scenario. */
export interface ScenarioRunResult {
  /** The run's number, from 1. */
  run: number;
  /** Points per rubric item, for example { facts: 3, grounded: 2 }. */
  scores: Record<string, number>;
  /** The run's total out of 10. */
  total: number;
  /** The grader's sentence on what cost points ("none" when nothing did). */
  reason: string;
}

/** All runs of one scenario. */
export interface ScenarioResult {
  /** The scenario's id (its file name without .json). */
  id: string;
  /** The mean total over its runs. */
  mean: number;
  /** Each run, in order. */
  runs: ScenarioRunResult[];
}

/** One saved evaluation. */
export interface EvalResultsFile {
  /** Which evaluation ran: 'answers' or 'notes'. */
  evaluation: string;
  /** The --only value, or null for every scenario. */
  only: string | null;
  /** Whether lessons were withheld (the lesson group's comparison run). */
  withoutLessons: boolean;
  /** When the run finished (ISO 8601). */
  finishedAt: string;
  /** The model that wrote the answers or notes. */
  model: string;
  /** The model that graded them. */
  grader: string;
  /** The mean of the scenario means. */
  overall: number;
  /** Each scenario, in the order it ran. */
  scenarios: ScenarioResult[];
}

/** Where the results go, relative to apps/web. Git-ignored (root .gitignore). */
export const EVAL_RESULTS_DIR = 'eval-results';

/**
 * The file name for one run, sortable by time. Colons are not allowed in Windows file names, so
 * the time's punctuation is replaced.
 *
 * @param results The results to be saved.
 * @returns For example "answers-screenshots-2026-11-02T10-15-30Z.json".
 * Called from: saveEvalResults(); tests
 */
export function evalResultsName(results: EvalResultsFile): string {
  const time = results.finishedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
  // A scenario id or group comes from the command line, so anything but a plain name is replaced.
  const only = (results.only ?? 'all').replace(/[^\w-]/g, '_');
  const lessons = results.withoutLessons ? '-without-lessons' : '';
  return `${results.evaluation}-${only}${lessons}-${time}.json`;
}

/**
 * Writes one run's results and returns where they went.
 *
 * @param results The results.
 * @param root    The folder holding EVAL_RESULTS_DIR (apps/web, the scripts' working directory).
 * @returns The path written, relative to root.
 * Called from: main() of eval-answers.ts and eval-notes.ts; tests
 */
export function saveEvalResults(results: EvalResultsFile, root: string = process.cwd()): string {
  mkdirSync(path.join(root, EVAL_RESULTS_DIR), { recursive: true });
  const relative = path.join(EVAL_RESULTS_DIR, evalResultsName(results));
  writeFileSync(path.join(root, relative), `${JSON.stringify(results, null, 2)}\n`);
  return relative;
}
