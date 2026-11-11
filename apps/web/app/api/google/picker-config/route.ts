/**
 * File: apps/web/app/api/google/picker-config/route.ts
 * Purpose: GET /api/google/picker-config: the Picker API key and project number, for signed-in people only. Thin: the work is in src/server/google/api.ts.
 * Used by: src/core/drive/api.ts
 * Depends on: src/server/google/api.ts
 * Architecture: ADR-0072
 */
import { handlePickerConfig } from '@/server/google/api';

/** Next.js route setting: never cached (per account, and tokens change). */
export const dynamic = 'force-dynamic';

/**
 * Handles GET /api/google/picker-config.
 *
 * @param request The request.
 * @returns See handlePickerConfig().
 */
export function GET(request: Request): Promise<Response> {
  return handlePickerConfig(request);
}
