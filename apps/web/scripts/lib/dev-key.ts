/**
 * File: apps/web/scripts/lib/dev-key.ts
 * Purpose: The first step of every developer script that calls Claude (verify-* and eval-*)
 *          and of `pnpm dev`: stop at once unless ANTHROPIC_API_KEY in apps/web/.env.local is
 *          the development key (src/server/dev-key.ts checkDevKey()). Prints the workspace id
 *          or the reason, never the key.
 * Used by: scripts/verify-warm.ts, verify-answer-cache.ts, verify-screenshot.ts,
 *          verify-notes.ts, eval-answers.ts, eval-notes.ts, check-dev-key.ts
 * Depends on: src/server/dev-key.ts
 * Architecture: CLAUDE.md "Separate Claude keys"
 */
import { checkDevKey } from '@/server/dev-key';

/**
 * Refuses to go on without the development key: prints why and exits with code 1.
 *
 * @param script The script's name, for the printed line.
 * @returns When the key is a development key (after printing its workspace id).
 * Called from: main() of each verify-* and eval-* script; scripts/check-dev-key.ts
 */
export async function requireDevKey(script: string): Promise<void> {
  const check = await checkDevKey();
  if (!check.ok) {
    console.error(`${script}: refused: ${check.reason}`);
    process.exit(1);
  }
  console.log(`${script}: development key OK (workspace ${check.workspaceId})`);
}
