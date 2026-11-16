/**
 * File: apps/web/app/api/admin/ai-instructions/quality/route.ts
 * Purpose: POST /api/admin/ai-instructions/quality: Admin → AI settings' "Quality check" for the live
 *          answers prompt (ADR-0089). Answers 8 invented scenarios with an unsaved draft, grades them,
 *          compares the score with the prompt in force, and returns a token that lets that exact draft be
 *          saved. Admins only (401 signed out, 403 for anyone else); counts as one request against the
 *          daily limit.
 * Used by: src/core/admin/aiTry.ts (browser)
 * Depends on: src/server/auth.ts (auth: a fresh session read), src/server/aiQuality.ts,
 *             src/server/aiInstructions.ts (the prompt in force), src/server/env.ts, src/server/usage.ts,
 *             src/server/requestBody.ts, src/server/promptTryToken.ts, src/server/db.ts
 * Architecture: docs/decisions/ADR-0089-global-prompts-with-locked-contract.md
 */
import { companySettings, type InstructionsDb } from '@/server/aiInstructions';
import {
  findQualityScore,
  handleQualityCheck,
  recordQualityScore,
  runQualityCheck,
  type QualityDeps,
} from '@/server/aiQuality';
import { auth } from '@/server/auth';
import { CLAUDE_TIMEOUT_MS } from '@/server/claude';
import { db } from '@/server/db';
import { getClaudeEnv } from '@/server/env';
import { promptTryToken } from '@/server/promptTryToken';
import { readRequestText } from '@/server/requestBody';
import { countRequest } from '@/server/usage';
import { MAX_REQUEST_BYTES } from '@/server/validate';

/** Next.js route setting: the Anthropic SDK needs Node.js. */
export const runtime = 'nodejs';
/** Next.js route setting: never cache; every check is new. */
export const dynamic = 'force-dynamic';
/** Vercel function limit in seconds: 8 answers in parallel, then one grading request (twice, the first time). */
export const maxDuration = 120;

/** The app's Neon client has the common Drizzle Postgres shape these functions use. */
const store = db as unknown as InstructionsDb;

/** The real dependencies. */
const deps: QualityDeps = {
  models: () => {
    const env = getClaudeEnv();
    return { fast: env.modelFast, smart: env.modelSmart };
  },
  count: (userId) => countRequest(userId),
  livePrompt: async () => (await companySettings('live')).globalPrompt,
  findScore: (hash) => findQualityScore(store, hash),
  record: (hash, run) => recordQualityScore(store, hash, run),
  run: runQualityCheck,
  tokenFor: promptTryToken,
};

/**
 * Handles POST /api/admin/ai-instructions/quality.
 *
 * @param request The incoming request; body is a QualityCheckRequest (JSON).
 * @returns See handleQualityCheck() in src/server/aiQuality.ts.
 */
export async function POST(request: Request): Promise<Response> {
  // Read from the database, not the cookie cache: an admin whose role was just removed is refused at once.
  const session = await auth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  });
  // The role is checked before the body is read (handleQualityCheck() answers 401/403 otherwise).
  if (!session || session.user.role !== 'admin') {
    return handleQualityCheck(session?.user ?? null, '', deps, request.signal);
  }
  const received = await readRequestText(request, MAX_REQUEST_BYTES);
  if (!received.ok) {
    return Response.json({ code: 'bad_request', message: 'Request is too large' }, { status: 400 });
  }
  return handleQualityCheck(
    session.user,
    received.text,
    deps,
    AbortSignal.any([request.signal, AbortSignal.timeout(CLAUDE_TIMEOUT_MS * 2)]),
  );
}
