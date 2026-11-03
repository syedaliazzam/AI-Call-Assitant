/**
 * File: apps/web/scripts/record-answer-streams.ts
 * Purpose: Records real /api/answer streams (v1.0.2 stream format, ADR-0037) for the replay test
 *          tests/unit/core/answer/recorded-stream.test.ts: three invented eval scenarios (01–03,
 *          the same as the v1.0.0 recordings) go through the route's own pipeline, buildPrompt →
 *          streamReply → withAnswerMeta → toEventStream, and the exact bytes are saved as
 *          tests/fixtures/answers/real-stream-v102-*.sse. Prints, per answer, the time to the first
 *          word, whether the hidden last line (the cleaned question) arrived, and the cost; never
 *          prints answer text.
 *          Usage: pnpm --filter web record:streams [--dry-run]
 *          Paid: 3 requests to the fast model (about $0.002 at scripts/lib/spend.ts prices). Run it
 *          only after the developer agreed (CLAUDE.md "Claude key and spend").
 * Used by: the developer, before a release that changes the stream format
 * Depends on: src/server (prompt, claude, answer-meta, sse, env), scripts/lib (require-key, spend)
 * Architecture: docs/decisions/ADR-0037-clean-question-and-answer-card.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerRequest } from '@kite/shared';
import { withAnswerMeta } from '@/server/answer-meta';
import { streamReply } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { toEventStream } from '@/server/sse';
import type { Scenario } from '../tests/eval/groups/types';
import { requireKey } from './lib/require-key';
import { createSpendMeter, requestCost } from './lib/spend';

/** This script's folder. */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The invented scenarios recorded (the same three as the v1.0.0 recordings). */
const SCENARIOS = [
  '01-sales-pricing-from-document',
  '02-support-troubleshooting',
  '03-interview-question',
];

/** Where the recordings go. */
const FIXTURES = path.join(HERE, '..', 'tests', 'fixtures', 'answers');

/**
 * Builds the request a live Answer press would send for a scenario.
 *
 * @param scenario The scenario.
 * @returns The request.
 * Called from: main()
 */
function requestFor(scenario: Scenario): AnswerRequest {
  return {
    mode: 'answer',
    session: scenario.session,
    conversation: scenario.conversation,
    tail: scenario.tail,
    ...(scenario.question ? { question: scenario.question } : {}),
  };
}

/**
 * Records the three streams.
 *
 * @returns Nothing; exits non-zero when a recording has no question line or no text.
 * Called from: the command line
 */
async function main(): Promise<void> {
  console.info(`record-answer-streams: ${SCENARIOS.length} requests to the fast model (paid).`);
  if (process.argv.includes('--dry-run')) return;
  requireKey('record-answer-streams');
  const env = getClaudeEnv();
  const meter = createSpendMeter();
  let failed = false;
  for (const name of SCENARIOS) {
    const scenario = JSON.parse(
      readFileSync(path.join(HERE, '..', 'tests', 'eval', 'scenarios', `${name}.json`), 'utf8'),
    ) as Scenario;
    const prompt = buildPrompt(requestFor(scenario));
    const startedAt = performance.now();
    let firstWordMs: number | null = null;
    let sawQuestion = false;
    let cost = 0;
    const body = toEventStream(
      withAnswerMeta(
        streamReply({
          model: env.modelFast,
          tier: 'fast',
          system: prompt.system,
          messages: prompt.messages,
          maxTokens: ANSWER_MAX_TOKENS,
        }),
      ),
      {
        onDone: (result, stats) => {
          meter.add(env.modelFast, result.usage);
          cost = requestCost(env.modelFast, result.usage);
          if (stats.firstDeltaAt !== null) firstWordMs = Math.round(stats.firstDeltaAt - startedAt);
          return {
            type: 'done',
            usage: result.usage,
            ms: {
              auth: 0,
              toStreamOpen: 0,
              streamOpenToFirstText: 0,
              toFirstText: firstWordMs ?? 0,
              total: Math.round(performance.now() - startedAt),
            },
          };
        },
        onError: () => ({ type: 'error', code: 'internal', message: 'Recording failed.' }),
      },
    );
    const chunks: Uint8Array[] = [];
    const reader = body.getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      chunks.push(next.value);
    }
    const bytes = Buffer.concat(chunks);
    const text = bytes.toString('utf8');
    sawQuestion = text.includes('event: question\n');
    const ok = sawQuestion && text.includes('event: delta\n') && text.includes('event: done\n');
    failed ||= !ok;
    const file = path.join(FIXTURES, `real-stream-v102-${name}.sse`);
    writeFileSync(file, bytes);
    // Counts and times only: never the answer's words.
    console.info(
      `${name}: first word ${firstWordMs ?? '-'} ms, question line ${sawQuestion ? 'yes' : 'NO'}, ` +
        `$${cost.toFixed(4)}, saved ${path.basename(file)}`,
    );
  }
  console.info(meter.finish('record-answer-streams'));
  if (failed) {
    console.error('record-answer-streams: a recording is missing its question line or text.');
    process.exitCode = 1;
  }
}

void main();
