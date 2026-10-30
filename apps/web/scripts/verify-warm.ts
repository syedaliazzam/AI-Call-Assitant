/**
 * File: apps/web/scripts/verify-warm.ts
 * Purpose: Developer-only check that the session prompt cache works against the real Claude API:
 *          builds an invented session with an invented ~2,000-word document using the real
 *          server code (buildPrompt + warmCache), warms it twice, and prints only token counts
 *          and times. Pass = call 1 writes the cache (write > 0, read 0), call 2 reads it
 *          (write 0, read = call 1's write), and neither call generates output.
 *          Usage: pnpm --filter web verify:warm
 * Used by: the "verify:warm" script in apps/web/package.json (run by a developer by hand; never
 *          in CI, because it calls the real API and needs the real key)
 * Depends on: src/server/prompt.ts (buildPrompt), src/server/claude.ts (warmCache),
 *             src/server/env.ts (the fast model name)
 * Key: refuses to run without ANTHROPIC_API_KEY (scripts/lib/require-key.ts). A paid run: agree
 *      it, with its estimated cost, with the developer first (CLAUDE.md "Claude key and spend").
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.3 (Pre-warm); day-03-sessions.md
 *               Stage 5 check
 *
 * Like create-admin, it runs with tsx, `--env-file=.env.local` (ANTHROPIC_API_KEY and the model
 * names from `vercel env pull`) and `--conditions=react-server` (so `server-only` loads outside
 * Next.js). It never prints the key, the prompt, the session or the document.
 *
 * Each run adds a random reference number to the invented session, so a run never reads the
 * cache entry of a run a few minutes earlier: call 1 is always a fresh write.
 */
import type { AnswerRequest } from '@kite/shared';
import { warmCache } from '@/server/claude';
import { getClaudeEnv } from '@/server/env';
import { buildPrompt } from '@/server/prompt';
import { requireKey } from './lib/require-key';

/** Invented sentences the document is built from (no real company, person or customer). */
const SENTENCES = [
  'The Harbor Lane pilot covered four depots and ran for twelve weeks.',
  'Dispatchers planned routes each morning and adjusted them twice during the day.',
  'Average planning time fell from forty minutes to eighteen minutes per dispatcher.',
  'Late deliveries dropped by a third once live traffic re-routing was switched on.',
  'The team asked for single sign-on before the wider rollout could start.',
  'Training ran in groups of six, with one practice day before going live.',
  'Support tickets were answered within one business day during the pilot.',
  'The finance lead wanted yearly billing and a fixed price for two years.',
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

/**
 * Warms the invented session twice and prints the counts, then PASS or FAIL.
 *
 * @returns Nothing; sets a non-zero exit code on failure.
 * Called from: the bottom of this file
 */
async function main(): Promise<void> {
  requireKey('verify-warm');
  const document = inventedDocument();
  const reference = crypto.randomUUID().slice(0, 8);
  const request: AnswerRequest = {
    mode: 'warm',
    session: {
      type: 'sales',
      company: 'Harbor Lane Freight (invented)',
      role: 'Pilot review',
      description: `Invented test session, reference ${reference}.`,
      instructions: 'Keep answers short.',
      keyTerms: ['Harbor Lane', 'live re-routing'],
      style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
      documents: [{ name: 'pilot-report.txt', text: document }],
    },
  };
  const prompt = buildPrompt(request);
  const model = getClaudeEnv().modelFast;
  console.log(
    `verify-warm: model ${model}; invented document ${document.split(/\s+/).length} words`,
  );

  const calls = [];
  for (let i = 1; i <= 2; i += 1) {
    const startedAt = performance.now();
    const { usage, stopReason } = await warmCache({
      model,
      tier: 'fast',
      system: prompt.system,
      messages: prompt.messages,
    });
    const ms = Math.round(performance.now() - startedAt);
    calls.push(usage);
    console.log(
      `call ${i}: cache_creation_input_tokens ${usage.cache_creation_input_tokens}, cache_read_input_tokens ${usage.cache_read_input_tokens}, output_tokens ${usage.output_tokens}, ${ms} ms (stop ${stopReason})`,
    );
  }

  const [first, second] = calls as [(typeof calls)[0], (typeof calls)[0]];
  const pass =
    first.cache_creation_input_tokens > 0 &&
    first.cache_read_input_tokens === 0 &&
    second.cache_creation_input_tokens === 0 &&
    second.cache_read_input_tokens === first.cache_creation_input_tokens &&
    first.output_tokens === 0 &&
    second.output_tokens === 0;
  console.log(pass ? 'PASS' : 'FAIL');
  if (!pass) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The error's name and status only: an API error message could quote the request.
  const status = (error as { status?: number }).status;
  console.error(
    `verify-warm: failed (${error instanceof Error ? error.name : 'unknown'}${status ? `, HTTP ${status}` : ''})`,
  );
  process.exitCode = 1;
});
