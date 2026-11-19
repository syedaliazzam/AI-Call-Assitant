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
 *            --only=preferences  parity Phase 2 and v1.2.0 (21–24: bullets only, an answer language,
 *                                the technical tone, STAR structure)
 *            --only=adaptive     ADR-0030: 6 roles × 4 question types (tests/eval/groups)
 *            --only=missing-info ADR-0030: 4 questions under both settings
 *            --only=hallucination-bait  ADR-0030: gate is zero invented prices or personal numbers
 *            --only=consistency  ADR-0030: the same question twice in one call
 *            --only=ask-kite     ADR-0030: private answers, in a call and on the page
 *            --only=question-detection  ADR-0043: non-questions and garbled lines are not answered
 *            --only=screenshot-types    ADR-0043: coding, code error, slide, table, document, web page
 *            --only=company-star        ADR-0084: a company "always use STAR" instruction with no CV,
 *                                       a CV with no matching project, and a CV with one
 *            --without-lessons   send no lessons (the lesson group's comparison run)
 *            --style=previous    answer with the v-previous rules (ADR-0032 rollback switch)
 *            --only=<id>         one scenario (its file name without .json)
 *            --runs=N   answers per scenario (default 2; scores are averaged, because answers
 *                       vary from run to run)
 *            --show     also print each answer and the grader's reason (local use only; the
 *                       scenarios are invented, but answers are never printed by default)
 *            --dry-run  print the estimated number of Claude requests and stop
 *            --their-name=<name>  ADR-0093: the other person is named (their lines carry the name)
 *            --max-dollars=<n>    stop before the next scenario once this much is spent
 *            --no-grade answers only, no grader requests (half the cost): the code checks are
 *                       reported and the grader's columns show "–"; read the answers with --show
 *            --spoken   ADR-0101: typed (chat) questions are sent as spoken voice questions (the prompt's
 *                       "spoken by the user (speech recognition…)" label)
 *            --model=<gemini-lite|gpt-luna|gemini-flash|gpt-terra>  ADR-0099: live answers from that
 *                       Gemini or GPT model (its id from KITE_MODEL_GEMINI_* / KITE_MODEL_OPENAI_*, its key
 *                       GEMINI_API_KEY / OPENAI_API_KEY), with the same prompt and latency settings as the
 *                       answer route; the grader stays Sonnet. Ask AI scenarios stay on Claude.
 *          Every paid run also saves per-scenario scores and grader reasons to a git-ignored
 *          file (scripts/lib/eval-results.ts), so a drop can be diagnosed without another run.
 *          Re-run only the groups a change touches; the full suite only as CLAUDE.md
 *          "Evaluation cost" says. The estimate is printed before anything is sent.
 * Used by: the "eval:answers" script in apps/web/package.json (run by a developer by hand;
 *          never in CI: it calls the real API and needs the real key)
 * Depends on: src/server/prompt.ts (buildPrompt, sessionBlock), src/server/prompts/defaults.ts (the
 *             default global prompts and LEGACY_HEADING, ADR-0089),
 *             src/server/claude.ts (streamReply, jsonReply), src/server/env.ts, @kite/shared,
 *             src/server/gemini.ts and src/server/openai.ts (--model, ADR-0099),
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
 * or 'chat'); group (optional: its evaluation group, when not worked out from the rest); question;
 * mustInclude and mustNotInclude (what a good answer must and must not
 * contain, in plain words for the grader); company (optional: company AI instructions, ADR-0083).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SCREENSHOT_QUESTION,
  isAnswerModel,
  providerOf,
  type AnswerModel,
  createQuestionLineFilter,
  splitMetaLine,
  type AnswerMeta,
  type AnswerRequest,
  type AnswerUsage,
  cleanPersonName,
} from '@kite/shared';
import { buildClaimCorpus, checkClaims, needsClaimCheck } from '@/core/answer/claimCheck';
import { findSimilarAnswer } from '@/core/answer/similar';
import { jsonReply, streamReply } from '@/server/claude';
import { getClaudeEnv, getGeminiEnv, getOpenAIEnv } from '@/server/env';
import { streamGeminiReply } from '@/server/gemini';
import { streamOpenAIReply } from '@/server/openai';
import { buildKiteChatPrompt, KITE_CHAT_MAX_TOKENS } from '@/server/kite-chat';
import { ANSWER_MAX_TOKENS, buildPrompt, sessionBlock } from '@/server/prompt';
import { DEFAULT_ASK_PROMPT, DEFAULT_LIVE_PROMPT, LEGACY_HEADING } from '@/server/prompts/defaults';
import { ADAPTIVE_SCENARIOS } from '../tests/eval/groups/adaptive';
import { COMPANY_SCENARIOS } from '../tests/eval/groups/company';
import { HONESTY_SCENARIOS } from '../tests/eval/groups/honesty';
import { DETECTION_SCENARIOS } from '../tests/eval/groups/detection';
import { callAnswerLine } from './lib/answer-line';
import { QUALITY_SCENARIOS } from '../tests/eval/groups/quality';
import type { Scenario } from '../tests/eval/groups/types';
import { runAnswerCode, type CodeResult } from './lib/code-sandbox';
import { requireKey } from './lib/require-key';
import { createSpendMeter, type SpendMeter } from './lib/spend';
import { estimateLine, parseEvalArgs, selectScenarios } from './lib/eval-options';
import {
  saveEvalResults,
  type RunChecks,
  type RunDepth,
  type ScenarioResult,
  type ScenarioRunResult,
} from './lib/eval-results';

/** tests/eval/scenarios. */
const SCENARIO_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'eval',
  'scenarios',
);

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
  /**
   * ADR-0107: complete and useful for its kind of question, within the user's length: 0–2. Reported on its
   * own, never added to the /10 total, so totals stay comparable with the baselines.
   */
  complete: number;
  /** One sentence on what cost points (printed only with --show). */
  reason: string;
  /** Every price, personal number, statistic or source the answer invented, in its own words. */
  invented: string[];
}

/** The structured-output schema the grader must follow. */
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    facts: { type: 'integer', enum: [0, 1, 2, 3] },
    grounded: { type: 'integer', enum: [0, 1, 2] },
    consistent: { type: 'integer', enum: [0, 1, 2] },
    style: { type: 'integer', enum: [0, 1] },
    complete: { type: 'integer', enum: [0, 1, 2] },
    reason: { type: 'string' },
    invented: { type: 'array', items: { type: 'string' } },
  },
  required: ['facts', 'grounded', 'consistent', 'style', 'complete', 'reason', 'invented'],
  additionalProperties: false,
};

/** The grader's instructions: the rubric (the same as docs/testing/answer-eval.md). */
const GRADER_SYSTEM = `You grade answers written by Kite, a live call assistant. Kite reads the session details, documents and the call so far, and writes an answer the user can say to the other person, or, when the question says it is private, a direct answer for the user to read. Grade strictly against the rubric. Score only what is written in the answer.

Rubric:
- facts (0-3): how many of the "must include" points the answer contains, correctly. 3 = all, 2 = most, 1 = some, 0 = none or wrong.
- grounded (0-2): 2 = every claim about the user, their company, offer, prices, dates or commitments comes from the session details, documents or the call, and nothing from "must not include" appears; 1 = one small unsupported detail; 0 = an invented fact, a wrong number, or a "must not include" item.
- consistent (0-2): if the call shows earlier Kite answers, 2 = consistent with them, or, when new information changes the answer, it gives the new answer and says briefly what changed; 1 = partly; 0 = contradicts them without saying why, or ignores new information. If there are no earlier answers, give 2.
- style (0-1): 1 = follows the session's answer format (bullets: only short bullets with no headline line, the first giving the direct answer, optionally followed by the same two lines; headline+bullets: a headline line, which is one plain sentence of at most 15 words, then short bullets (a reply that needs nothing more may be the headline alone, and a brief "As I mentioned" may open a repeated answer), optionally followed by one closing line starting "Tip:" and one line starting "Note:" that is private to the user, both allowed only when they add something and do not repeat a bullet; paragraph: one short paragraph, no bullets), length, tone and instructions, with no greeting or preamble; 0 = it does not, or the spoken part says or implies that something is missing from the notes, CV or documents (a "Note:" line may name what to check). A coding answer has its own shape: an approach line, "Key steps:" with bullets, a code block, a "Complexity:" line and a "Say:" line, whatever the format. A screenshot answer follows what the screen shows: code with an error gives the cause, the fix and corrected code; a slide or document its key points and how to respond; a table or chart its takeaway and key numbers; a screen that cannot be read says so in one line. A private answer is free in shape, and only has to be direct and clear.
- complete (0-2): is the answer complete and useful for this kind of question, within the user's length setting? 2 = it gives what this kind of question needs: a concept says what it is, how it works and why it matters or its main trade-off; a design names the main parts, how data flows and one trade-off; a behavioural answer says what I did and the result the CV gives; a sales or client answer meets the need with the facts that support it; a coding answer solves the problem with working code; a screenshot answer gives the key point or the solution (the answer to the question on the screen, the fix, the takeaway), never only a description of the screen. 1 = correct but thin: it leaves out part of what this kind of question needs, or stays vague where a concrete step, reason or example would help. 0 = it does not answer: it only describes, restates the question, or asks whether the user wants an answer. A fact the session, documents and call do not give is never counted as missing here, and a short answer that is complete for a simple question gets 2.
- reason: one short sentence on what cost points ("none" when nothing did).
- invented: every price, personal number, statistic, source or fact about a company that the answer states and that the session details, documents and call do not support, in the answer's own words. General technical knowledge, stated assumptions in an estimate and simple arithmetic on supported figures are not invented. Empty when there are none.`;

/**
 * The group a scenario belongs to: 'lessons' for scenarios with approved lessons (Day 5
 * Stage 7), 'screenshots' for the screenshot scenarios (Day 5), else 'answers' (the Day 4
 * baseline group). Each group has its own gate (docs/testing/answer-eval.md).
 *
 * @param scenario The scenario.
 * @returns Its group name.
 * Called from: loadScenarios(), main()
 */
export function answerGroup(scenario: Pick<Scenario, 'mode' | 'lessons' | 'group'>): string {
  if (scenario.group) return scenario.group;
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
  return selectScenarios(
    [
      ...scenarios,
      ...ADAPTIVE_SCENARIOS,
      ...QUALITY_SCENARIOS,
      ...HONESTY_SCENARIOS,
      ...DETECTION_SCENARIOS,
      ...COMPANY_SCENARIOS,
    ],
    answerGroup,
    only,
  );
}

/**
 * The two checks made in code. headline+bullets: headline ≤ 15 words, ≤ 5 bullets.
 * paragraph: no bullet lines, and one paragraph.
 *
 * A private answer is free in shape, and a coding answer may have more bullets: the steps,
 * complexity and edge cases.
 *
 * @param text   The answer, without its hidden line.
 * @param format The session's answer format.
 * @param meta   What the hidden line said, when it had one.
 * @returns 1 or 0 for each check.
 * Called from: main(); tests/unit/scripts/eval-answers.test.ts
 */
export function shapeChecks(
  text: string,
  format: string,
  meta?: Pick<AnswerMeta, 'type' | 'target'> | null,
): { headline: number; bullets: number } {
  if (meta?.target === 'kite') return { headline: 1, bullets: 1 };
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (meta?.type === 'coding') {
    const first = (lines[0] ?? '').replace(/[*#_]/g, '').trim();
    return {
      headline: first.split(/\s+/).filter(Boolean).length <= 25 ? 1 : 0,
      bullets: /```/.test(text) ? 1 : 0,
    };
  }
  const isBullet = (line: string) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);
  if (format === 'paragraph') {
    return {
      headline: lines.some(isBullet) ? 0 : 1,
      bullets: text.trim().split(/\n\s*\n/).length === 1 ? 1 : 0,
    };
  }
  if (format === 'bullets') {
    const bullets = lines.filter(isBullet).length;
    return {
      headline: isBullet(lines[0] ?? '') ? 1 : 0,
      bullets: bullets >= 1 && bullets <= 5 ? 1 : 0,
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
 * The grade of a reply with no answer in it: full marks where none was wanted.
 *
 * @param scenario The scenario.
 * @returns The grade.
 * Called from: main()
 */
function noAnswerGrade(scenario: Scenario): Grade {
  const expected = [scenario.expectType].flat();
  // v1.4 (ADR-0065): none (nothing asked) is no answer too.
  const right = expected.includes('garbled') || expected.includes('none');
  return {
    facts: right ? 3 : 0,
    grounded: 2,
    consistent: 2,
    style: right ? 1 : 0,
    complete: right ? 2 : 0,
    reason: right ? 'none' : 'a real question got no answer',
    invented: [],
  };
}

/**
 * The placeholder grade of a --no-grade run: no grader request is sent, so the grader's scores are
 * not known (the table shows "–"); the code checks still run.
 */
const UNGRADED: Grade = {
  facts: 0,
  grounded: 0,
  consistent: 0,
  style: 0,
  complete: 0,
  reason: 'not graded (--no-grade)',
  invented: [],
};

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

/** One answer, with what its hidden line said. */
interface ScenarioAnswer {
  /** The answer as the user sees it. */
  text: string;
  /** What the hidden line said, or null when it had none. */
  meta: AnswerMeta | null;
  /** ADR-0103: true when the raw reply contains the contract's placeholder ("[[type|for|source]]"). */
  placeholder: boolean;
  /** Token counts. */
  usage: AnswerUsage;
}

/**
 * ADR-0103: the contract's placeholder copied into a reply, anywhere: "[[type|for|source]]", or the
 * same slots under another first word ("[[question|for|source]]").
 */
const PLACEHOLDER = /\[\[\s*[a-z]+\s*\|\s*for\s*\|\s*source\s*\]\]/i;

/**
 * ADR-0099: the third-party model a run's live answers come from (--model), with its key and model id.
 */
export interface ProviderModel {
  /** The answer model asked for. */
  model: AnswerModel;
  /** 'gemini' or 'openai'. */
  provider: 'gemini' | 'openai';
  /** The provider's key (never printed). */
  apiKey: string;
  /** The model id, for example 'gemini-3.5-flash-lite'. */
  modelId: string;
}

/**
 * ADR-0099: reads --model. Only the Gemini and GPT models are taken (Claude is the default; Groq is not part
 * of this evaluation).
 *
 * @param argv process.argv.slice(2).
 * @returns The answer model, or null when --model is not given.
 * @throws Error('--model …') for any other value.
 * Called from: main(); tests
 */
export function parseAnswerModel(argv: readonly string[]): AnswerModel | null {
  const joined = argv.find((arg) => arg.startsWith('--model='));
  const at = argv.indexOf('--model');
  const value = joined ? joined.slice('--model='.length) : at === -1 ? null : (argv[at + 1] ?? '');
  if (value === null) return null;
  if (!isAnswerModel(value) || (providerOf(value) !== 'gemini' && providerOf(value) !== 'openai')) {
    throw new Error('--model must be gemini-lite, gpt-luna, gemini-flash or gpt-terra');
  }
  return value;
}

/**
 * ADR-0099: the key and model id for --model, as the answer route picks them.
 *
 * @param model The Gemini or GPT model.
 * @returns The provider model.
 * @throws Error('--model …') when the provider's key is not set.
 * Called from: main()
 */
function providerModel(model: AnswerModel): ProviderModel {
  const provider = providerOf(model) === 'gemini' ? 'gemini' : 'openai';
  const env = provider === 'gemini' ? getGeminiEnv() : getOpenAIEnv();
  if (!env) {
    throw new Error(
      `--model=${model} needs ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'}`,
    );
  }
  const smarter = model === 'gemini-flash' || model === 'gpt-terra';
  return { model, provider, apiKey: env.apiKey, modelId: smarter ? env.modelSmart : env.modelFast };
}

/**
 * Gets one answer through the real server prompt: the fast model, or the smart one for the Ask Kite
 * page, as the live route chooses.
 *
 * @param scenario       The scenario.
 * @param models         The two models' names.
 * @param withoutLessons True to leave out the scenario's lessons (the comparison run).
 * @param style          'previous' to answer with the v-previous rules (ADR-0032), else null.
 * @param meter          Counts the spend.
 * @param theirName      ADR-0093: the other person's name for every scenario (--their-name), or null.
 * @param earlier        Consistency scenarios: the first answer, in the conversation, and the
 *                       question asked again.
 * @param third          ADR-0099: the Gemini or GPT model live answers come from (--model), or null.
 * @param spoken         ADR-0101: send a typed question as a spoken one (--spoken).
 * @returns The answer.
 * Called from: main()
 */
async function answerScenario(
  scenario: Scenario,
  models: { fast: string; smart: string },
  withoutLessons: boolean,
  style: 'previous' | null,
  meter: SpendMeter,
  theirName: string | null,
  earlier?: { question: string; text: string },
  third: ProviderModel | null = null,
  spoken = false,
): Promise<ScenarioAnswer> {
  const question = earlier ? (scenario.repeat ?? scenario.question) : scenario.question;
  const similar = earlier
    ? findSimilarAnswer(question, [{ ...earlier, at: scenario.tail[0]?.at ?? 0 }])
    : null;
  const request: AnswerRequest = {
    mode: scenario.mode,
    ...(scenario.mode === 'kite'
      ? { attachments: scenario.attachments ?? [], history: scenario.history ?? [] }
      : {
          session: theirName ? { ...scenario.session, themName: theirName } : scenario.session,
          conversation: earlier
            ? [
                [
                  ...scenario.tail.map((line) => ({ kind: 'line' as const, ...line })),
                  {
                    kind: 'answer' as const,
                    mode: 'answer' as const,
                    question: earlier.question,
                    text: earlier.text,
                    at: (scenario.tail[0]?.at ?? 0) + 1,
                  },
                ],
              ]
            : scenario.conversation,
          tail: earlier
            ? [{ speaker: 'them' as const, text: question, at: (scenario.tail[0]?.at ?? 0) + 120 }]
            : scenario.tail,
        }),
    ...(question ? { question } : {}),
    ...(scenario.image ? { image: imageDataUrl(scenario.image) } : {}),
    ...(scenario.lessons?.length && !withoutLessons ? { lessons: scenario.lessons } : {}),
    ...(scenario.target ? { target: scenario.target } : {}),
    ...(style ? { styleVersion: style } : {}),
    // ADR-0101: --spoken sends a typed question as a spoken one.
    ...(spoken && scenario.mode === 'chat' ? { spoken: true } : {}),
    ...(similar
      ? { similar: { question: similar.question, text: similar.text, at: similar.at } }
      : {}),
  };
  const page = scenario.mode === 'kite';
  // ADR-0089: the default global prompt, with a scenario's company instructions (ADR-0083) added the way
  // a pre-ADR-0089 saved version is read (server/aiInstructions.ts rowPrompt()).
  const base = page ? DEFAULT_ASK_PROMPT : DEFAULT_LIVE_PROMPT;
  const globalPrompt = scenario.company
    ? `${base}\n\n${LEGACY_HEADING}\n${scenario.company}`
    : base;
  const prompt = page
    ? buildKiteChatPrompt(request, globalPrompt)
    : buildPrompt(request, globalPrompt);
  // ADR-0099: with --model, live answers come from that Gemini or GPT model (the route's latency settings);
  // Ask AI stays on Claude, as in the app.
  const viaThird = third !== null && !page;
  const model = viaThird ? third.modelId : page ? models.smart : models.fast;
  let raw = '';
  const maxTokens = page ? KITE_CHAT_MAX_TOKENS : ANSWER_MAX_TOKENS;
  const reply = viaThird
    ? third.provider === 'gemini'
      ? streamGeminiReply({ apiKey: third.apiKey, model: third.modelId, ...prompt, maxTokens })
      : streamOpenAIReply({ apiKey: third.apiKey, model: third.modelId, ...prompt, maxTokens })
    : streamReply({
        model,
        tier: page ? 'smart' : 'fast',
        ...prompt,
        maxTokens,
      });
  let next = await reply.next();
  for (; !next.done; next = await reply.next()) raw += next.value;
  meter.add(model, next.value.usage);
  const split = splitMetaLine(raw);
  // ADR-0103: a copied placeholder as the first line is not a hidden line (its type is "type").
  const realMeta = split.state === 'found' && !/^\s*\[\[\s*type\s*\|/i.test(raw);
  return {
    text: withoutQuestionLine(split.state === 'found' ? split.rest : raw.trim()),
    meta: realMeta && split.state === 'found' ? split.meta : null,
    placeholder: PLACEHOLDER.test(raw),
    usage: next.value.usage,
  };
}

/**
 * An answer without its hidden last line, as the route's pipeline takes it out (answer-meta.ts): the
 * person never sees that line, so it must not be graded. v1.0.2 added the line; this evaluation had not
 * run since, so its baselines were measured without it.
 *
 * @param text The answer.
 * @returns What the card shows.
 * Called from: answerScenario()
 */
function withoutQuestionLine(text: string): string {
  const filter = createQuestionLineFilter();
  return `${filter.push(text).text}${filter.end().text}`.trim();
}

/** A comment about what Kite was given: never allowed in an answer's spoken part. */
const META_COMMENT =
  /\b(?:not|isn['’]t|aren['’]t) (?:mentioned |listed |covered |included |specified |available |recorded )?(?:in|on) (?:your|the|my) (?:notes|cv|resume|résumé|documents?|session|materials?)\b|\b(?:notes|cv|resume|résumé|documents?)(?: I have)? (?:do(?:es)?n['’]t|do(?:es)? not|lacks?|ha(?:s|ve) no)\b|\bfrom what I have here\b/i;

/**
 * Whether an answer's spoken part comments on what Kite was given.
 *
 * @param text The answer.
 * @returns True when it does. A private "Note:" line may name what to check.
 * Called from: main(); tests
 */
export function hasMetaComment(text: string): boolean {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:[-*•]\s+)?(?:\*\*)?note\b/i.test(line))
    .some((line) => META_COMMENT.test(line));
}

/**
 * Whether two answers state the same numbers, and how much of their wording they share.
 *
 * @param first  The first answer.
 * @param second The second answer.
 * @returns Whether the numbers match, and the share of words in common (0 to 1).
 * Called from: main(); tests
 */
export function answerAgreement(
  first: string,
  second: string,
): { numbers: boolean; words: number } {
  const numbers = (text: string) =>
    new Set((text.match(/\d[\d,.]*\d|\d/g) ?? []).map((value) => value.replaceAll(',', '')));
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const [a, b] = [numbers(first), numbers(second)];
  const [c, d] = [words(first), words(second)];
  const shared = [...c].filter((word) => d.has(word)).length;
  return {
    numbers: a.size === b.size && [...a].every((value) => b.has(value)),
    words: shared / Math.max(1, c.size + d.size - shared),
  };
}

/**
 * Grades one answer with the smart model.
 *
 * @param scenario The scenario.
 * @param text     The answer.
 * @param model    The smart model's name.
 * @param meter    Counts the spend.
 * @param earlier  Consistency scenarios: the first answer the grader compares with.
 * @returns The grade.
 * Called from: main()
 */
async function grade(
  scenario: Scenario,
  text: string,
  model: string,
  meter: SpendMeter,
  earlier?: { question: string; text: string },
): Promise<Grade> {
  const prompt = [
    'Session details and documents:',
    sessionBlock(scenario.session),
    '',
    ...(scenario.company
      ? [
          "Company instructions (from the company's admin; Kite's honesty rules win over them):",
          scenario.company,
          '',
        ]
      : []),
    ...(scenario.expectTarget === 'kite'
      ? ['This is a private answer for the user to read, not words to say on a call.', '']
      : []),
    ...(earlier
      ? [
          'Earlier in this call, Kite answered the same question like this:',
          `Question: ${earlier.question}`,
          earlier.text,
          '',
        ]
      : []),
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
      : `Question (${scenario.mode === 'answer' ? 'from the other person' : 'typed by the user'}): ${earlier ? (scenario.repeat ?? scenario.question) : scenario.question}`,
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
  const { value, usage } = await jsonReply({
    model,
    tier: 'smart',
    system: GRADER_SYSTEM,
    prompt,
    schema: GRADE_SCHEMA,
    maxTokens: 600,
  });
  meter.add(model, usage);
  return value as Grade;
}

/**
 * The checks made in code on top of the score: the hidden line, comments on what Kite was given,
 * invented figures, whether the code runs, and whether a repeat agrees with the first answer. They
 * hold scores and short labels only; a claim's own words come from invented scenarios.
 *
 * @param scenario The scenario.
 * @param answer   The answer.
 * @param graded   The grader's scores.
 * @param first    Consistency scenarios: the first answer.
 * @returns The checks that apply to this scenario.
 * Called from: main()
 */
async function extraChecks(
  scenario: Scenario,
  answer: ScenarioAnswer,
  graded: Grade,
  first?: { question: string; text: string },
): Promise<RunChecks> {
  const { text, meta } = answer;
  const expected = scenario.expectType;
  const code: CodeResult | null = /```/.test(text) ? await runAnswerCode(text) : null;
  const corpus = buildClaimCorpus([
    scenario.session.company,
    scenario.session.role,
    scenario.session.description,
    scenario.session.instructions,
    ...scenario.session.documents.map((document) => document.text),
    ...scenario.tail.map((line) => line.text),
    ...scenario.conversation.flat().map((item) => item.text),
    scenario.question,
    scenario.repeat ?? '',
  ]);
  const claims = needsClaimCheck(meta, scenario.mode) ? checkClaims(text, corpus) : [];
  return {
    hiddenLine: meta !== null,
    placeholder: answer.placeholder,
    // v1.1.0 (item 16): reported beside the Headline point, which stays at 15 words so scores remain
    // comparable with the baselines.
    ...(callAnswerLine(text, scenario.session.style.format, meta) ?? {}),
    ...(expected
      ? {
          typeOk: (Array.isArray(expected) ? expected : [expected]).includes(
            meta?.type ?? 'unclear',
          ),
        }
      : {}),
    ...(scenario.expectTarget ? { targetOk: meta?.target === scenario.expectTarget } : {}),
    metaComment: meta?.target === 'kite' ? false : hasMetaComment(text),
    invented: graded.invented,
    unsupportedNumbers: claims
      .filter((claim) => claim.kind === 'number')
      .map((claim) => claim.text),
    unsupportedNames: claims.filter((claim) => claim.kind !== 'number').map((claim) => claim.text),
    ...(code ? { code } : {}),
    ...(scenario.expectCode ? { codeRuns: (code?.ran ?? 0) > 0 && (code?.failed ?? 1) === 0 } : {}),
    ...(first ? { agreement: answerAgreement(first.text, text) } : {}),
  };
}

/**
 * Sums up the checks for the printed report, so the gates can be read without opening the file.
 *
 * @param results Every scenario's results.
 * @returns The lines ([] for a run where none apply).
 * Called from: main()
 */
function summariseChecks(results: readonly ScenarioResult[]): string[] {
  const runs = results.flatMap((result) =>
    result.runs.map((run) => run.checks).filter(Boolean),
  ) as RunChecks[];
  if (runs.length === 0) return [];
  const count = (test: (checks: RunChecks) => boolean | undefined) => ({
    pass: runs.filter((checks) => test(checks) === true).length,
    all: runs.filter((checks) => test(checks) !== undefined).length,
  });
  const line = (label: string, test: (checks: RunChecks) => boolean | undefined) => {
    const { pass, all } = count(test);
    return all > 0 ? [`${label}: ${pass}/${all}`] : [];
  };
  return [
    ...line('Hidden line present', (checks) => checks.hiddenLine),
    ...line('No copied placeholder', (checks) =>
      checks.placeholder === undefined ? undefined : !checks.placeholder,
    ),
    ...line('Question type as expected', (checks) => checks.typeOk),
    ...line('Answer line 12 words or fewer', (checks) =>
      checks.answerLineWords === undefined ? undefined : checks.answerLineWords <= 12,
    ),
    ...line('Answer line as shown, 12 words or fewer', (checks) =>
      checks.shownLineWords === undefined ? undefined : checks.shownLineWords <= 12,
    ),
    ...line('For the call / Ask Kite as expected', (checks) => checks.targetOk),
    ...line('No comment on what Kite was given', (checks) => !checks.metaComment),
    ...line('Grader found nothing invented', (checks) => checks.invented.length === 0),
    ...line(
      'No number outside the documents and call',
      (checks) => checks.unsupportedNumbers.length === 0,
    ),
    ...line('Code ran in the sandbox', (checks) => checks.codeRuns),
    ...line('Repeat states the same numbers', (checks) => checks.agreement?.numbers),
    ...line('Answer not empty', (checks) =>
      checks.empty === undefined ? undefined : !checks.empty,
    ),
  ];
}

/**
 * ADR-0107: how full an answer is: its words outside code blocks and hidden lines, and its bullet lines.
 *
 * @param text The answer as the card shows it.
 * @param type The question type from its hidden line, if any.
 * @returns The depth (without the grader's score).
 * Called from: main(); tests
 */
export function answerDepth(text: string, type: string | undefined): RunDepth {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\[\[[^\]]*\]\]/g, ' ');
  const words = prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  const bullets = prose
    .split('\n')
    .filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
  return { type: type ?? 'none', words, bullets };
}

/**
 * ADR-0107: the depth table: per question type, the runs, mean words, mean bullets, the mean "complete and
 * useful" score and how many runs scored it in full.
 *
 * @param results Every scenario's results.
 * @returns The lines ([] when no run has a depth).
 * Called from: main()
 */
function summariseDepth(results: readonly ScenarioResult[]): string[] {
  const depths = results.flatMap((result) =>
    result.runs.flatMap((run) => (run.checks?.depth ? [run.checks.depth] : [])),
  );
  if (depths.length === 0) return [];
  const types = [...new Set(depths.map((depth) => depth.type))].sort();
  const mean = (values: number[]) =>
    values.length === 0 ? '–' : (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
  const row = (label: string, group: RunDepth[]) => {
    const graded = group.flatMap((depth) => (depth.complete === undefined ? [] : [depth.complete]));
    const full = graded.filter((score) => score === 2).length;
    return `| ${label} | ${group.length} | ${mean(group.map((d) => d.words))} | ${mean(group.map((d) => d.bullets))} | ${mean(graded)} | ${graded.length ? `${full}/${graded.length}` : '–'} |`;
  };
  return [
    '| Type | Runs | Words | Bullets | Complete /2 | Full coverage |',
    '|---|---|---|---|---|---|',
    ...types.map((type) =>
      row(
        type,
        depths.filter((depth) => depth.type === type),
      ),
    ),
    row('all', depths),
  ];
}

/**
 * Runs the evaluation and prints the score table.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  // ADR-0107: --model=sonnet answers with the smart Claude model (thinking off, as the fast tier), for a
  // comparison only; the app does not answer live questions with it.
  const sonnet = process.argv.slice(2).includes('--model=sonnet');
  const argv = process.argv.slice(2).filter((arg) => arg !== '--model=sonnet');
  const options = parseEvalArgs(argv, 2);
  // ADR-0099: --model, the Gemini or GPT model live answers come from (null: Claude Haiku as before).
  const answerModel = parseAnswerModel(argv);
  // ADR-0101: --spoken, typed questions sent as spoken voice questions.
  const spoken = process.argv.slice(2).includes('--spoken');
  // ADR-0093: cleaned as the app cleans it, so the prompt is the one a named call sends.
  const theirName = cleanPersonName(options.theirName) || null;
  const scenarios = loadScenarios(options.only);
  // Model names only, so --dry-run works without a key.
  console.log(
    estimateLine(scenarios, answerGroup, options.runs, [
      {
        label: 'answers',
        model: sonnet
          ? process.env.KITE_MODEL_SMART || 'the smart model'
          : (answerModel ?? (process.env.KITE_MODEL_FAST || 'the fast model')),
      },
      ...(options.grade
        ? [{ label: 'grades', model: process.env.KITE_MODEL_SMART || 'the smart model' }]
        : []),
    ]),
  );
  if (options.dryRun) return;
  requireKey('eval-answers');
  const env = getClaudeEnv();
  const third = answerModel ? providerModel(answerModel) : null;
  const answeredBy = third ? third.modelId : sonnet ? env.modelSmart : env.modelFast;
  console.log(
    `eval-answers: answers by ${answeredBy}, ${options.grade ? `graded by ${env.modelSmart}` : 'not graded'}; ${scenarios.length} scenarios × ${options.runs} runs`,
  );
  const meter = createSpendMeter();
  const header =
    '| Scenario | Facts /3 | Grounded /2 | Consistent /2 | Style /1 | Headline /1 | Bullets /1 | Total /10 |';
  const rows: string[] = [];
  const results: ScenarioResult[] = [];
  let sum = 0;
  let stopped = 0;
  for (const scenario of scenarios) {
    // The developer's cap: stop before a scenario once the run has spent it (the table shows what ran).
    if (options.maxDollars !== null && meter.spent() >= options.maxDollars) {
      stopped += 1;
      continue;
    }
    const totals = { facts: 0, grounded: 0, consistent: 0, style: 0, headline: 0, bullets: 0 };
    const runs: ScenarioRunResult[] = [];
    for (let run = 1; run <= options.runs; run += 1) {
      const models = { fast: sonnet ? env.modelSmart : env.modelFast, smart: env.modelSmart };
      let answer = await answerScenario(
        scenario,
        models,
        options.withoutLessons,
        options.style,
        meter,
        theirName,
        undefined,
        third,
        spoken,
      );
      // Consistency: the first answer goes into the conversation, and the question comes again.
      const first = scenario.repeat
        ? { question: scenario.question, text: answer.text }
        : undefined;
      if (first)
        answer = await answerScenario(
          scenario,
          models,
          false,
          options.style,
          meter,
          theirName,
          first,
          third,
          spoken,
        );
      const { text, meta } = answer;
      // A garbled line must get no answer at all (ADR-0043): nothing to grade, and no grader's request
      // to pay for. It scores in full when Claude said so, and nothing when it answered anyway.
      const nothingToGrade =
        (meta?.type === 'garbled' || meta?.type === 'none') && text.trim() === '';
      const graded = nothingToGrade
        ? noAnswerGrade(scenario)
        : options.grade
          ? await grade(
              // ADR-0093: with --their-name the grader reads the same session line as the answer (the
              // other person is named), so using the name is not marked as invented.
              theirName
                ? { ...scenario, session: { ...scenario.session, themName: theirName } }
                : scenario,
              text,
              env.modelSmart,
              meter,
              first,
            )
          : UNGRADED;
      const shape = nothingToGrade
        ? { headline: 1, bullets: 1 }
        : shapeChecks(text, scenario.session.style.format, meta);
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
      const checks = await extraChecks(scenario, answer, graded, first);
      runs.push({
        run,
        scores,
        total: Object.values(scores).reduce((a, b) => a + b, 0),
        reason: graded.reason,
        checks: {
          ...checks,
          // ADR-0107: depth per question type, and empty answers (a card left with "…").
          depth: {
            ...answerDepth(text, meta?.type),
            ...(options.grade && !nothingToGrade ? { complete: graded.complete } : {}),
          },
          empty: !nothingToGrade && text.trim() === '',
        },
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
    // Without the grader its four scores and the total are not known.
    const graderCell = (n: number) => (options.grade ? cell(n) : '–');
    rows.push(
      `| ${scenario.id} | ${graderCell(totals.facts)} | ${graderCell(totals.grounded)} | ${graderCell(totals.consistent)} | ${graderCell(totals.style)} | ${cell(totals.headline)} | ${cell(totals.bullets)} | ${options.grade ? total.toFixed(1) : '–'} |`,
    );
  }
  console.log(`\n${header}\n|---|---|---|---|---|---|---|---|\n${rows.join('\n')}`);
  if (stopped > 0)
    console.log(`
Stopped at the --max-dollars cap: ${stopped} scenario(s) not run.`);
  const checkLines = summariseChecks(results);
  if (checkLines.length > 0) console.log(`\n${checkLines.join('\n')}`);
  const depthLines = summariseDepth(results);
  if (depthLines.length > 0) console.log(`\n${depthLines.join('\n')}`);
  console.log(
    options.grade
      ? `\nOverall: ${(sum / scenarios.length).toFixed(2)} / 10 (mean of ${scenarios.length} scenarios)`
      : '\nOverall: not graded (--no-grade): read the checks above, and the answers with --show',
  );
  const saved = saveEvalResults({
    evaluation: 'answers',
    only: options.only,
    withoutLessons: options.withoutLessons,
    style: options.style ?? 'current',
    finishedAt: new Date().toISOString(),
    model: answeredBy,
    grader: options.grade ? env.modelSmart : 'none (--no-grade)',
    overall: sum / scenarios.length,
    scenarios: results,
  });
  console.log(`Scores and grader reasons saved to ${saved}`);
  console.log(meter.finish(`answers ${options.only ?? 'all'}`));
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
