/**
 * File: apps/web/scripts/lib/eval-options.ts
 * Purpose: Command-line options shared by the evaluations (eval-answers.ts, eval-notes.ts), so
 *          a change re-runs only the scenario groups it touches (CLAUDE.md "Evaluation cost"):
 *          --only=<group or scenario id>, --runs=N, --show, --dry-run and --without-lessons; and
 *          --style=previous (the ADR-0032 rollback prompt) and the estimated
 *          number of Claude requests, printed before anything is sent.
 *          Groups: 'answers' (the Day 4 scenarios 01–15, the baseline group), 'screenshots'
 *          (16–18, Day 5), 'lessons' (19–20, Day 5 Stage 7), 'preferences' (21–24, parity Phase 2 and v1.2.0), in eval-answers.ts; 'notes'
 *          (eval-notes.ts).
 * Used by: scripts/eval-answers.ts, scripts/eval-notes.ts (scripts/eval-all.ts passes these on to both)
 * Depends on: nothing
 * Architecture: docs/testing/answer-eval.md (groups and gates)
 */

/** The evaluation's options. */
export interface EvalOptions {
  /** Runs per scenario (scores are averaged). */
  runs: number;
  /** A group name or one scenario id, or null for every scenario of this evaluation. */
  only: string | null;
  /** Also print each answer or note and the grader's reason (local use only). */
  show: boolean;
  /** Print the estimate and stop (sends nothing; needs no key). */
  dryRun: boolean;
  /** Send no lessons (the lesson group's comparison run, Day 5 Stage 7). */
  withoutLessons: boolean;
  /** The answer style version to evaluate (ADR-0032 rollback switch); null means v-current. */
  style: 'previous' | null;
}

/**
 * Reads the options. Each value option takes `--name=value` or `--name value`.
 *
 * @param argv        process.argv.slice(2).
 * @param defaultRuns Runs when --runs is not given.
 * @returns The options.
 * @throws Error when --runs is not a whole number of at least 1, or --style is not 'current' or
 *         'previous'.
 * Called from: main() of eval-answers.ts and eval-notes.ts; tests
 */
export function parseEvalArgs(argv: readonly string[], defaultRuns: number): EvalOptions {
  const value = (name: string): string | null => {
    const joined = argv.find((arg) => arg.startsWith(`${name}=`));
    if (joined) return joined.slice(name.length + 1);
    const at = argv.indexOf(name);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  const runsText = value('--runs');
  const runs = runsText === null ? defaultRuns : Number(runsText);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a whole number ≥ 1');
  const style = value('--style') ?? 'current';
  if (style !== 'current' && style !== 'previous') {
    throw new Error("--style must be 'current' or 'previous'");
  }
  return {
    runs,
    only: value('--only'),
    show: argv.includes('--show'),
    dryRun: argv.includes('--dry-run'),
    withoutLessons: argv.includes('--without-lessons'),
    style: style === 'previous' ? 'previous' : null,
  };
}

/**
 * Picks the scenarios to run: a whole group when --only names one, else the scenario with that id.
 *
 * @param scenarios Every scenario of this evaluation, in order.
 * @param groupOf   The group a scenario belongs to.
 * @param only      --only's value, or null for all.
 * @returns The chosen scenarios.
 * @throws Error naming the groups when --only matches neither a group nor a scenario.
 * Called from: eval-answers.ts and eval-notes.ts (loadScenarios()); tests
 */
export function selectScenarios<T extends { id: string }>(
  scenarios: readonly T[],
  groupOf: (scenario: T) => string,
  only: string | null,
): T[] {
  if (!only) return [...scenarios];
  const inGroup = scenarios.filter((scenario) => groupOf(scenario) === only);
  if (inGroup.length > 0) return inGroup;
  const byId = scenarios.filter((scenario) => scenario.id === only);
  if (byId.length > 0) return byId;
  const groups = [...new Set(scenarios.map(groupOf))].join(', ');
  throw new Error(`--only=${only} is neither a group (${groups}) nor a scenario id`);
}

/** One kind of Claude request an evaluation sends for every scenario run. */
export interface RequestKind {
  /** What it is, for example 'answers' or 'grades'. */
  label: string;
  /** The model it uses. */
  model: string;
}

/**
 * The estimate printed before an evaluation sends anything: how many scenarios of each group,
 * how many runs, and how many Claude requests of each kind. The SDK may retry a failed request
 * once (server/claude.ts), so the real count can be higher only after errors.
 *
 * @param scenarios The chosen scenarios.
 * @param groupOf   The group a scenario belongs to.
 * @param runs      Runs per scenario.
 * @param perRun    The requests one scenario run sends.
 * @returns One line, for example "estimate: 3 scenarios (notes 3) × 3 runs = 18 Claude
 *          requests (9 notes by claude-sonnet-5-5, 9 grades by claude-sonnet-5-5)".
 * Called from: main() of eval-answers.ts and eval-notes.ts; tests
 */
export function estimateLine<T>(
  scenarios: readonly T[],
  groupOf: (scenario: T) => string,
  runs: number,
  perRun: readonly RequestKind[],
): string {
  const counts = new Map<string, number>();
  for (const scenario of scenarios) {
    const group = groupOf(scenario);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  const groups = [...counts].map(([group, count]) => `${group} ${count}`).join(', ');
  const each = scenarios.length * runs;
  const kinds = perRun.map((kind) => `${each} ${kind.label} by ${kind.model}`).join(', ');
  return `estimate: ${scenarios.length} scenarios (${groups}) × ${runs} runs = ${each * perRun.length} Claude requests (${kinds})`;
}
