/**
 * File: apps/web/scripts/verify-screenshot.ts
 * Purpose: Developer-only check of screenshot answers against the real Claude API: warms an
 *          invented session with a short invented call (the conversation's cache entry), then
 *          sends a screenshot answer (the invented slide in tests/eval/images) through the real
 *          server code (buildPrompt, streamReply). Prints only token counts, sizes and times.
 *          Pass = the answer streams text, and its cached blocks are read (cache read ≥ the
 *          warm-up's write; the screenshot itself is never cached).
 *          Usage: pnpm --filter web verify:screenshot
 * Used by: the "verify:screenshot" script in apps/web/package.json (by hand; never in CI)
 * Depends on: src/server/prompt.ts (buildPrompt), src/server/claude.ts (warmCache, streamReply),
 *             src/server/env.ts, @kite/shared
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3, §7.2 (screenshot requests);
 *               day-05-overlay-screenshots-notes.md Stage 2
 *
 * Runs like verify-warm.ts (tsx, `--env-file=.env.local`, `--conditions=react-server`). Never
 * prints the key, the prompt, the image or the answer.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnswerRequest, ConversationChunk, SessionContext } from '@kite/shared';
import { streamReply, warmCache } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';

/** The invented slide (scripts/make-eval-images.ts). */
const IMAGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'eval',
  'images',
  'slide-numbers.jpg',
);

/**
 * Warms, answers from the screenshot, and prints the numbers, then PASS or FAIL.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  const reference = crypto.randomUUID().slice(0, 8);
  const sentence =
    'The Harbor Lane renewal covers dispatch seats, single sign-on and live re-routing for all four depots.';
  const session: SessionContext = {
    type: 'sales',
    company: 'Harbor Lane Freight (invented)',
    role: 'Renewal',
    description: `Invented screenshot test session, reference ${reference}.`,
    instructions: 'Keep answers short.',
    keyTerms: ['Harbor Lane'],
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    // About 900 words, so the cached prefix is well above the caching minimum.
    documents: [{ name: 'notes.txt', text: Array.from({ length: 60 }, () => sentence).join(' ') }],
  };
  const conversation: ConversationChunk[] = [
    [
      { kind: 'line', speaker: 'them', text: 'LET ME SHARE OUR RENEWAL SUMMARY', at: 30 },
      { kind: 'line', speaker: 'you', text: 'SURE GO AHEAD', at: 33 },
    ],
  ];
  const model = getClaudeEnv().modelFast;
  const bytes = readFileSync(IMAGE);
  console.log(`verify-screenshot: model ${model}; image ${bytes.length} bytes (invented slide)`);

  const warm = await warmCache({
    model,
    tier: 'fast',
    ...buildPrompt({ mode: 'warm', session, conversation }),
  });
  console.log(
    `warm-up: cache write ${warm.usage.cache_creation_input_tokens}, read ${warm.usage.cache_read_input_tokens}`,
  );

  const request: AnswerRequest = {
    mode: 'screenshot',
    session,
    conversation,
    tail: [{ speaker: 'them', text: 'SO DO THESE NUMBERS LOOK RIGHT TO YOU', at: 41 }],
    image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
  };
  const startedAt = performance.now();
  let firstTextAt: number | null = null;
  let chars = 0;
  const reply = streamReply({
    model,
    tier: 'fast',
    ...buildPrompt(request),
    maxTokens: ANSWER_MAX_TOKENS,
  });
  let next = await reply.next();
  while (!next.done) {
    firstTextAt ??= performance.now();
    chars += next.value.length;
    next = await reply.next();
  }
  const { usage } = next.value;
  const cachedBefore = warm.usage.cache_creation_input_tokens + warm.usage.cache_read_input_tokens;
  console.log(
    `screenshot answer: cache read ${usage.cache_read_input_tokens}, write ${usage.cache_creation_input_tokens}, uncached input ${usage.input_tokens} (includes the image), output ${usage.output_tokens}, ${chars} characters, first text ${Math.round((firstTextAt ?? performance.now()) - startedAt)} ms, total ${Math.round(performance.now() - startedAt)} ms`,
  );
  const checks: [string, boolean][] = [
    ['the answer streamed text', chars > 0 && usage.output_tokens > 0],
    [
      `the cached blocks were read (${usage.cache_read_input_tokens} ≥ ${cachedBefore})`,
      cachedBefore > 0 && usage.cache_read_input_tokens >= cachedBefore,
    ],
    ['the screenshot was not cached (no new write)', usage.cache_creation_input_tokens === 0],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  const pass = checks.every(([, ok]) => ok);
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const status = (error as { status?: number }).status;
  console.error(
    `verify-screenshot: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
