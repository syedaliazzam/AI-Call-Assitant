/**
 * File: apps/web/src/server/dev-key.ts
 * Purpose: The development-key guard. Production keeps its own ANTHROPIC_API_KEY in Vercel;
 *          local development (`pnpm dev`), the verify scripts and the evaluations must use a
 *          second key from a separate Claude Console workspace, read from apps/web/.env.local
 *          under the same name. checkDevKey() refuses when that key is missing, when the
 *          variables come from a Vercel production or preview environment, or when the key
 *          belongs to the production workspace, so an evaluation can never spend the
 *          production workspace's usage limit again (it did on 2026-10-30).
 * Used by: scripts/lib/dev-key.ts (every verify-* and eval-* script, and `pnpm dev`)
 * Depends on: src/server/claude.ts (keyWorkspace), src/server/env.ts (EnvSource)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.1 (environment variables);
 *               CLAUDE.md "Coding rules" (separate keys)
 *
 * The workspace is read from the API's `anthropic-workspace-id` response header on a free
 * models request (no model is called). Messages name workspace ids, never the key.
 */
import 'server-only';
import { keyWorkspace } from './claude';
import type { EnvSource } from './env';

/**
 * Workspace ids of the production key. A workspace id is not a secret (it names the
 * workspace, it does not grant access). Measured on 2026-10-30 from the key Vercel then held
 * for Production, Preview and Development (one shared key).
 */
export const PRODUCTION_WORKSPACE_IDS: readonly string[] = ['wrkspc_01Qx2eek7DGQQM3dXYhT6zs6'];

/** The guard's verdict. */
export type DevKeyCheck =
  | {
      /** The key is a development key. */
      ok: true;
      /** Its workspace id. */
      workspaceId: string;
    }
  | {
      /** Refused. */
      ok: false;
      /** Why, in one sentence with what to do (never the key). */
      reason: string;
    };

/** Where to get the development key, added to every refusal. */
const HOW_TO_FIX =
  'Put the development key (from the separate development workspace in the Claude Console) in apps/web/.env.local as ANTHROPIC_API_KEY; see CLAUDE.md "Separate Claude keys".';

/**
 * Checks that the configured key is a development key.
 *
 * @param source The variables (normally process.env, loaded from apps/web/.env.local).
 * @param lookup Finds a key's workspace (default keyWorkspace(); tests pass a fake).
 * @returns ok with the workspace id, or a refusal with the reason.
 * Called from: requireDevKey() in scripts/lib/dev-key.ts; tests
 */
export async function checkDevKey(
  source: EnvSource = process.env,
  lookup: (apiKey: string) => Promise<string | null> = keyWorkspace,
): Promise<DevKeyCheck> {
  if (source.VERCEL_ENV === 'production' || source.VERCEL_ENV === 'preview') {
    return {
      ok: false,
      reason: `these variables come from the Vercel ${source.VERCEL_ENV} environment. ${HOW_TO_FIX}`,
    };
  }
  const apiKey = source.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { ok: false, reason: `ANTHROPIC_API_KEY is missing. ${HOW_TO_FIX}` };
  let workspaceId: string | null;
  try {
    workspaceId = await lookup(apiKey);
  } catch (error) {
    const status = (error as { status?: number }).status;
    return {
      ok: false,
      reason: `could not check which workspace the key belongs to (${status ? `HTTP ${status}` : 'no connection'}). ${HOW_TO_FIX}`,
    };
  }
  if (!workspaceId) {
    return {
      ok: false,
      reason: `the API did not say which workspace the key belongs to (keys in the Default workspace send no workspace id). ${HOW_TO_FIX}`,
    };
  }
  if (PRODUCTION_WORKSPACE_IDS.includes(workspaceId)) {
    return {
      ok: false,
      reason: `the key belongs to the production workspace (${workspaceId}). ${HOW_TO_FIX}`,
    };
  }
  return { ok: true, workspaceId };
}
