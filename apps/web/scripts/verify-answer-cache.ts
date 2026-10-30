/**
 * File: apps/web/scripts/verify-answer-cache.ts
 * Purpose: Developer-only check that the append-only conversation cache works against the real
 *          Claude API: warms an invented session, then asks 3 answers on an invented call whose
 *          conversation grows by one chunk per answer (each new chunk holds the previous answer
 *          and the lines said since), all through the real server code (buildPrompt,
 *          warmCache, streamReply). Prints only token counts and times.
 *          Pass = answer 1 reads at least the warm-up's write; answers 2 and 3 read at least
 *          everything the answer before them had cached (its read + its write); every answer's
 *          write is about the size of its new chunk only; the uncached input stays small.
 *          Usage: pnpm --filter web verify:answer-cache
 * Used by: the "verify:answer-cache" script in apps/web/package.json (run by a developer by
 *          hand; never in CI, because it calls the real API and needs the real key)
 * Depends on: src/server/prompt.ts (buildPrompt), src/server/claude.ts (warmCache,
 *             streamReply), src/server/env.ts (the fast model name), @kite/shared
 * Key: refuses to run without ANTHROPIC_API_KEY (scripts/lib/require-key.ts). A paid run: agree
 *      it, with its estimated cost, with the developer first (CLAUDE.md "Claude key and spend").
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (prompt caching);
 *               day-04-answers.md Stage 3; ADR-0025
 *
 * Runs like verify-warm.ts: tsx with `--env-file=.env.local` and `--conditions=react-server`.
 * It never prints the key, the prompt, the session, the conversation or the answers. Each run
 * adds a random reference number to the session, so call 1 never reads an earlier run's cache.
 */
import {
  estimateItemTokens,
  type AnswerRequest,
  type AnswerUsage,
  type ConversationChunk,
  type SessionContext,
} from '@kite/shared';
import { streamReply, warmCache } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { ANSWER_MAX_TOKENS, buildPrompt } from '@/server/prompt';
import { requireKey } from './lib/require-key';

/** Invented sentences the document is built from (no real company, person or customer). */
const SENTENCES = [
  'The Harbor Lane pilot covered four depots and ran for twelve weeks.',
  'Dispatchers planned routes each morning and adjusted them twice during the day.',
  'Average planning time fell from forty minutes to eighteen minutes per dispatcher.',
  'Late deliveries dropped by a third once live traffic re-routing was switched on.',
  'The team asked for single sign-on before the wider rollout could start.',
  'Training ran in groups of six, with one practice day before going live.',
  'The Professional plan costs 52 dollars per seat per month, billed yearly.',
  'The finance lead wanted yearly billing and a fixed price for two years.',
];

/**
 * The invented call, as the "Them"/"You" lines said before each of the 3 answers, with the
 * question each answer is asked. Times are seconds since the call connected.
 */
const CALL: { lines: [speaker: 'you' | 'them', text: string, at: number][]; question: string }[] = [
  {
    lines: [
      ['you', 'Thanks for joining, shall we go through the pilot results first?', 4],
      ['them', 'Yes please, the operations team wants to know how planning time changed.', 9],
      ['you', 'Planning time came down a lot, I can give you the exact numbers.', 15],
      ['them', 'Great. And what did the late deliveries look like after the switch?', 21],
      ['them', 'How much did planning time drop per dispatcher?', 28],
    ],
    question: 'How much did planning time drop per dispatcher?',
  },
  {
    lines: [
      ['you', 'It went from forty minutes to eighteen minutes per dispatcher.', 41],
      ['them', 'That is a big change. Our finance lead will ask about pricing next.', 50],
      ['them', 'She prefers yearly billing if the price is fixed for a while.', 58],
      ['you', 'That makes sense, we have done fixed pricing before.', 64],
      ['them', 'So what would the Professional plan cost for forty seats?', 72],
    ],
    question: 'What would the Professional plan cost for forty seats?',
  },
  {
    lines: [
      ['you', 'Forty seats on Professional would be two thousand and eighty a month.', 86],
      ['them', 'Okay. Before the wider rollout we need single sign-on working.', 97],
      ['them', 'And training, how would that work for our dispatchers?', 105],
      ['you', 'Training runs in small groups with a practice day.', 111],
      ['them', 'Remind me, could you hold that seat price for two years?', 118],
    ],
    question: 'Could you hold that seat price for two years?',
  },
];

/**
 * Builds the invented document: numbered paragraphs of the sentences above, about 2,000 words.
 *
 * @returns The document text.
 * Called from: main()
 */
function inventedDocument(): string {
  const paragraphs: string[] = [];
  for (let i = 1; i <= 20; i += 1) {
    const rotated = [...SENTENCES.slice(i % 8), ...SENTENCES.slice(0, i % 8)];
    paragraphs.push(`Section ${i}. ${rotated.join(' ')}`);
  }
  return paragraphs.join('\n\n');
}

/** One call's measured numbers. */
interface Measured {
  /** Token counts. */
  usage: AnswerUsage;
  /** Request start → first text, in ms (0 for the warm-up). */
  msFirstText: number;
  /** Request start → done, in ms. */
  msTotal: number;
  /** Estimated tokens of the chunk this answer added (0 for the warm-up). */
  newChunkTokens: number;
}

/**
 * Prints one call's numbers (counts and times only).
 *
 * @param label    'warm-up' or 'answer N'.
 * @param measured The numbers.
 * Called from: main()
 */
function print(label: string, measured: Measured): void {
  const { usage } = measured;
  console.log(
    `${label}: cache write ${usage.cache_creation_input_tokens}, cache read ${usage.cache_read_input_tokens}, uncached input ${usage.input_tokens}, output ${usage.output_tokens}, new chunk ~${measured.newChunkTokens} tokens (estimate), first text ${measured.msFirstText} ms, total ${measured.msTotal} ms`,
  );
}

/**
 * Runs the warm-up and the 3 answers, prints the numbers, then PASS or FAIL.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  requireKey('verify-answer-cache');
  const reference = crypto.randomUUID().slice(0, 8);
  const session: SessionContext = {
    type: 'sales',
    company: 'Harbor Lane Freight (invented)',
    role: 'Pilot review',
    description: `Invented test session, reference ${reference}.`,
    instructions: 'Keep answers short.',
    keyTerms: ['Harbor Lane', 'live re-routing', 'Professional plan'],
    style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
    documents: [{ name: 'pilot-report.txt', text: inventedDocument() }],
  };
  const model = getClaudeEnv().modelFast;
  console.log(`verify-answer-cache: model ${model}; warm-up, then ${CALL.length} answers`);

  // The warm-up, exactly as the live page sends it when it opens.
  const warmPrompt = buildPrompt({ mode: 'warm', session });
  const warmStarted = performance.now();
  const warm = await warmCache({ model, tier: 'fast', ...warmPrompt });
  const warmed: Measured = {
    usage: warm.usage,
    msFirstText: 0,
    msTotal: Math.round(performance.now() - warmStarted),
    newChunkTokens: 0,
  };
  print('warm-up', warmed);

  const conversation: ConversationChunk[] = [];
  const answers: Measured[] = [];
  let previous: { question: string; text: string; at: number } | null = null;
  for (const [index, step] of CALL.entries()) {
    // The new chunk: the previous answer (at its time), then the lines said since. All but the
    // question line are stable here; the question line goes in the uncached tail.
    const said = step.lines.slice(0, -1);
    const asked = step.lines.at(-1)!;
    const chunk: ConversationChunk = [
      ...(previous ? [{ kind: 'answer' as const, mode: 'answer' as const, ...previous }] : []),
      ...said.map(([speaker, text, at]) => ({ kind: 'line' as const, speaker, text, at })),
    ];
    conversation.push(chunk);
    const request: AnswerRequest = {
      mode: 'answer',
      session,
      // A copy, so later pushes cannot change what this request sent.
      conversation: conversation.map((sent) => [...sent]),
      tail: [{ speaker: asked[0], text: asked[1], at: asked[2] }],
      question: step.question,
    };
    const prompt = buildPrompt(request);
    const startedAt = performance.now();
    let firstTextAt: number | null = null;
    let text = '';
    const reply = streamReply({ model, tier: 'fast', ...prompt, maxTokens: ANSWER_MAX_TOKENS });
    let next = await reply.next();
    while (!next.done) {
      firstTextAt ??= performance.now();
      text += next.value;
      next = await reply.next();
    }
    const measured: Measured = {
      usage: next.value.usage,
      msFirstText: Math.round((firstTextAt ?? performance.now()) - startedAt),
      msTotal: Math.round(performance.now() - startedAt),
      newChunkTokens: chunk.reduce((total, item) => total + estimateItemTokens(item), 0),
    };
    answers.push(measured);
    print(`answer ${index + 1}`, measured);
    // Kept in memory for the next chunk; never printed.
    previous = { question: step.question, text, at: asked[2] + 1 };
  }

  // The checks. "About the size of the new chunk": the estimate is characters ÷ 4, so allow
  // twice it plus the block's few label tokens.
  const checks: [string, boolean][] = [];
  checks.push([
    'answer 1 reads at least the warm-up write',
    answers[0]!.usage.cache_read_input_tokens >= warmed.usage.cache_creation_input_tokens &&
      warmed.usage.cache_creation_input_tokens > 0,
  ]);
  for (let i = 1; i < answers.length; i += 1) {
    const before = answers[i - 1]!.usage;
    const now = answers[i]!.usage;
    checks.push([
      `answer ${i + 1} reads everything answer ${i} cached (${before.cache_read_input_tokens + before.cache_creation_input_tokens})`,
      now.cache_read_input_tokens >=
        before.cache_read_input_tokens + before.cache_creation_input_tokens,
    ]);
  }
  for (const [i, measured] of answers.entries()) {
    checks.push([
      `answer ${i + 1} writes only its new chunk (write ${measured.usage.cache_creation_input_tokens} ≤ ${2 * measured.newChunkTokens + 50})`,
      measured.usage.cache_creation_input_tokens > 0 &&
        measured.usage.cache_creation_input_tokens <= 2 * measured.newChunkTokens + 50,
    ]);
    checks.push([
      `answer ${i + 1} uncached input is small (${measured.usage.input_tokens} ≤ 300)`,
      measured.usage.input_tokens <= 300,
    ]);
  }
  for (const [label, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  const pass = checks.every(([, ok]) => ok);
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The error's name and status only: an API error message could quote the request.
  const status = (error as { status?: number }).status;
  console.error(
    `verify-answer-cache: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
