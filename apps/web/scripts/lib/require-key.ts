/**
 * File: apps/web/scripts/lib/require-key.ts
 * Purpose: The first step of every developer script that calls Claude (verify-* and eval-*):
 *          stop at once when ANTHROPIC_API_KEY is missing from apps/web/.env.local. Kite uses
 *          one Claude key for production, development and these scripts, under one Console
 *          spend limit (CLAUDE.md "Claude key and spend"); each paid run is agreed with the
 *          developer first, with its estimated cost. Never prints the key.
 * Used by: scripts/verify-warm.ts, verify-answer-cache.ts, verify-screenshot.ts,
 *          verify-notes.ts, eval-answers.ts, eval-notes.ts
 * Depends on: nothing
 * Architecture: CLAUDE.md "Claude key and spend"
 */

/**
 * Says why the key is missing.
 *
 * @param env The variables (normally process.env, loaded from apps/web/.env.local).
 * @returns The reason, or null when a key is set.
 * Called from: requireKey(); tests
 */
export function missingKeyReason(env: Readonly<Record<string, string | undefined>>): string | null {
  return env.ANTHROPIC_API_KEY?.trim()
    ? null
    : 'ANTHROPIC_API_KEY is missing from apps/web/.env.local (run `vercel env pull apps/web/.env.local`).';
}

/**
 * Refuses to go on without a key: prints why and exits with code 1.
 *
 * @param script The script's name, for the printed line.
 * @returns When a key is set.
 * Called from: main() of each verify-* and eval-* script
 */
export function requireKey(script: string): void {
  const reason = missingKeyReason(process.env);
  if (reason) {
    console.error(`${script}: refused: ${reason}`);
    process.exit(1);
  }
}
