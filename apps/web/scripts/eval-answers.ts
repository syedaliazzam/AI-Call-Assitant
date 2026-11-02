/**
 * File: apps/web/scripts/eval-answers.ts
 * Purpose: Developer-only answer-quality evaluation (day-04-answers.md Stage 9). Runs every
 *          invented scenario in tests/eval/scenarios/ through the real server prompt
 *          (buildPrompt) with the fast model (Haiku), then grades each answer with the smart
 *          model (Sonnet) against the rubric in docs/testing/answer-eval.md, plus two checks
 *          made in code (headline length, number of bullets). Prints a score table only.
 *          Usage: pnpm --filter web eval:answers [--only=<group|id>] [--runs=N] [--show] [--dry-run]
 *            --only=answers      the Day 4 group (scenarios 01–15; the baseline group)
 *            --only=screenshots  the Day 5 screenshot group (16–18)
 *            --only=lessons      the Day 5 lesson group (19–20: answers with approved lessons)
 *            --without-lessons   send no lessons (the lesson group's comparison run)
 *            --only=<id>         one scenario (its file name without .json)
 *            --runs=N   answers per scenario (default 2; scores are averaged, because answers
 *                       vary from run to run)
 *            --show     also print each answer and the grader's reason (local use only; the
 *                       scenarios are invented, but answers are never printed by default)
 *            --dry-run  print the estimated number of Claude requests and stop
 *          Every paid run also saves per-scenario scores and grader reasons to a git-ignored
 *          file (scripts/lib/eval-results.ts), so a drop can be diagnosed without another run.
 *          Re-run only the groups a change touches; the full suite once, at release
 *          (CLAUDE.md "Evaluation cost"). The estimate is printed before anything is sent.
 * Used by: the "eval:answers" script in apps/web/package.json (run by a developer by hand;
 *          never in CI: it calls the real API and needs the real key)
 * Depends on: src/server/prompt.ts (buildPrompt, sessionBlock, SYSTEM_RULES),
 *             src/server/claude.ts (streamReply, jsonReply), src/server/env.ts, @kite/shared,
 *             scripts/lib/eval-options.ts (options, groups, estimate),
 *             scripts/lib/eval-results.ts (the saved results)
 * Key: refuses to run without ANTHROPIC_API_KEY (scripts/lib/require-key.ts). A paid run: agree
 *      it, with its estimated cost, with the developer first (CLAUDE.md "Claude key and spend").
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11 (testing); ADR-0025;
 *               docs/testing/answer-eval.md (rubric and results)
 *
 * Runs like verify-warm.ts: tsx with `--env-file=.env.local` and `--conditions=react-server`.
 *
 * Scenario files (JSON, so they hold no comments) have: id; covers (what it tests); session
 * (and, for screenshot scenarios, image and imageDescription: Day 5);
 * (SessionContext); conversation (ConversationChunk[]) and tail (CallLine[]); mode ('answer'
 * or 'chat'); question; mustInclude and mustNotInclude (what a good answer must and must not
 * contain, in plain words for the grader).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCREENSHOT_QUESTION,
  type AnswerRequest,
  type CallLine,
  type ConversationChunk,
  type SessionContext,
} from '@kite/shared';
import { jsonReply, streamReply } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt, sessionBlock } from '@/server/prompt';
import { requireKey } from './lib/require-key';
import { estimateLine, parseEvalArgs, selectScenarios } from './lib/eval-options';
import { saveEvalResults, type ScenarioResult, type ScenarioRunResult } from './lib/eval-results';

/** tests/eval/scenarios. */
const SCENARIO_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'eval',
  'scenarios',
);

/** One scenario file. */
interface Scenario {
  /** Its id (the file name without .json). */
  id: string;
  /** What it tests. */
  covers: string;
  /** The session details. */
  session: SessionContext;
  /** The call so far. */
  conversation: ConversationChunk[];
  /** Lines not yet stable. */
  tail: CallLine[];
  /** 'answer', 'chat' or 'screenshot' (Day 5). */
  mode: 'answer' | 'chat' | 'screenshot';
  /** Screenshot scenarios: the invented image, relative to tests/eval (for example images/x.jpg). */
  image?: string;
  /**
   * Screenshot scenarios: what the image shows, in words, for the grader (the grader reads text
   * only, so it can judge what is on screen without being sent the image).
   */
  imageDescription?: string;
  /**
   * Lesson scenarios (Day 5 Stage 7): the approved lessons sent with the answer, exactly as
   * the app sends them (the rules block's learned preferences).
   */
  lessons?: string[];
  /** The question. */
  question: string;
  /** What a good answer must contain. */
  mustInclude: string[];
  /** What it must not contain. */
  mustNotInclude: string[];
}

/** The grader's scores for one answer (the rubric in docs/testing/answer-eval.md). */
interface Grade {
  /** Required facts present: 0–3. */
  facts: number;
  /** Nothing invented, nothing from mustNotInclude: 0–2. */
  grounded: number;
  /** Consistent with earlier answers (and updates them correctly): 0–2. */
  consistent: number;
  /** Follows the session's format, length, tone and instructions: 0–1. */
  style: number;
  /** One sentence on what cost points (printed only with --show). */
  reason: string;
}

/** The structured-output schema the grader must follow. */
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'integer', enum: [0, 1, 2, 3] },
    grounded: { type: 'integer', enum: [0, 1, 2] },
    consistent: { type: 'integer', enum: [0, 1, 2] },
    style: { type: 'integer', enum: [0, 1] },
    reason: { type: 'string' },
  },
  required: ['facts', 'grounded', 'consistent', 'style', 'reason'],
  additionalProperties: false,
};

/** The grader's instructions: the rubric (the same as docs/testing/answer-eval.md). */
const GRADER_SYSTEM = `You grade answers written by Kite, a live call assistant. Kite reads the session details, documents and the call so far, and writes a short answer the user can say to the other person. Grade strictly against the rubric. Score only what is written in the answer.

Rubric:
- facts (0-3): how many of the "must include" points the answer contains, correctly. 3 = all, 2 = most, 1 = some, 0 = none or wrong.
- grounded (0-2): 2 = every claim about the user, their company, offer, prices, dates or commitments comes from the session details, documents or the call, and nothing from "must not include" appears; 1 = one small unsupported detail; 0 = an invented fact, a wrong number, or a "must not include" item.
- consistent (0-2): if the call shows earlier Kite answers, 2 = consistent with them, or, when new information changes the answer, it gives the new answer and says briefly what changed; 1 = partly; 0 = contradicts them without saying why, or ignores new information. If there are no earlier answers, give 2.
- style (0-1): 1 = follows the session's answer format (headline+bullets: a headline line then short bullets, optionally followed by one closing line starting "Tip:" and one line starting "Note:" that is private to the user, both allowed only when they add something and do not repeat a bullet; paragraph: one short paragraph, no bullets), length, tone and instructions, with no greeting or preamble; 0 = it does not.
- reason: one short sentence on what cost points ("none" when nothing did).`;

/**
 * The group a scenario belongs to: 'lessons' for scenarios with approved lessons (Day 5
 * Stage 7), 'screenshots' for the screenshot scenarios (Day 5), else 'answers' (the Day 4
 * baseline group). Each group has its own gate (docs/testing/answer-eval.md).
 *
 * @param scenario The scenario.
 * @returns Its group name.
 * Called from: loadScenarios(), main()
 */
export function answerGroup(scenario: Pick<Scenario, 'mode' | 'lessons'>): string {
  if (scenario.lessons?.length) return 'lessons';
  return scenario.mode === 'screenshot' ? 'screenshots' : 'answers';
}

/**
 * Reads the scenarios.
 *
 * @param only A group name or one scenario id, or null for all.
 * @returns The scenarios, in file order.
 * @throws Error when --only names neither a group nor a scenario.
 * Called from: main()
 */
function loadScenarios(only: string | null): Scenario[] {
  const files = readdirSync(SCENARIO_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  const scenarios = files.map(
    (name) => JSON.parse(readFileSync(path.join(SCENARIO_DIR, name), 'utf8')) as Scenario,
  );
  return selectScenarios(scenarios, answerGroup, only);
}

/**
 * The two checks made in code. headline+bullets: headline ≤ 15 words, ≤ 5 bullets.
 * paragraph: no bullet lines, and one paragraph.
 *
 * @param text   The answer.
 * @param format The session's answer format.
 * @returns 1 or 0 for each check.
 * Called from: main(); tests/unit/scripts/eval-answers.test.ts
 */
export function shapeChecks(text: string, format: string): { headline: number; bullets: number } {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const isBullet = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
  if (format === 'paragraph') {
    return {
      headline: lines.some(isBullet) ? 0 : 1,
      bullets: text.trim().split(/\n\s*\n/).length === 1 ? 1 : 0,
    };
  }
  const headline = (lines[0] ?? '').replace(/[*#_]/g, '').trim();
  const words = headline.split(/\s+/).filter(Boolean).length;
  return {
    headline: words > 0 && words <= 15 ? 1 : 0,
    bullets: lines.slice(1).filter(isBullet).length <= 5 ? 1 : 0,
  };
}

/**
 * Reads a scenario's invented image as a JPEG data URL.
 *
 * @param relative Its path relative to tests/eval.
 * @returns `data:image/jpeg;base64,…`.
 * Called from: answerScenario()
 */
function imageDataUrl(relative: string): string {
  const bytes = readFileSync(path.join(SCENARIO_DIR, '..', relative));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/**
 * Gets one answer through the real server prompt with the fast model.
 *
 * @param scenario       The scenario.
 * @param model          The fast model's name.
 * @param withoutLessons True to leave out the scenario's lessons (the comparison run).
 * @returns The answer text.
 * Called from: main()
 */
async function answerScenario(
  scenario: Scenario,
  model: string,
  withoutLessons: boolean,
): Promise<string> {
  const request: AnswerRequest = {
    mode: scenario.mode,
    session: scenario.session,
    conversation: scenario.conversation,
    tail: scenario.tail,
    ...(scenario.question ? { question: scenario.question } : {}),
    ...(scenario.image ? { image: imageDataUrl(scenario.image) } : {}),
    ...(scenario.lessons?.length && !withoutLessons ? { lessons: scenario.lessons } : {}),
  };
  const prompt = buildPrompt(request);
  let text = '';
  const reply = streamReply({ model, tier: 'fast', ...prompt, maxTokens: ANSWER_MAX_TOKENS });
  for (let next = await reply.next(); !next.done; next = await reply.next()) text += next.value;
  return text;
}

/**
 * Grades one answer with the smart model.
 *
 * @param scenario The scenario.
 * @param text     The answer.
 * @param model    The smart model's name.
 * @returns The grade.
 * Called from: main()
 */
async function grade(scenario: Scenario, text: string, model: string): Promise<Grade> {
  const prompt = [
    'Session details and documents:',
    sessionBlock(scenario.session),
    '',
    'The call so far (oldest first; "answer" items are earlier Kite answers):',
    JSON.stringify(scenario.conversation.flat(), null, 1),
    'Newest lines:',
    JSON.stringify(scenario.tail),
    '',
    ...(scenario.imageDescription
      ? [`The answer was made from a screenshot that shows: ${scenario.imageDescription}`]
      : []),
    scenario.mode === 'screenshot'
      ? `Question about the screenshot: ${scenario.question || DEFAULT_SCREENSHOT_QUESTION}`
      : `Question (${scenario.mode === 'chat' ? 'typed by the user' : 'from the other person'}): ${scenario.question}`,
    '',
    'Must include:',
    ...scenario.mustInclude.map((item) => `- ${item}`),
    'Must not include:',
    ...scenario.mustNotInclude.map((item) => `- ${item}`),
    '',
    'The answer to grade:',
    '<answer>',
    text,
    '</answer>',
  ].join('\n');
  const { value } = await jsonReply({
    model,
    tier: 'smart',
    system: GRADER_SYSTEM,
    prompt,
    schema: GRADE_SCHEMA,
    maxTokens: 400,
  });
  return value as Grade;
}

/**
 * Runs the evaluation and prints the score table.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const options = parseEvalArgs(process.argv.slice(2), 2);
  const scenarios = loadScenarios(options.only);
  // Model names only, so --dry-run works without a key.
  console.log(
    estimateLine(scenarios, answerGroup, options.runs, [
      { label: 'answers', model: process.env.KITE_MODEL_FAST || 'the fast model' },
      { label: 'grades', model: process.env.KITE_MODEL_SMART || 'the smart model' },
    ]),
  );
  if (options.dryRun) return;
  requireKey('eval-answers');
  const env = getClaudeEnv();
  console.log(
    `eval-answers: answers by ${env.modelFast}, graded by ${env.modelSmart}; ${scenarios.length} scenarios × ${options.runs} runs`,
  );
  const header =
    '| Scenario | Facts /3 | Grounded /2 | Consistent /2 | Style /1 | Headline /1 | Bullets /1 | Total /10 |';
  const rows: string[] = [];
  const results: ScenarioResult[] = [];
  let sum = 0;
  for (const scenario of scenarios) {
    const totals = { facts: 0, grounded: 0, consistent: 0, style: 0, headline: 0, bullets: 0 };
    const runs: ScenarioRunResult[] = [];
    for (let run = 1; run <= options.runs; run += 1) {
      const text = await answerScenario(scenario, env.modelFast, options.withoutLessons);
      const graded = await grade(scenario, text, env.modelSmart);
      const shape = shapeChecks(text, scenario.session.style.format);
      totals.facts += graded.facts;
      totals.grounded += graded.grounded;
      totals.consistent += graded.consistent;
      totals.style += graded.style;
      totals.headline += shape.headline;
      totals.bullets += shape.bullets;
      const scores = {
        facts: graded.facts,
        grounded: graded.grounded,
        consistent: graded.consistent,
        style: graded.style,
        headline: shape.headline,
        bullets: shape.bullets,
      };
      runs.push({
        run,
        scores,
        total: Object.values(scores).reduce((a, b) => a + b, 0),
        reason: graded.reason,
      });
      if (options.show) {
        console.log(`\n--- ${scenario.id} run ${run} ---\n${text}\n(grader: ${graded.reason})`);
      }
    }
    const average = (n: number) => n / options.runs;
    const total =
      average(totals.facts) +
      average(totals.grounded) +
      average(totals.consistent) +
      average(totals.style) +
      average(totals.headline) +
      average(totals.bullets);
    sum += total;
    results.push({ id: scenario.id, mean: total, runs });
    const cell = (n: number) => average(n).toFixed(1);
    rows.push(
      `| ${scenario.id} | ${cell(totals.facts)} | ${cell(totals.grounded)} | ${cell(totals.consistent)} | ${cell(totals.style)} | ${cell(totals.headline)} | ${cell(totals.bullets)} | ${total.toFixed(1)} |`,
    );
  }
  console.log(`\n${header}\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}`);
  console.log(
    `\nOverall: ${(sum / scenarios.length).toFixed(2)} / 10 (mean of ${scenarios.length} scenarios)`,
  );
  const saved = saveEvalResults({
    evaluation: 'answers',
    only: options.only,
    withoutLessons: options.withoutLessons,
    finishedAt: new Date().toISOString(),
    model: env.modelFast,
    grader: env.modelSmart,
    overall: sum / scenarios.length,
    scenarios: results,
  });
  console.log(`Scores and grader reasons saved to ${saved}`);
}

// Run only when executed directly (the unit test imports shapeChecks()).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    // The error's name and status only: an API error message could quote the request. Option
    // errors (ours, starting with "--") are printed in full.
    const status = (error as { status?: number }).status;
    console.error(
      `eval-answers: failed (${error instanceof Error ? (error.message.startsWith('--') ? error.message : error.name) : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
    );
    process.exitCode = 1;
  });
}
