/**
 * File: apps/web/app/api/ai-instructions/pin/route.ts
 * Purpose: GET /api/ai-instructions/pin: the company AI instructions' version ids in force now (live
 *          answers and AI notes), read fresh from the database, for a call that is starting. The call
 *          sends them with every request until it ends, so an admin's save during the call does not
 *          change it (ADR-0083). Ids only, never text: any signed-in account may read them.
 * Used by: src/core/answer/instructionsPin.ts (browser, at Connect)
 * Depends on: src/server/auth.ts (getCachedSession), src/server/aiInstructions.ts (readPin), src/server/db.ts
 * Architecture: docs/decisions/ADR-0083-company-ai-instructions.md
 */
import type { InstructionsPin } from '@kite/shared';
import { readPin, type InstructionsDb } from '@/server/aiInstructions';
import { getCachedSession } from '@/server/auth';
import { db } from '@/server/db';

/** Next.js route setting: a save must show to the next call at once, so never cache this. */
export const dynamic = 'force-dynamic';

/** Responses are per account and change with every save: no cache anywhere. */
const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Handles GET /api/ai-instructions/pin.
 *
 * @param request The incoming request.
 * @returns 401 when not signed in (or a temporary password), 503 when the database cannot be read (the
 *          call then goes on unpinned, with the version in force per request), otherwise 200 with an
 *          InstructionsPin.
 */
export async function GET(request: Request): Promise<Response> {
  const { session, setCookies } = await getCachedSession(request.headers);
  let response: Response;
  if (!session || session.user.mustChangePassword) {
    response = Response.json(
      { code: 'unauthorized', message: 'Sign in required' },
      { status: 401, headers: NO_STORE },
    );
  } else {
    try {
      // The app's Neon client has the common Drizzle Postgres shape readPin() uses.
      const pin = await readPin(db as unknown as InstructionsDb);
      response = Response.json(pin satisfies InstructionsPin, { headers: NO_STORE });
    } catch (error) {
      // The error's name only.
      console.error('ai instructions: pin failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
      response = Response.json(
        { code: 'internal', message: 'Try again shortly' },
        { status: 503, headers: NO_STORE },
      );
    }
  }
  for (const cookie of setCookies) response.headers.append('set-cookie', cookie);
  return response;
}
