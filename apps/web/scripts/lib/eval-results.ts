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

/** 19 Nov 2026: what the claimed-experience experiments did to one answer (scripts/eval-answers.ts). */
export interface ExperimentFlags {
  /** Option A: the "no CV project matches" line was in the prompt. */
  cvMatchLine: boolean;
  /** Option B: the smart model answered (an own-experience question). */
  smartModel: boolean;
}

/**
 * ADR-0112, --guard only: what the user would see for one reply, after the live route's pipeline
 * (server/answer-meta.ts, with the template stop) and the page's retry rule (core/answer/finishedReply.ts).
 */
export interface GuardCheck {
  /** The first reply opened with a copied template (the server stopped it). */
  firstTemplated: boolean;
  /** The first reply had no answer text (templated or empty). */
  firstEmpty: boolean;
  /** The page asked again once, silently (one more real request). */
  retried: boolean;
  /**
   * What reached the user: 'card' (an answer card), 'notice' (the card removed with "Didn't catch
   * that"), or 'dropped' (garbled or none: no card by design, before the guard).
   */
  outcome: 'card' | 'notice' | 'dropped';
  /** A card shown without a hidden line of its own (labelled with the default type, "Other"). */
  cardWithoutMeta: boolean;
  /** A card whose shown text still holds a template ("[[type|for|source]]"); must never happen. */
  templateVisible: boolean;
}

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
  /** The checks made in code on top of the score (ADR-0030), when this evaluation has them. */
  checks?: RunChecks;
}

/** The checks made in code on one answer (ADR-0030). */
export interface RunChecks {
  /** True when the reply opened with its hidden line (ADR-0103: a copied placeholder does not count). */
  hiddenLine: boolean;
  /**
   * ADR-0103: true when the reply contains the copied placeholder ("[[type|for|source]]"); absent in older
   * files. ADR-0112: any copied template line, first or last ("[[question|…]]").
   */
  placeholder?: boolean;
  /** v1.1.0: how many words the model's answer line has, for an answer that has one. */
  answerLineWords?: number;
  /** v1.1.0: how many words the line has on the card, after its cut at a clause. */
  shownLineWords?: number;
  /** Whether the question type was as expected (when the scenario expects one). */
  typeOk?: boolean;
  /** Whether "for the call" or "Ask Kite" was as expected (when the scenario expects one). */
  targetOk?: boolean;
  /** True when the spoken part comments on what Kite was given. */
  metaComment: boolean;
  /** What the grader found invented. */
  invented: string[];
  /** 19 Nov 2026, --compare-rubric only: what the rubric before that day found invented in the same answer. */
  inventedPrevious?: string[];
  /** 19 Nov 2026 experiments only: option A's line was in the prompt; option B used the smart model. */
  experiment?: ExperimentFlags;
  /** ADR-0112, --guard only: what the user would see after the guard. */
  guard?: GuardCheck;
  /** Numbers and prices the claim check could not find in the documents or the call. */
  unsupportedNumbers: string[];
  /** Dates and names the claim check could not find. */
  unsupportedNames: string[];
  /** What running the answer's code found, when it has code. */
  code?: RunCode;
  /** Whether the code ran (when the scenario requires code). */
  codeRuns?: boolean;
  /** A repeat against the first answer: the same numbers, and the share of words in common. */
  agreement?: RunAgreement;
  /** ADR-0107: the answer's depth, for the per-type depth table (absent in older files). */
  depth?: RunDepth;
  /** ADR-0107: true when a reply that should answer has no answer text (an empty card). */
  empty?: boolean;
}

/** ADR-0107: how full one answer is. */
export interface RunDepth {
  /** The question type from the hidden line ('none' when it had none). */
  type: string;
  /** Words outside code blocks. */
  words: number;
  /** Bullet lines. */
  bullets: number;
  /** The grader's "complete and useful" score, 0–2 (absent when not graded). */
  complete?: number;
}

/** What running an answer's code found. */
export interface RunCode {
  /** How many blocks the answer has. */
  blocks: number;
  /** How many ran without an error. */
  ran: number;
  /** How many failed. */
  failed: number;
  /** How many are in a language the sandbox does not run. */
  notRun: number;
  /** The first failure's last line. */
  error?: string;
}

/** A repeated answer against the first one. */
export interface RunAgreement {
  /** True when both state the same numbers. */
  numbers: boolean;
  /** The share of words in common (0 to 1). */
  words: number;
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
  /** The answer style version evaluated ('current' or 'previous', ADR-0032); answers only. */
  style?: 'current' | 'previous';
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
