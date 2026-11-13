/**
 * File: apps/web/app/api/stt/token/route.ts
 * Purpose: POST /api/stt/token (ADR-0076): a 60-second Deepgram token for the signed-in account's call,
 *          when cloud transcription is on for it. Thin: the work is in src/server/sttToken.ts.
 * Used by: src/core/stt/sttToken.ts (browser, at Connect and on each reconnect)
 * Depends on: src/server/sttToken.ts
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C2; ADR-0076
 */
import { handleSttToken } from '@/server/sttToken';

/** Next.js route setting: Node.js (the session check uses the database driver). */
export const runtime = 'nodejs';
/** Next.js route setting: never cached or pre-rendered (each reply holds a fresh token). */
export const dynamic = 'force-dynamic';

/**
 * Handles POST /api/stt/token.
 *
 * @param request The request.
 * @returns See handleSttToken().
 */
export function POST(request: Request): Promise<Response> {
  return handleSttToken(request);
}
