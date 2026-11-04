/**
 * File: apps/web/src/core/session/jobImport.ts
 * Purpose: Asks the server to read a job link (POST /api/job-import), for the wizard's "Paste a
 *          job link". Never throws: a failure comes back as a message for the user, who can always
 *          type the details instead.
 * Used by: src/features/session-setup/JobLinkField.tsx
 * Depends on: @kite/shared (response type), the browser's fetch
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.2; ADR-0029
 *
 * The address and what comes back are the user's content and are never logged.
 */
import type { JobImportFields, JobImportResponse } from '@kite/shared';

/** What importing a job link gave. */
export type JobImportResult =
  | {
      /** It worked. */
      ok: true;
      /** The company, role and description found ('' where the page did not say). */
      fields: JobImportFields;
      /** The site the page came from, to show where the details came from. */
      host: string;
    }
  | {
      /** It did not. */
      ok: false;
      /** What to tell the user. */
      message: string;
    };

/** The fallback message when nothing better is known. */
const FAILED =
  'Paramount AI could not read that link just now. Paste the details below instead, or try again.';

/**
 * Reads a job link.
 *
 * @param url       The address the user pasted.
 * @param fetchImpl fetch (tests replace it).
 * @returns The details found, or a message.
 * Called from: JobLinkField.tsx; tests
 */
export async function importJobLink(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JobImportResult> {
  try {
    const response = await fetchImpl('/api/job-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) {
      const failure = (await response.json().catch(() => null)) as { message?: string } | null;
      // Only the page's own messages (422) are worded for the user; others are generic.
      const message = response.status === 422 ? failure?.message : undefined;
      return { ok: false, message: message ?? FAILED };
    }
    const { fields, host } = (await response.json()) as JobImportResponse;
    return { ok: true, fields, host };
  } catch {
    return { ok: false, message: FAILED };
  }
}
