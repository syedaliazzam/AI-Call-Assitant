/**
 * Tests for apps/web/scripts/lib/eval-options.ts and answerGroup() in scripts/eval-answers.ts:
 * options take --name=value or --name value, with --show and --dry-run as flags and a bad
 * --runs refused; --only picks a whole group, else one scenario id, and names the groups when
 * it matches neither; the estimate counts scenarios per group and Claude requests per kind;
 * screenshot scenarios are the 'screenshots' group and the rest 'answers'.
 */
import { describe, expect, it } from 'vitest';
import { answerGroup } from '../../../scripts/eval-answers';
import { estimateLine, parseEvalArgs, selectScenarios } from '../../../scripts/lib/eval-options';

/** Invented scenarios in two groups. */
const SCENARIOS = [
  { id: '01-a', group: 'answers' },
  { id: '02-b', group: 'answers' },
  { id: '16-s', group: 'screenshots' },
];

/**
 * The group of an invented scenario.
 *
 * @param scenario The scenario.
 * @returns Its group.
 */
const groupOf = (scenario: (typeof SCENARIOS)[number]) => scenario.group;

describe('parseEvalArgs', () => {
  it('reads both option forms and the flags', () => {
    expect(parseEvalArgs(['--only=screenshots', '--runs=3', '--dry-run'], 2)).toEqual({
      runs: 3,
      only: 'screenshots',
      show: false,
      dryRun: true,
    });
    expect(parseEvalArgs(['--only', '01-a', '--runs', '1', '--show'], 2)).toEqual({
      runs: 1,
      only: '01-a',
      show: true,
      dryRun: false,
    });
    expect(parseEvalArgs([], 3)).toEqual({ runs: 3, only: null, show: false, dryRun: false });
  });

  it('refuses a --runs that is not a whole number of at least 1', () => {
    for (const runs of ['0', '-1', '1.5', 'two']) {
      expect(() => parseEvalArgs([`--runs=${runs}`], 2)).toThrow('--runs');
    }
  });
});

describe('selectScenarios', () => {
  it('picks a group, else one id, else all', () => {
    expect(selectScenarios(SCENARIOS, groupOf, 'screenshots').map((s) => s.id)).toEqual(['16-s']);
    expect(selectScenarios(SCENARIOS, groupOf, '02-b').map((s) => s.id)).toEqual(['02-b']);
    expect(selectScenarios(SCENARIOS, groupOf, null)).toHaveLength(3);
  });

  it('names the groups when --only matches nothing', () => {
    expect(() => selectScenarios(SCENARIOS, groupOf, 'nope')).toThrow(
      '--only=nope is neither a group (answers, screenshots) nor a scenario id',
    );
  });
});

describe('estimateLine', () => {
  it('counts scenarios per group and requests per kind', () => {
    expect(
      estimateLine(SCENARIOS, groupOf, 2, [
        { label: 'answers', model: 'fast-model' },
        { label: 'grades', model: 'smart-model' },
      ]),
    ).toBe(
      'estimate: 3 scenarios (answers 2, screenshots 1) × 2 runs = 12 Claude requests (6 answers by fast-model, 6 grades by smart-model)',
    );
  });
});

describe('answerGroup', () => {
  it('puts screenshot scenarios in their own group', () => {
    expect(answerGroup({ mode: 'screenshot' })).toBe('screenshots');
    expect(answerGroup({ mode: 'answer' })).toBe('answers');
    expect(answerGroup({ mode: 'chat' })).toBe('answers');
  });
});
