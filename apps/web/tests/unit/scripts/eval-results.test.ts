/**
 * Tests: apps/web/scripts/lib/eval-results.ts. A run's scores and reasons reach a file with a safe,
 * sortable name, and nothing but the fields it was given.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVAL_RESULTS_DIR,
  evalResultsName,
  saveEvalResults,
  type EvalResultsFile,
} from '../../../scripts/lib/eval-results';

/** A small invented run. */
const RESULTS: EvalResultsFile = {
  evaluation: 'answers',
  only: 'screenshots',
  withoutLessons: false,
  finishedAt: '2026-11-02T10:15:30.123Z',
  model: 'fast',
  grader: 'smart',
  overall: 8.5,
  scenarios: [
    {
      id: '16-example',
      mean: 8.5,
      runs: [{ run: 1, scores: { facts: 2 }, total: 8.5, reason: 'missed one fact' }],
    },
  ],
};

describe('evalResultsName', () => {
  it('has no characters Windows refuses, and sorts by time', () => {
    expect(evalResultsName(RESULTS)).toBe('answers-screenshots-2026-11-02T10-15-30Z.json');
  });

  it('says when every scenario ran, and when lessons were withheld', () => {
    expect(evalResultsName({ ...RESULTS, only: null })).toContain('answers-all-');
    expect(evalResultsName({ ...RESULTS, withoutLessons: true })).toContain('-without-lessons-');
  });

  it('cannot leave the results folder, whatever --only says', () => {
    expect(evalResultsName({ ...RESULTS, only: '../../x' })).not.toMatch(/[/\\]/);
  });
});

describe('saveEvalResults', () => {
  let root = '';

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = '';
  });

  it('writes the scores and reasons, creating the folder', () => {
    root = mkdtempSync(path.join(tmpdir(), 'kite-eval-'));
    const written = saveEvalResults(RESULTS, root);
    expect(written.startsWith(EVAL_RESULTS_DIR)).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(root, written), 'utf8')) as EvalResultsFile;
    expect(saved).toEqual(RESULTS);
  });
});
