/**
 * File: apps/web/scripts/eval-notes.ts
 * Purpose: Developer-only evaluation of the call notes (day-05-overlay-screenshots-notes.md
 *          Stage 5). Runs each invented scenario in tests/eval/notes/ through the real server
 *          code (server/notes.ts, smart model), then grades the notes with the smart model
 *          against the rubric in docs/testing/answer-eval.md ("Notes evaluation"): faithful
 *          (nothing invented), coverage, unclear parts said instead of guessed, lessons grounded
 *          in the user's ratings and notes, and the size limits (checked in code). Prints a score
 *          table only (--show also prints the notes and the grader's reason, locally).
 *          Usage: pnpm --filter web eval:notes [--runs N] [--only <id>] [--show]
 * Used by: the "eval:notes" script in apps/web/package.json (by hand; never in CI)
 * Depends on: src/server/notes.ts (generateCallNotes), src/server/claude.ts (jsonReply),
 *             src/server/prompt.ts (sessionBlock), src/server/env.ts, @kite/shared
 * Architecture: docs/testing/answer-eval.md; day-05-overlay-screenshots-notes.md Stage 5
 *
 * Runs like eval-answers.ts (tsx, `--env-file=.env.local`, `--conditions=react-server`).
 * Scenario files (JSON): id; covers; request (a NotesRequest); mustInclude; mustNotInclude.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_PROPOSED_LESSONS,
  MAX_SUMMARY_BULLETS,
  type CallNotes,
  type NotesRequest,
} from '@kite/shared';
import { jsonReply } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { generateCallNotes } from '@/server/notes';
import { sessionBlock } from '@/server/prompt';

/** tests/eval/notes. */
const SCENARIO_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'eval',
  'notes',
);

/** One notes scenario. */
interface NotesScenario {
  /** Its id (the file name without .json). */
  id: string;
  /** What it tests. */
  covers: string;
  /** The call. */
  request: NotesRequest;
  /** What good notes must contain. */
  mustInclude: string[];
  /** What they must not contain. */
  mustNotInclude: string[];
}

/** The grader's scores (the rubric). */
interface NotesGrade {
  /** Nothing invented: 0–4. */
  faithful: number;
  /** The must-include points: 0–3. */
  coverage: number;
  /** Unclear parts listed instead of guessed (2 when nothing was unclear and nothing guessed): 0–1. */
  unclear: number;
  /** Lessons grounded in the user's ratings and notes (or none when there is nothing to learn): 0–1. */
  lessons: number;
  /** One sentence on what cost points. */
  reason: string;
}

/** The grader's output schema. */
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    faithful: { type: 'integer', enum: [0, 1, 2, 3, 4] },
    coverage: { type: 'integer', enum: [0, 1, 2, 3] },
    unclear: { type: 'integer', enum: [0, 1] },
    lessons: { type: 'integer', enum: [0, 1] },
    reason: { type: 'string' },
  },
  required: ['faithful', 'coverage', 'unclear', 'lessons', 'reason'],
  additionalProperties: false,
};

/** The grader's rubric (the same as docs/testing/answer-eval.md "Notes evaluation"). */
const GRADER_SYSTEM = `You grade the notes Kite wrote after a call. Grade strictly against the rubric, using only the call transcript, Kite's answers with the user's ratings and notes, and the session details given.

Rubric:
- faithful (0-4): 4 = every statement, name, number, date, next step and owner is supported by the call or the session; 3 = one small unsupported detail; 2 = a few; 1 = an invented fact that matters (a number, a commitment, a next step); 0 = several. Anything from "must not include" costs at least 2 points.
- coverage (0-3): how many of the "must include" points the notes contain: 3 = all, 2 = most, 1 = some, 0 = none.
- unclear (0-1): 1 = parts of the transcript that are garbled or do not make sense are listed as unclear (with a time range) and not summarised as if understood; also 1 when nothing in the call was unclear and nothing is listed or guessed. 0 = a garbled part is summarised as if understood, or invented.
- lessons (0-1): 1 = every proposed lesson follows from a rating or note the user gave (a thumbs down, or a note saying what was wrong), or there are no lessons when the ratings and notes show nothing to learn; 0 = a lesson that the user's feedback does not support.
- reason: one short sentence on what cost points ("none" when nothing did).`;

/**
 * Reads the scenarios.
 *
 * @param only One id, or null for all.
 * @returns The scenarios.
 * @throws Error when --only names none.
 * Called from: main()
 */
function loadScenarios(only: string | null): NotesScenario[] {
  const scenarios = readdirSync(SCENARIO_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map(
      (name) => JSON.parse(readFileSync(path.join(SCENARIO_DIR, name), 'utf8')) as NotesScenario,
    );
  const chosen = only ? scenarios.filter((scenario) => scenario.id === only) : scenarios;
  if (chosen.length === 0) throw new Error(`no scenario "${only}"`);
  return chosen;
}

/**
 * The size check made in code: summary and lessons within their limits.
 *
 * @param notes The notes.
 * @returns 1 or 0.
 * Called from: main()
 */
function formatCheck(notes: CallNotes): number {
  return notes.summary.length >= 1 &&
    notes.summary.length <= MAX_SUMMARY_BULLETS &&
    notes.lessons.length <= MAX_PROPOSED_LESSONS
    ? 1
    : 0;
}

/**
 * Grades one set of notes.
 *
 * @param scenario The scenario.
 * @param notes    The notes.
 * @param model    The grader model.
 * @returns The grade.
 * Called from: main()
 */
async function grade(
  scenario: NotesScenario,
  notes: CallNotes,
  model: string,
): Promise<NotesGrade> {
  const { request } = scenario;
  const prompt = [
    'Session details and documents:',
    sessionBlock(request.session),
    '',
    'Transcript (seconds since the call started):',
    ...request.lines.map(
      (line) => `[${line.at}] ${line.speaker === 'you' ? 'You' : 'Them'}: ${line.text}`,
    ),
    '',
    "Kite's answers, with the user's rating and note:",
    JSON.stringify(request.answers, null, 1),
    '',
    'Must include:',
    ...scenario.mustInclude.map((item) => `- ${item}`),
    'Must not include:',
    ...scenario.mustNotInclude.map((item) => `- ${item}`),
    '',
    'The notes to grade:',
    JSON.stringify(notes, null, 1),
  ].join('\n');
  const { value } = await jsonReply({
    model,
    tier: 'smart',
    system: GRADER_SYSTEM,
    prompt,
    schema: GRADE_SCHEMA,
    maxTokens: 400,
  });
  return value as NotesGrade;
}

/**
 * Reads the command-line options.
 *
 * @param argv process.argv.slice(2).
 * @returns runs, only and show.
 * Called from: main()
 */
function parseArgs(argv: string[]): { runs: number; only: string | null; show: boolean } {
  const value = (name: string) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : (argv[at + 1] ?? null);
  };
  return {
    runs: Math.max(1, Number(value('--runs') ?? 3)),
    only: value('--only'),
    show: argv.includes('--show'),
  };
}

/**
 * Runs the evaluation and prints the score table.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = getClaudeEnv();
  const scenarios = loadScenarios(options.only);
  console.log(
    `eval-notes: notes and grades by ${env.modelSmart}; ${scenarios.length} scenarios × ${options.runs} runs`,
  );
  const rows: string[] = [];
  let sum = 0;
  for (const scenario of scenarios) {
    const totals = { faithful: 0, coverage: 0, unclear: 0, lessons: 0, format: 0 };
    for (let run = 1; run <= options.runs; run += 1) {
      const { notes } = await generateCallNotes(scenario.request, env.modelSmart);
      const graded = await grade(scenario, notes, env.modelSmart);
      totals.faithful += graded.faithful;
      totals.coverage += graded.coverage;
      totals.unclear += graded.unclear;
      totals.lessons += graded.lessons;
      totals.format += formatCheck(notes);
      if (options.show) {
        console.log(
          `\n--- ${scenario.id} run ${run} ---\n${JSON.stringify(notes, null, 1)}\n(grader: ${graded.reason})`,
        );
      }
    }
    const average = (n: number) => n / options.runs;
    const total = Object.values(totals).reduce((a, b) => a + average(b), 0);
    sum += total;
    const cell = (n: number) => average(n).toFixed(1);
    rows.push(
      `| ${scenario.id} | ${cell(totals.faithful)} | ${cell(totals.coverage)} | ${cell(totals.unclear)} | ${cell(totals.lessons)} | ${cell(totals.format)} | ${total.toFixed(1)} |`,
    );
  }
  console.log(
    `\n| Scenario | Faithful /4 | Coverage /3 | Unclear /1 | Lessons /1 | Format /1 | Total /10 |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}`,
  );
  console.log(
    `\nOverall: ${(sum / scenarios.length).toFixed(2)} / 10 (mean of ${scenarios.length} scenarios)`,
  );
}

main().catch((error: unknown) => {
  const status = (error as { status?: number }).status;
  console.error(
    `eval-notes: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
