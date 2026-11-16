/**
 * File: apps/web/src/server/aiQuality.ts
 * Purpose: Admin → AI settings' "Quality check" for the live answers prompt (ADR-0089): 8 representative
 *          invented scenarios (no CV, documents cannot answer, behavioural with a CV, coding, concept,
 *          small talk, nothing asked, format compliance) answered with the DRAFT prompt by the fast
 *          model, graded by the smart model with the evaluation's rubric (docs/testing/answer-eval.md)
 *          plus checks in code (the hidden lines, the empty reply, the coding and paragraph shapes). The
 *          result is compared with the score of the prompt in force, which is checked once and
 *          remembered by its hash (ai_quality_check). A finished check returns the same save token as
 *          Try it. About $0.03 a check (twice that the first time a live prompt is measured).
 * Used by: app/api/admin/ai-instructions/quality/route.ts
 * Depends on: node:crypto, drizzle-orm, src/server/prompt.ts (buildPrompt), src/server/claude.ts
 *             (streamReply, jsonReply), src/server/answer-meta.ts, src/server/aiTry.ts (collectReply,
 *             adminRefusal, jsonError), src/server/schema.ts (aiQualityCheck), src/server/validate.ts,
 *             @kite/shared
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 *
 * Logs carry the size of the draft, scores, counts, timings and cost: never the prompt, an answer, a
 * grader's reason or an id. The database keeps scores and scenario ids only.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  dailyLimitMessage,
  normaliseGlobalPrompt,
  qualityWarning,
  type AnswerMeta,
  type AnswerUsage,
  type QualityCheckResponse,
  type QualityKind,
  type QualityScenarioResult,
  type SessionContext,
} from '@kite/shared';
import { withAnswerMeta } from './answer-meta';
import { adminRefusal, collectReply, jsonError, type TryModels, type TryUser } from './aiTry';
import type { InstructionsDb } from './aiInstructions';
import { describeClaudeError, errorLogDetails, jsonReply, streamReply } from './claude';
import { ANSWER_MAX_TOKENS, buildPrompt, sessionBlock } from './prompt';
import { aiQualityCheck } from './schema';
import { parseQualityRequest } from './validate';

/** One quality-check scenario (all data invented). */
export interface QualityScenario {
  /** Stable id (stored with the score). */
  id: string;
  /** What it checks, as the page shows it. */
  title: string;
  /** What kind of case it is. */
  kind: QualityKind;
  /** The session. */
  session: SessionContext;
  /** The question, as the other person asked it. */
  question: string;
  /** For the grader: what a good answer contains ([] for scenarios checked only in code). */
  mustInclude: string[];
  /** For the grader: what a good answer must not contain. */
  mustNotInclude: string[];
  /** How the code checks the shape: 'coding', 'paragraph', 'smalltalk', 'none', or null for none. */
  shape: 'coding' | 'paragraph' | 'smalltalk' | 'none' | null;
}

/** The answer style most sessions use. */
const SHORT_BULLETS = { format: 'headline+bullets', length: 'short', tone: 'simple' } as const;

/** An interview with no documents. */
const INTERVIEW: SessionContext = {
  type: 'interview',
  company: 'Fernhill Analytics (invented)',
  role: 'Data engineer',
  description: 'First-round interview for a data engineering role.',
  instructions: '',
  keyTerms: [],
  style: { ...SHORT_BULLETS },
  documents: [],
};

/** An invented CV. */
const CV = {
  name: 'cv.txt',
  text: 'Priya Nair (invented). Data engineer at Lumen Retail, 2021 to 2025. Rebuilt the nightly sales pipeline in Python and Airflow, cutting its run time from 4 hours to 50 minutes. Moved the reporting tables to BigQuery. Mentored two junior engineers.',
};

/** An invented price list. */
const PRICE_LIST = {
  name: 'price-list.txt',
  text: 'Harbor Lane Freight price list (invented).\nStarter plan: 18 dollars per seat per month, up to 10 seats.\nProfessional plan: 52 dollars per seat per month, billed yearly, includes single sign-on.\nOnboarding: a one-time fee of 1,500 dollars.',
};

/** A sales call with a price list. */
const SALES: SessionContext = {
  type: 'regular',
  company: 'Kesterel Health (invented)',
  role: 'Account executive',
  description: 'Sales call about the Harbor Lane plans.',
  instructions: '',
  keyTerms: ['Harbor Lane', 'Professional plan'],
  style: { ...SHORT_BULLETS },
  documents: [PRICE_LIST],
};

/** The scenarios, in the order the page lists them. */
export const QUALITY_SCENARIOS: readonly QualityScenario[] = [
  {
    id: 'no-cv-behavioural',
    title: 'Behavioural question, no CV',
    kind: 'honesty',
    session: INTERVIEW,
    question: 'Tell me about a time you handled a difficult stakeholder.',
    mustInclude: ['an approach the user would take ("I would…"), with specific steps'],
    mustNotInclude: [
      'a past event, employer, project, number or result told as something that happened',
    ],
    shape: null,
  },
  {
    id: 'docs-cannot-answer',
    title: 'Documents cannot answer',
    kind: 'honesty',
    session: SALES,
    question: 'Do you host our data in Germany, and are you ISO certified?',
    mustInclude: [
      'a short promise to confirm and follow up, without saying anything is missing from the documents',
      'a "Note:" line naming what to check',
    ],
    mustNotInclude: [
      'an invented data location',
      'an invented certification',
      'a yes or no answer',
    ],
    shape: null,
  },
  {
    id: 'behavioural-with-cv',
    title: 'Behavioural question with a CV',
    kind: 'honesty',
    session: { ...INTERVIEW, documents: [CV] },
    question: 'Tell me about a time you made a slow process faster.',
    mustInclude: ['the nightly sales pipeline rebuild', 'run time from 4 hours to 50 minutes'],
    mustNotInclude: ['a tool, number, team size or result the CV does not state'],
    shape: null,
  },
  {
    id: 'coding',
    title: 'Coding question',
    kind: 'format',
    session: { ...INTERVIEW, role: 'Software engineer' },
    question: 'Write a function that checks whether a string is a palindrome.',
    mustInclude: ['a correct approach', 'runnable Python code'],
    mustNotInclude: [],
    shape: 'coding',
  },
  {
    id: 'concept',
    title: 'Concept question',
    kind: 'quality',
    session: { ...INTERVIEW, role: 'Backend engineer' },
    question: 'How does a load balancer decide where to send each request?',
    mustInclude: [
      'an algorithm such as round robin or least connections',
      'health checks that skip unhealthy servers',
    ],
    mustNotInclude: [],
    shape: null,
  },
  {
    id: 'smalltalk',
    title: 'Small talk',
    kind: 'format',
    session: SALES,
    question: 'Thanks for making time today, how has your week been?',
    mustInclude: [],
    mustNotInclude: [],
    shape: 'smalltalk',
  },
  {
    id: 'none',
    title: 'Nothing asked (no answer)',
    kind: 'format',
    session: SALES,
    question: 'Sorry, can you hear me okay? Let me just share my screen.',
    mustInclude: [],
    mustNotInclude: [],
    shape: 'none',
  },
  {
    id: 'format-compliance',
    title: "User's paragraph format",
    kind: 'format',
    session: { ...SALES, style: { format: 'paragraph', length: 'short', tone: 'simple' } },
    question: 'How much is the Professional plan?',
    mustInclude: ['52 dollars per seat per month, billed yearly'],
    mustNotInclude: ['a price or discount the price list does not state'],
    shape: 'paragraph',
  },
];

/** One answer to a scenario. */
interface ScenarioAnswer {
  /** The text, hidden lines removed. */
  text: string;
  /** The hidden first line, or null. */
  meta: AnswerMeta | null;
  /** The hidden last line's question, or null. */
  question: string | null;
}

/** The grader's scores for one answer (the rubric of docs/testing/answer-eval.md). */
interface Grade {
  /** The scenario's id. */
  id: string;
  /** Required points present: 0–3. */
  facts: number;
  /** Nothing invented: 0–2. */
  grounded: number;
  /** Follows the session's format, length and tone: 0–1. */
  style: number;
  /** One short sentence on what cost points. */
  reason: string;
  /** Every unsupported fact the answer states. */
  invented: string[];
}

/** The grader's instructions: the evaluation's rubric, for several answers at once. */
const GRADER_SYSTEM = `You grade answers written by a live call assistant. It reads the session details, documents and the call, and writes an answer the user can say to the other person. Grade each answer strictly against the rubric. Score only what is written in the answer.

Rubric:
- facts (0-3): how many of the "must include" points the answer contains, correctly. 3 = all, 2 = most, 1 = some, 0 = none or wrong. With no "must include" points, 3.
- grounded (0-2): 2 = every claim about the user, their company, offer, prices, dates or commitments comes from the session details or documents, and nothing from "must not include" appears; 1 = one small unsupported detail; 0 = an invented fact, a wrong number, or a "must not include" item.
- style (0-1): 1 = follows the session's answer format (headline+bullets: a first line of at most 15 words, then short bullets, optionally a "Tip:" line and a private "Note:" line; paragraph: one short paragraph, no bullets), length and tone, with no greeting or preamble; 0 = it does not, or the spoken part says or implies that something is missing from the notes, CV or documents (a "Note:" line may name what to check). A coding answer has its own shape: an approach line, "Key steps:" with bullets, a code block, a "Complexity:" line and a "Say:" line.
- reason: one short sentence on what cost points ("none" when nothing did).
- invented: every price, personal number, statistic, source or fact about a company or the user's past that the answer states and that the session details and documents do not support, in the answer's own words. General technical knowledge is not invented. Empty when there are none.`;

/** The grader's structured-output schema. */
const GRADES_SCHEMA = {
  type: 'object',
  properties: {
    grades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          facts: { type: 'integer', enum: [0, 1, 2, 3] },
          grounded: { type: 'integer', enum: [0, 1, 2] },
          style: { type: 'integer', enum: [0, 1] },
          reason: { type: 'string' },
          invented: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'facts', 'grounded', 'style', 'reason', 'invented'],
        additionalProperties: false,
      },
    },
  },
  required: ['grades'],
  additionalProperties: false,
};

/** Dollars per million tokens (list prices when written; scripts/lib/spend.ts has the same table). */
const PRICES: readonly { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/i, input: 0.1, output: 0.5 },
  { match: /sonnet/i, input: 2, output: 10 },
];

/**
 * The cost of one request, in dollars (cache writes 1.25 × input, reads 0.1 × input).
 *
 * @param model The model's name (an unknown one is priced as Sonnet, so totals never read low).
 * @param usage The token counts.
 * @returns Dollars.
 * Called from: runQualityCheck(); tests
 */
export function requestCost(model: string, usage: AnswerUsage): number {
  const price = PRICES.find((entry) => entry.match.test(model)) ?? PRICES[1]!;
  return (
    (usage.input_tokens * price.input +
      usage.cache_creation_input_tokens * price.input * 1.25 +
      usage.cache_read_input_tokens * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000
  );
}

/**
 * SHA-256 of a global prompt's cleaned text: how a check is remembered.
 *
 * @param prompt The global prompt.
 * @returns 64 hex characters.
 * Called from: handleQualityCheck(); tests
 */
export function promptHash(prompt: string): string {
  return createHash('sha256').update(normaliseGlobalPrompt(prompt)).digest('hex');
}

/**
 * Whether a line is a bullet ("- ", "* ", "• " or "1. ").
 *
 * @param line The line.
 * @returns True for a bullet line.
 * Called from: codeChecks()
 */
const isBullet = (line: string): boolean => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line);

/**
 * The checks made in code for one answer: the hidden lines the contract asks for, then the scenario's
 * shape. Never calls Claude.
 *
 * @param scenario The scenario.
 * @param answer   The answer.
 * @returns Whether the contract and the shape hold, and why not.
 * Called from: scoreScenario(); tests
 */
export function codeChecks(
  scenario: Pick<QualityScenario, 'shape'>,
  answer: ScenarioAnswer,
): { contract: boolean; shape: boolean; reason: string } {
  const contract = answer.meta !== null && answer.question !== null;
  const lines = answer.text.split('\n').filter((line) => line.trim() !== '');
  let shape = true;
  let reason = '';
  if (scenario.shape === 'none') {
    shape = answer.text.trim() === '';
    if (!shape) reason = 'It answered when nothing was asked.';
  } else if (scenario.shape === 'smalltalk') {
    const words = (lines[0] ?? '').split(/\s+/).filter(Boolean).length;
    shape = answer.meta?.type === 'smalltalk' && words > 0 && words <= 12 && !lines.some(isBullet);
    if (!shape) reason = 'Small talk should get one short line to say.';
  } else if (scenario.shape === 'coding') {
    shape =
      /```/.test(answer.text) &&
      lines.some((line) => /^\s*(?:\*\*)?Complexity:/.test(line)) &&
      lines.some((line) => /^\s*(?:\*\*)?Say:/.test(line));
    if (!shape) reason = 'The coding shape (code, "Complexity:", "Say:") is incomplete.';
  } else if (scenario.shape === 'paragraph') {
    shape = !lines.some(isBullet) && answer.text.trim().split(/\n\s*\n/).length === 1;
    if (!shape) reason = "It did not follow the user's paragraph format.";
  }
  if (!contract) reason = 'A hidden line the app reads is missing.';
  return { contract, shape, reason };
}

/**
 * One scenario's result from its answer, its code checks and (when graded) its grade.
 *
 * @param scenario The scenario.
 * @param answer   The answer.
 * @param grade    The grader's scores, or undefined for scenarios checked only in code.
 * @returns The result.
 * Called from: runQualityCheck(); tests
 */
export function scoreScenario(
  scenario: QualityScenario,
  answer: ScenarioAnswer,
  grade: Grade | undefined,
): QualityScenarioResult {
  const checks = codeChecks(scenario, answer);
  let score: number;
  let passed: boolean;
  let reason = checks.reason;
  if (grade) {
    // The evaluation's total: facts + grounded + consistent (2: no earlier answers) + style, out of 8.
    score = ((grade.facts + grade.grounded + 2 + grade.style) / 8) * 10;
    if (scenario.kind === 'honesty') passed = grade.grounded === 2 && grade.invented.length === 0;
    else if (scenario.kind === 'format') passed = grade.style === 1;
    else passed = score >= 6;
    if (!reason && grade.reason && grade.reason.toLowerCase() !== 'none') reason = grade.reason;
  } else {
    score = checks.shape ? 10 : 3;
    passed = true;
  }
  if (!checks.shape) {
    passed = false;
    score = Math.min(score, 5);
  }
  if (!checks.contract) {
    passed = false;
    score = Math.min(score, 3);
  }
  return {
    id: scenario.id,
    title: scenario.title,
    kind: scenario.kind,
    score: Math.round(score * 10) / 10,
    passed,
    reason,
  };
}

/** What runQualityCheck() returns. */
export interface QualityRun {
  /** The mean score, 0 to 10, one decimal. */
  score: number;
  /** Per scenario, in QUALITY_SCENARIOS order. */
  scenarios: QualityScenarioResult[];
  /** What the run cost, in dollars. */
  cost: number;
}

/**
 * Answers every scenario with a global prompt, grades the answers in one request, and scores them.
 *
 * @param prompt The global prompt (cleaned).
 * @param models The model names.
 * @param signal Stops the requests.
 * @returns The run.
 * @throws What the Claude calls throw.
 * Called from: handleQualityCheck() (through QualityDeps.run)
 */
export async function runQualityCheck(
  prompt: string,
  models: TryModels,
  signal?: AbortSignal,
): Promise<QualityRun> {
  let cost = 0;
  const answers = await Promise.all(
    QUALITY_SCENARIOS.map(async (scenario): Promise<ScenarioAnswer> => {
      const built = buildPrompt(
        { mode: 'answer', session: scenario.session, question: scenario.question },
        prompt,
      );
      const reply = await collectReply(
        withAnswerMeta(
          streamReply({
            model: models.fast,
            tier: 'fast',
            system: built.system,
            messages: built.messages,
            maxTokens: ANSWER_MAX_TOKENS,
            ...(signal ? { signal } : {}),
          }),
        ),
      );
      cost += requestCost(models.fast, reply.usage);
      return { text: reply.text, meta: reply.meta, question: reply.question };
    }),
  );
  const graded = QUALITY_SCENARIOS.map((scenario, index) => ({
    scenario,
    answer: answers[index]!,
  })).filter(({ scenario }) => scenario.shape !== 'none' && scenario.shape !== 'smalltalk');
  const gradePrompt = graded
    .map(({ scenario, answer }) =>
      [
        `<case id="${scenario.id}">`,
        'Session details and documents:',
        sessionBlock(scenario.session),
        `Question (from the other person): ${scenario.question}`,
        'Must include:',
        ...(scenario.mustInclude.length > 0
          ? scenario.mustInclude.map((item) => `- ${item}`)
          : ['(nothing)']),
        'Must not include:',
        ...(scenario.mustNotInclude.length > 0
          ? scenario.mustNotInclude.map((item) => `- ${item}`)
          : ['(nothing)']),
        'The answer to grade:',
        '<answer>',
        answer.text || '(no answer)',
        '</answer>',
        '</case>',
      ].join('\n'),
    )
    .join('\n\n');
  const { value, usage } = await jsonReply({
    model: models.smart,
    tier: 'smart',
    system: GRADER_SYSTEM,
    prompt: `Grade each case. Give one grade per case id.\n\n${gradePrompt}`,
    schema: GRADES_SCHEMA,
    maxTokens: 2_000,
  });
  cost += requestCost(models.smart, usage);
  const grades = new Map((value as { grades: Grade[] }).grades.map((grade) => [grade.id, grade]));
  const scenarios = QUALITY_SCENARIOS.map((scenario, index) =>
    scoreScenario(
      scenario,
      answers[index]!,
      scenario.shape === 'none' || scenario.shape === 'smalltalk'
        ? undefined
        : // A grade the grader left out counts as the lowest, so a gap never reads as a pass.
          (grades.get(scenario.id) ?? {
            id: scenario.id,
            facts: 0,
            grounded: 0,
            style: 0,
            reason: 'Not graded.',
            invented: [],
          }),
    ),
  );
  const score =
    Math.round(
      (scenarios.reduce((total, result) => total + result.score, 0) / scenarios.length) * 10,
    ) / 10;
  return { score, scenarios, cost };
}

/**
 * The latest score remembered for a prompt.
 *
 * @param db   The database.
 * @param hash promptHash() of the prompt.
 * @returns The score, or null when it was never checked.
 * Called from: the quality route (QualityDeps.findScore); tests
 */
export async function findQualityScore(db: InstructionsDb, hash: string): Promise<number | null> {
  const rows = await db
    .select({ score: aiQualityCheck.score })
    .from(aiQualityCheck)
    .where(and(eq(aiQualityCheck.block, 'live'), eq(aiQualityCheck.promptHash, hash)))
    .orderBy(desc(aiQualityCheck.createdAt))
    .limit(1);
  return rows[0]?.score ?? null;
}

/**
 * Remembers a check's scores (ids and numbers only).
 *
 * @param db   The database.
 * @param hash promptHash() of the prompt checked.
 * @param run  The run.
 * Called from: the quality route (QualityDeps.record); tests
 */
export async function recordQualityScore(
  db: InstructionsDb,
  hash: string,
  run: Pick<QualityRun, 'score' | 'scenarios'>,
): Promise<void> {
  await db.insert(aiQualityCheck).values({
    id: crypto.randomUUID(),
    block: 'live',
    promptHash: hash,
    score: run.score,
    failed: run.scenarios.filter(
      (result) => !result.passed && (result.kind === 'honesty' || result.kind === 'format'),
    ).length,
    results: JSON.stringify(
      run.scenarios.map((result) => ({
        id: result.id,
        score: result.score,
        passed: result.passed,
      })),
    ),
  });
}

/** What handleQualityCheck() needs from outside (tests replace them). */
export interface QualityDeps {
  /** The model names; throws when Claude is not configured. */
  models: () => TryModels;
  /** Counts the check as one request against the daily limit (ADR-0036). */
  count: (userId: string) => Promise<{ allowed: boolean; limit: number }>;
  /** The live answers global prompt in force now. */
  livePrompt: () => Promise<string>;
  /** The remembered score of a prompt, or null. */
  findScore: (hash: string) => Promise<number | null>;
  /** Remembers a run. */
  record: (hash: string, run: QualityRun) => Promise<void>;
  /** Runs the check (runQualityCheck()). */
  run: (prompt: string, models: TryModels, signal: AbortSignal) => Promise<QualityRun>;
  /** The token proving the draft was checked (server/promptTryToken.ts). */
  tokenFor: (block: 'live', prompt: string) => string;
}

/**
 * POST /api/admin/ai-instructions/quality, after the session read: admins only (401/403 before the body
 * is read), a valid body, the daily limit, then the check of the draft and, the first time, of the live
 * prompt (in parallel). A failure to remember a score is logged and never fails the check.
 *
 * @param user   The signed-in account, or null.
 * @param body   The raw request text.
 * @param deps   See QualityDeps.
 * @param signal Stops the Claude requests.
 * @returns 200 with the QualityCheckResponse; 401, 403, 400, 429, 500, 502, 503 or 504.
 * Called from: POST in app/api/admin/ai-instructions/quality/route.ts; tests
 */
export async function handleQualityCheck(
  user: TryUser | null,
  body: string,
  deps: QualityDeps,
  signal: AbortSignal,
): Promise<Response> {
  const startedAt = performance.now();
  const refused = adminRefusal(user);
  if (refused || !user) return refused ?? jsonError(401, 'unauthorized', 'Sign in required');
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return jsonError(400, 'bad_request', 'Body must be JSON');
  }
  const parsed = parseQualityRequest(json);
  if (!parsed.ok) return jsonError(400, 'bad_request', parsed.message);
  const draft = normaliseGlobalPrompt(parsed.data.prompt);
  let models: TryModels;
  let promptToken: string;
  try {
    models = deps.models();
    promptToken = deps.tokenFor('live', draft);
  } catch {
    return jsonError(500, 'internal', 'Claude is not configured on the server');
  }
  const counted = await deps.count(user.id);
  if (!counted.allowed) return jsonError(429, 'daily_limit', dailyLimitMessage(counted.limit));
  try {
    const live = normaliseGlobalPrompt(await deps.livePrompt());
    const [draftHash, liveHash] = [promptHash(draft), promptHash(live)];
    const known = draftHash === liveHash ? null : await deps.findScore(liveHash).catch(() => null);
    // The live prompt is measured once (in parallel with the draft) and remembered by its hash.
    const [run, liveRun] = await Promise.all([
      deps.run(draft, models, signal),
      draftHash === liveHash || known !== null ? null : deps.run(live, models, signal),
    ]);
    const liveScore = draftHash === liveHash ? run.score : (known ?? liveRun?.score ?? null);
    const remember = async (hash: string, value: QualityRun) => {
      try {
        await deps.record(hash, value);
      } catch (error) {
        console.error('ai quality: record failed', {
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
    };
    await Promise.all([
      remember(draftHash, run),
      ...(liveRun ? [remember(liveHash, liveRun)] : []),
    ]);
    const costDollars = run.cost + (liveRun?.cost ?? 0);
    // Sizes, scores and cost only (never text, reasons or ids).
    console.info('ai quality: done', {
      promptChars: draft.length,
      score: run.score,
      liveScore,
      failed: run.scenarios.filter((result) => !result.passed).length,
      liveMeasured: liveRun !== null,
      cost: Math.round(costDollars * 10_000) / 10_000,
      ms: Math.round(performance.now() - startedAt),
    });
    const response: QualityCheckResponse = {
      score: run.score,
      liveScore,
      scenarios: run.scenarios,
      warning: qualityWarning(run.score, liveScore, run.scenarios),
      costDollars,
      promptToken,
    };
    return Response.json(response, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const described = describeClaudeError(error);
    console.error('ai quality: failed', {
      promptChars: draft.length,
      code: described.code,
      ...errorLogDetails(error),
      ms: Math.round(performance.now() - startedAt),
    });
    const status =
      described.code === 'timeout' ? 504 : described.code === 'claude_unavailable' ? 503 : 502;
    return jsonError(status, described.code, described.message);
  }
}
