/**
 * Tests: apps/web/scripts/lib/eval-results.ts. A run's scores and reasons reach a file with a safe,
 * sortable name, and nothing but the fields it was given. The --guard retry line compares runs graded on the
 * retry with their discarded first reply.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EVAL_RESULTS_DIR,
  evalResultsName,
  saveEvalResults,
  summariseRetryGrading,
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

describe('summariseRetryGrading (--guard, graded on the retry)', () => {
  /**
   * One invented scenario with the given runs.
   *
   * @param runs Each run's total, and the discarded first reply's total when it was asked again.
   * @returns The scenario's result.
   */
  const scenario = (runs: { total: number; discardedFirstTotal?: number }[]) => ({
    id: 'x',
    mean: 0,
    runs: runs.map((run, index) => ({ run: index + 1, scores: {}, reason: 'none', ...run })),
  });

  it('is null when no run was asked again', () => {
    expect(summariseRetryGrading([scenario([{ total: 9 }, { total: 8 }])])).toBeNull();
  });

  it('counts only retried runs and compares the retry with the discarded first reply', () => {
    const line = summariseRetryGrading([
      scenario([{ total: 9, discardedFirstTotal: 5 }, { total: 10 }]),
      scenario([{ total: 8, discardedFirstTotal: 6 }]),
    ]);
    expect(line).toBe(
      'Guard: runs graded on the retry: 2; mean 8.50 (the discarded first reply: 5.50)',
    );
  });
});
