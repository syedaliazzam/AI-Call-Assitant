/**
 * File: apps/web/scripts/eval-press.ts
 * Purpose: The key-press evaluation (ADR-0132–ADR-0135): about 20 invented call snippets, each pressed at a
 *          set moment, run through one checkout's own press rules (core/answer/newestQuestion.ts), request
 *          shape, live prompt (server/prompt.ts) and card formatter (core/answer/format.ts), answered by the
 *          fast Claude model, and checked in code (no grader):
 *          - right question: the question shown on the card names the newest open question;
 *          - covered: every open question is answered (its keywords appear in the answer);
 *          - no non-answer: the card is not empty and never says "not sure", "I don't know" and the like;
 *          - nothing invented: none of the scenario's forbidden patterns (a price, a date, a claim about the
 *            company that nothing gives) appears in the spoken part;
 *          - formatting: every line the card shows is the model's own words (the card never cut a sentence);
 *          - time to the first word the card shows (request sent → first visible word), on this machine.
 *          Run it once in the checkout before a change and once after, from that checkout's apps/web:
 *            cd <checkout>/apps/web
 *            npx tsx --env-file=<path to apps/web/.env.local> --conditions=react-server \
 *              <this repo>/apps/web/scripts/eval-press.ts --label=before [--runs=1] [--only=p01] [--dry-run]
 *          then `--report=before,after` prints the table from the saved results.
 * Used by: the developer, by hand (never in CI: it spends from the Claude budget; agree the cost first)
 * Depends on: the checkout's src/core/answer/newestQuestion.ts, src/core/answer/context.ts (toPressContext,
 *             when it has one), src/core/answer/format.ts, src/core/transcript/stability.ts,
 *             src/server/prompt.ts, src/server/prompts/defaults.ts, src/server/claude.ts, src/server/env.ts;
 *             @kite/shared (the hidden lines); tests/eval/press/*.json; scripts/lib/require-key.ts, spend.ts
 * Architecture: docs/testing/answer-eval.md ("Key-press group"); ADR-0132, ADR-0133, ADR-0134, ADR-0135
 *
 * Every scenario is invented. Only numbers are printed (`--show` also prints the answers, locally).
 * Results: apps/web/eval-results/press/<label>.json (git-ignored).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { splitMetaLine, type AnswerRequest } from '@kite/shared';
import {
  withAnswerMeta,
  withContractFallback,
  type ContractStats,
} from '../src/server/answer-meta';
import { requireKey } from './lib/require-key';
import { createSpendMeter } from './lib/spend';

/** This repository's apps/web (the scenarios and the results live here). */
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The scenarios. */
const SCENARIO_DIR = path.join(HERE, 'tests', 'eval', 'press');

/** Where results are saved. */
const RESULT_DIR = path.join(HERE, 'eval-results', 'press');

/** A non-answer: words that hedge instead of answering (A3). */
const NON_ANSWER =
  /\b(?:not sure|I don['’]t know|I['’]m not certain|can['’]t say|no idea|unsure|not certain yet)\b/i;

/** The call starts here (scenario times are seconds after it). */
const CALL_START = 1_800_000_000_000;

/** One line of a scenario. */
interface ScenarioLine {
  /** Who spoke. */
  speaker: 'you' | 'them';
  /** The words (invented). */
  text: string;
  /** Start, seconds after the call started. */
  start: number;
  /** End, seconds after the call started. */
  end: number;
  /** True for words still being spoken (grey). */
  grey?: boolean;
}

/** One scenario file. */
interface Scenario {
  /** Its id, for example "p03-two-questions". */
  id: string;
  /** Which kind it is (the table's rows). */
  category: 'single' | 'multi' | 'many' | 'cutoff' | 'statement' | 'nodocs' | 'answered' | 'memory';
  /** ADR-0137: the call memory the device would have by the press (sent by checkouts that send one). */
  memory?: string;
  /** The session details (live context shape). */
  session: NonNullable<AnswerRequest['session']>;
  /** The call so far. */
  lines: ScenarioLine[];
  /** End of the speech an earlier card answered, seconds (absent: none). */
  answeredEnd?: number;
  /** When the key is pressed, seconds. */
  press: number;
  /** What is checked. */
  expect: {
    /** Each open question as groups of keywords: any one word of a group must appear in the answer. */
    open: string[][];
    /** Keywords of the newest open question, at least one of which the card's question must name. */
    question: string[];
    /** Patterns (regular expressions, case-insensitive) that must not appear in the spoken part. */
    forbidden?: string[];
    /** True when four or more questions were asked: a "Still open:" line also counts as covering. */
    many?: boolean;
  };
}

/** One scored answer. */
interface Scored {
  /** Scenario id. */
  id: string;
  /** Its category. */
  category: Scenario['category'];
  /** The card's question names the newest open question. */
  rightQuestion: boolean;
  /** Every open question answered (or listed as still open, for four or more). */
  covered: boolean;
  /** No empty card and no hedge. */
  answered: boolean;
  /** No forbidden pattern. */
  noInvented: boolean;
  /** The card never cut or joined the model's sentences wrongly. */
  formatOk: boolean;
  /** The hidden question line arrived. */
  questionLine: boolean;
  /** Request sent → first visible word, ms (null when there was none). */
  firstWordMs: number | null;
  /** Request sent → done, ms. */
  doneMs: number;
  /** The card's question (local --show only). */
  shownQuestion: string;
  /** The card's text (local --show only). */
  text: string;
  /** The whole reply, hidden lines included (local debugging only). */
  raw?: string;
  /** The card can be said as it is: not empty, no hedge, not a bare promise, no thinking aloud. */
  usable: boolean;
}

/**
 * Imports a module of the checkout being measured (the current directory's src/).
 *
 * @param relative Its path under apps/web.
 * @returns The module.
 */
async function fromCheckout<T>(relative: string): Promise<T> {
  return (await import(pathToFileURL(path.join(process.cwd(), relative)).href)) as T;
}

/**
 * The scenario files, sorted.
 *
 * @param only An id prefix to keep, or ''.
 * @returns The scenarios.
 */
function loadScenarios(only: string): Scenario[] {
  return readdirSync(SCENARIO_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(SCENARIO_DIR, name), 'utf8')) as Scenario)
    .filter((scenario) => only === '' || scenario.id.startsWith(only));
}

/**
 * Whether a text contains a word of a group (whole word, case-insensitive; a group word may be a phrase).
 *
 * @param text  The text.
 * @param group The words.
 * @returns True when one appears.
 */
function hasAny(text: string, group: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return group.some((word) => lower.includes(word.toLowerCase()));
}

/**
 * Normalises text for the formatting check: no Markdown marks or bullet marks, one space.
 *
 * @param text The text.
 * @returns It, cleaned.
 */
function normal(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^\s*(?:[-*•–—]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Runs and scores one scenario in the checkout.
 *
 * @param scenario The scenario.
 * @param meter    The spend meter.
 * @returns The score.
 */
async function runScenario(
  scenario: Scenario,
  meter: ReturnType<typeof createSpendMeter>,
): Promise<Scored> {
  type Newest = typeof import('../src/core/answer/newestQuestion');
  type Context = typeof import('../src/core/answer/context');
  type Format = typeof import('../src/core/answer/format');
  type Stability = typeof import('../src/core/transcript/stability');
  type Prompt = typeof import('../src/server/prompt');
  type Defaults = typeof import('../src/server/prompts/defaults');
  type Claude = typeof import('../src/server/claude');
  type Env = typeof import('../src/server/env');
  const newest = await fromCheckout<Newest>('src/core/answer/newestQuestion.ts');
  const context = await fromCheckout<Partial<Context>>('src/core/answer/context.ts');
  const format = await fromCheckout<Format>('src/core/answer/format.ts');
  const stability = await fromCheckout<Stability>('src/core/transcript/stability.ts');
  const prompt = await fromCheckout<Prompt>('src/server/prompt.ts');
  const defaults = await fromCheckout<Defaults>('src/server/prompts/defaults.ts');
  const claude = await fromCheckout<Claude>('src/server/claude.ts');
  const env = await fromCheckout<Env>('src/server/env.ts');

  const at = (seconds: number) => CALL_START + Math.round(seconds * 1_000);
  const lines = scenario.lines.map((line, index) => ({
    id: `l${index}`,
    speaker: line.speaker,
    text: line.text,
    tStart: at(line.start),
    tEnd: at(line.end),
    final: line.grey !== true,
  }));
  const now = at(scenario.press);
  // The checkout's own press decision (the version before ADR-0133 ignores `now`).
  const choice = newest.chooseNewest({
    lines,
    answeredEnd: scenario.answeredEnd === undefined ? null : at(scenario.answeredEnd),
    lastAnswerId: scenario.answeredEnd === undefined ? null : 'earlier-card',
    now,
  } as Parameters<Newest['chooseNewest']>[0]);
  // The press sent nothing (the version before ADR-0133 ends the window at the user's reply, so a question
  // asked before it gets "Nothing new to answer"): the user got no answer.
  if (choice.kind !== 'answer') {
    return {
      id: scenario.id,
      category: scenario.category,
      rightQuestion: false,
      covered: false,
      answered: false,
      noInvented: true,
      formatOk: true,
      questionLine: false,
      firstWordMs: null,
      doneMs: 0,
      shownQuestion: `(no answer: ${choice.kind})`,
      text: '',
      usable: false,
    };
  }
  // The conversation as the page sends it: stable lines in one chunk, the rest in the tail.
  const { stable, tail } = stability.splitStable(lines, now);
  const seconds = (unix: number) => Math.max(0, Math.floor((unix - CALL_START) / 1_000));
  const window = (choice as { window?: unknown }).window;
  const request: AnswerRequest = {
    mode: 'answer',
    session: scenario.session,
    ...(stable.length > 0
      ? {
          conversation: [
            stable.map((line) => ({
              kind: 'line' as const,
              speaker: line.speaker,
              text: line.text,
              at: seconds(line.tStart),
            })),
          ],
        }
      : {}),
    ...(tail.length > 0
      ? {
          tail: tail.map((line) => ({
            speaker: line.speaker,
            text: line.text,
            at: seconds(line.tStart),
          })),
        }
      : {}),
    question: choice.text,
    // ADR-0137: the call memory, which an older checkout's prompt does not read.
    ...(scenario.memory ? { memory: scenario.memory } : {}),
    // ADR-0133: the checkouts that send the window send it here too.
    ...(window && context.toPressContext ? { press: context.toPressContext(window as never) } : {}),
  };
  const built = prompt.buildPrompt(request, defaults.DEFAULT_LIVE_PROMPT);
  const model = env.getClaudeEnv().modelFast;
  const sentAt = performance.now();
  let raw = '';
  let firstWordMs: number | null = null;
  const reply = claude.streamReply({
    model,
    tier: 'fast',
    ...built,
    maxTokens: prompt.ANSWER_MAX_TOKENS,
  });
  let next = await reply.next();
  for (; !next.done; next = await reply.next()) {
    raw += next.value;
    if (firstWordMs === null) {
      const split = splitMetaLine(raw);
      if (split.state === 'found' && split.rest.trim() !== '') {
        firstWordMs = performance.now() - sentAt;
      }
    }
  }
  const doneMs = performance.now() - sentAt;
  meter.add(model, next.value.usage);

  // What the card shows: the reply through the live route's own pipeline (as eval-answers --guard), then the
  // checkout's own formatter.
  const { text, question: clean } = await seen(raw);
  const shownQuestion = format.cardQuestion(choice.text, clean);
  return {
    ...checks(scenario, text, shownQuestion, format),
    id: scenario.id,
    category: scenario.category,
    questionLine: Boolean(clean?.trim()),
    firstWordMs: firstWordMs === null ? null : Math.round(firstWordMs),
    doneMs: Math.round(doneMs),
    shownQuestion,
    text,
    raw,
  };
}

/**
 * What the page receives for a whole raw reply: it goes through the live route's pipeline
 * (server/answer-meta.ts withAnswerMeta with the template stop, then withContractFallback), as
 * app/api/answer/route.ts runs it and as scripts/lib/guard-view.ts pipeReply() does for eval-answers --guard;
 * this one also keeps the hidden question line.
 *
 * @param raw The model's whole reply.
 * @returns The card's text and the clean question (undefined when none arrived).
 */
async function seen(raw: string): Promise<{ text: string; question: string | undefined }> {
  /**
   * The reply as one piece.
   *
   * @yields The reply.
   * @returns Nothing.
   */
  async function* source(): AsyncGenerator<string, null, undefined> {
    yield raw;
    return null;
  }
  const stats: ContractStats = { missingMeta: false, missingQuestion: false, strippedTags: 0 };
  const items = withContractFallback<null>(
    withAnswerMeta<null>(source(), stats, { stopOnTemplate: () => null }),
    { type: 'other', target: 'call', source: 'general' },
    stats,
  );
  let text = '';
  let question: string | undefined;
  for await (const item of items) {
    if (typeof item === 'string') text += item;
    else if ('question' in item) question = item.question;
  }
  return { text: text.trim(), question };
}

/**
 * Text the user could never say as it is: the model thinking aloud about the task, the user or the format
 * (seen in replies that lost their hidden first line).
 */
const THINKING_ALOUD =
  /\b(?:hmm|the user|hidden line|the format|per the format|let me correct|I should note|open questions?\b[^.]*\banswered in order)/i;

/**
 * The code checks of one card (shared by a run and --rescore).
 *
 * @param scenario      The scenario.
 * @param text          The card's text (hidden lines removed).
 * @param shownQuestion The card's question.
 * @param format        The checkout's card formatter.
 * @returns The checks.
 */
function checks(
  scenario: Scenario,
  text: string,
  shownQuestion: string,
  format: typeof import('../src/core/answer/format'),
): Pick<Scored, 'rightQuestion' | 'covered' | 'answered' | 'noInvented' | 'formatOk' | 'usable'> {
  const parts = format.splitAnswer(text, true) as ReturnType<typeof format.splitAnswer> & {
    stillOpen?: string;
  };
  const spoken = [parts.headline, ...parts.bullets, parts.tip, parts.say]
    .filter(Boolean)
    .join('\n');
  const rawNormal = normal(text);
  const formatOk = [parts.headline, ...parts.bullets].every((shown) =>
    rawNormal.includes(normal(shown)),
  );
  const stillOpen = parts.stillOpen ?? (/^\s*still open\s*:/im.test(text) ? 'yes' : '');
  const coveredGroups = scenario.expect.open.filter((group) => hasAny(spoken, group)).length;
  const forbidden = (scenario.expect.forbidden ?? []).map((pattern) => new RegExp(pattern, 'i'));
  const answered = text.trim() !== '' && !NON_ANSWER.test(spoken);
  // A promise and nothing else ("I'll confirm that after the call.") is not usable as it is.
  const promiseOnly =
    spoken.split(/\s+/).filter(Boolean).length < 16 &&
    /\b(?:confirm|get back|follow up|check)\b/i.test(spoken) &&
    parts.bullets.length === 0;
  return {
    rightQuestion: hasAny(shownQuestion, scenario.expect.question),
    covered:
      coveredGroups === scenario.expect.open.length ||
      (scenario.expect.many === true && coveredGroups >= 2 && stillOpen !== ''),
    answered,
    noInvented: !forbidden.some((pattern) => pattern.test(spoken)),
    formatOk,
    usable: answered && !promiseOnly && !THINKING_ALOUD.test(text),
  };
}

/**
 * Scores saved results again with the current scenario files and the checkout's formatter (no request is
 * sent), so a corrected check applies to both sides alike.
 *
 * @param label The saved results' label.
 */
async function rescore(label: string): Promise<void> {
  const format = await fromCheckout<typeof import('../src/core/answer/format')>(
    'src/core/answer/format.ts',
  );
  const file = path.join(RESULT_DIR, `${label}.json`);
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Scored[];
  const scenarios = new Map(loadScenarios('').map((scenario) => [scenario.id, scenario]));
  const rescored = saved.map((score) => {
    const scenario = scenarios.get(score.id);
    // A press that sent nothing keeps its all-failed score.
    if (!scenario || score.shownQuestion.startsWith('(no answer'))
      return { ...score, usable: false };
    return { ...score, ...checks(scenario, score.text, score.shownQuestion, format) };
  });
  writeFileSync(file, JSON.stringify(rescored, null, 2));
  console.log(`rescored ${rescored.length} answers in eval-results/press/${label}.json`);
}

/**
 * The median of numbers.
 *
 * @param values The numbers.
 * @returns The median, or null for none.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Prints the before/after table from saved results: per check, how many answers passed; and time to the
 * first visible word (median and p90).
 *
 * @param labels The result labels, for example ['before', 'after'].
 */
function report(labels: readonly string[]): void {
  const runs = labels.map(
    (label) => JSON.parse(readFileSync(path.join(RESULT_DIR, `${label}.json`), 'utf8')) as Scored[],
  );
  const checks: [string, keyof Scored][] = [
    ['Right question picked', 'rightQuestion'],
    ['All open questions covered', 'covered'],
    ['No "not sure" non-answers', 'answered'],
    ['No invented specific facts', 'noInvented'],
    ['Formatting OK', 'formatOk'],
    ['Answer usable as-is (no hedging or refusal)', 'usable'],
    ['Hidden question line arrived', 'questionLine'],
  ];
  console.log(`| Check | ${labels.join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---').join('|')}|`);
  for (const [name, key] of checks) {
    const cells = runs.map(
      (scores) => `${scores.filter((s) => s[key] === true).length}/${scores.length}`,
    );
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
  const p90 = (values: number[]) =>
    values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1]! : null;
  const words = runs.map((scores) =>
    scores.map((s) => s.firstWordMs).filter((v): v is number => v !== null),
  );
  console.log(
    `| First visible word, median / p90 (ms) | ${words.map((w) => `${median(w)} / ${p90(w)}`).join(' | ')} |`,
  );
  // Per category: answers passing every check.
  const categories = [...new Set(runs.flat().map((s) => s.category))];
  console.log('');
  console.log(`| Category (all checks passed) | ${labels.join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---').join('|')}|`);
  for (const category of categories) {
    const cells = runs.map((scores) => {
      const mine = scores.filter((s) => s.category === category);
      const ok = mine.filter(
        (s) => s.rightQuestion && s.covered && s.answered && s.noInvented && s.formatOk && s.usable,
      ).length;
      return `${ok}/${mine.length}`;
    });
    console.log(`| ${category} | ${cells.join(' | ')} |`);
  }
  // Per scenario, which checks failed (ids and check names only).
  console.log('');
  for (const [index, scores] of runs.entries()) {
    const failed = scores
      .map((s) => ({
        id: s.id,
        failed: checks
          .filter(([, key]) => key !== 'questionLine' && s[key] !== true)
          .map(([name]) => name),
      }))
      .filter((s) => s.failed.length > 0);
    console.log(
      `${labels[index]}: ${failed.map((s) => `${s.id} (${s.failed.join(', ')})`).join('; ') || 'none failed'}`,
    );
  }
}

/**
 * Runs the evaluation (or prints the report).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      label: { type: 'string', default: '' },
      runs: { type: 'string', default: '1' },
      only: { type: 'string', default: '' },
      'dry-run': { type: 'boolean', default: false },
      show: { type: 'boolean', default: false },
      report: { type: 'string', default: '' },
      rescore: { type: 'string', default: '' },
    },
  });
  if (values.rescore) {
    await rescore(values.rescore);
    return;
  }
  if (values.report) {
    report(values.report.split(','));
    return;
  }
  const scenarios = loadScenarios(values.only);
  const runs = Math.max(1, Number(values.runs) || 1);
  console.log(
    `estimate: ${scenarios.length} scenarios × ${runs} run(s) = ${scenarios.length * runs} Claude requests (answers by the fast model; checked in code, no grader)`,
  );
  if (values['dry-run']) return;
  if (!values.label) throw new Error('--label is required');
  requireKey('eval-press');
  const meter = createSpendMeter();
  const scores: Scored[] = [];
  for (let run = 0; run < runs; run += 1) {
    for (const scenario of scenarios) {
      const scored = await runScenario(scenario, meter);
      scores.push(scored);
      console.log(
        `${scored.id}: question ${scored.rightQuestion ? 'ok' : 'NO'}, covered ${scored.covered ? 'ok' : 'NO'}, answered ${scored.answered ? 'ok' : 'NO'}, invented ${scored.noInvented ? 'none' : 'YES'}, format ${scored.formatOk ? 'ok' : 'NO'}, first word ${scored.firstWordMs ?? '-'} ms`,
      );
      if (values.show)
        console.log(`  Q: ${scored.shownQuestion}\n  ${scored.text.replace(/\n/g, '\n  ')}`);
    }
  }
  if (!existsSync(RESULT_DIR)) mkdirSync(RESULT_DIR, { recursive: true });
  writeFileSync(path.join(RESULT_DIR, `${values.label}.json`), JSON.stringify(scores, null, 2));
  console.log(
    `spent: about $${meter.spent().toFixed(3)}; saved eval-results/press/${values.label}.json`,
  );
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('eval-press failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
