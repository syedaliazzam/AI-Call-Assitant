/**
 * File: apps/web/scripts/check-answer-shape.ts
 * Purpose: Checks the shape of real call answers (v1.0.3, ADR-0039): ONE short answer line to say
 *          at once (at most 12 words; never "Here are…", "based on my CV" or another meta opener;
 *          no "Answer:" label), then 2–4 bullets, then an optional Tip. Three invented questions
 *          (a list-type interview question, and the questions of eval scenarios 03 and 01) go
 *          through the route's pipeline (buildPrompt → streamReply → withAnswerMeta). Prints one
 *          line per answer (counts, the checks, time to first word, cost) and writes the answers
 *          to test-results/answer-shape.md (git-ignored) for the developer to read; never logs them.
 *          Usage: pnpm --filter web check:answer-shape [--dry-run]
 *          Paid: 3 requests to the fast model (well under $0.01). Run it only after the developer
 *          agreed (CLAUDE.md "Claude key and spend").
 * Used by: the developer, when the answer rules change
 * Depends on: src/server (prompt, claude, answer-meta, env), src/core/answer/format.ts,
 *             scripts/lib (require-key, spend)
 * Architecture: docs/decisions/ADR-0039-v1.0.3-overlay-fixes-and-visual-checks.md
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerRequest } from '@kite/shared';
import { splitAnswer } from '@/core/answer/format';
import { withAnswerMeta } from '@/server/answer-meta';
import { streamReply } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import type { Scenario } from '../tests/eval/groups/types';
import { requireKey } from './lib/require-key';
import { createSpendMeter, requestCost } from './lib/spend';

/** This script's folder. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Openers an answer line must never start with. */
export const META_OPENER =
  /^(?:here (?:are|is)|here's|so\b|well\b|sure\b|based on|according to|as per|answer\s*:|headline\s*:)/i;

/** Words that mention where the facts came from, never allowed in a spoken line. */
export const SOURCE_MENTION = /\b(?:my|the|your) (?:cv|resume|résumé|documents?|notes)\b/i;

/**
 * Reads an eval scenario.
 *
 * @param name Its file name without .json.
 * @returns The scenario.
 */
function scenario(name: string): Scenario {
  return JSON.parse(
    readFileSync(path.join(HERE, '..', 'tests', 'eval', 'scenarios', `${name}.json`), 'utf8'),
  ) as Scenario;
}

/**
 * The three checks: a list-type interview question on scenario 03's session, and the questions of
 * scenarios 03 and 01.
 *
 * @returns Name and request for each.
 */
function checks(): { name: string; request: AnswerRequest }[] {
  const interview = scenario('03-interview-question');
  const sales = scenario('01-sales-pricing-from-document');
  /**
   * The request a live Answer press would send.
   *
   * @param from     The scenario.
   * @param question The question to answer.
   * @returns The request.
   */
  const request = (from: Scenario, question: string): AnswerRequest => ({
    mode: 'answer',
    session: from.session,
    conversation: from.conversation,
    tail: from.tail,
    question,
  });
  return [
    {
      name: 'list-question',
      request: request(interview, 'What production-grade applications have you built?'),
    },
    { name: 'scenario-03', request: request(interview, interview.question ?? '') },
    { name: 'scenario-01', request: request(sales, sales.question ?? '') },
  ];
}

/** Runs the checks. */
async function main(): Promise<void> {
  const list = checks();
  console.info(`check-answer-shape: ${list.length} requests to the fast model (paid).`);
  if (process.argv.includes('--dry-run')) return;
  requireKey('check-answer-shape');
  const env = getClaudeEnv();
  const meter = createSpendMeter();
  const report: string[] = ['# Answer shape check (v1.0.3)', ''];
  let failed = false;
  for (const check of list) {
    const prompt = buildPrompt(check.request);
    const startedAt = performance.now();
    let firstWordMs: number | null = null;
    let text = '';
    const reply = withAnswerMeta(
      streamReply({
        model: env.modelFast,
        tier: 'fast',
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: ANSWER_MAX_TOKENS,
      }),
    );
    let next = await reply.next();
    for (; !next.done; next = await reply.next()) {
      if (typeof next.value !== 'string') continue;
      firstWordMs ??= Math.round(performance.now() - startedAt);
      text += next.value;
    }
    meter.add(env.modelFast, next.value.usage);
    const cost = requestCost(env.modelFast, next.value.usage);
    const parts = splitAnswer(text);
    const firstLine = text.trim().split('\n')[0] ?? '';
    const words = parts.headline.split(/\s+/).filter(Boolean).length;
    const problems = [
      ...(META_OPENER.test(firstLine.replace(/^[*#\s]+/, '')) ? ['meta opener'] : []),
      ...(words > 12 ? [`answer line ${words} words`] : []),
      ...(parts.bullets.length < 2 || parts.bullets.length > 4
        ? [`${parts.bullets.length} bullets`]
        : []),
      ...([parts.headline, ...parts.bullets, parts.tip].some((line) => SOURCE_MENTION.test(line))
        ? ['mentions the CV or documents']
        : []),
    ];
    failed ||= problems.length > 0;
    // Counts and checks only: never the answer's words.
    console.info(
      `${check.name}: answer line ${words} words, ${parts.bullets.length} bullets, tip ${parts.tip ? 'yes' : 'no'}, ` +
        `first word ${firstWordMs ?? '-'} ms, $${cost.toFixed(4)}: ${problems.length ? problems.join('; ') : 'OK'}`,
    );
    report.push(`## ${check.name}`, '', `Question: ${check.request.question}`, '', text.trim(), '');
  }
  console.info(meter.finish('check-answer-shape'));
  const out = path.join(HERE, '..', 'test-results');
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'answer-shape.md'), report.join('\n'));
  if (failed) process.exitCode = 1;
}

void main();
