/**
 * File: apps/web/src/core/download/macRelease.ts
 * Purpose: ADR-0125: asks the server once per page whether the Mac app is published (GET /api/mac-release),
 *          so the "Get it for Mac" dialogs show the install command only when there is a release, and "Mac
 *          version coming soon" until then. Any failure counts as "not published" (no broken install offered).
 * Used by: src/ui/useMacRelease.ts
 * Depends on: fetch (same origin)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §10.3 (installation); ADR-0125
 */

/** The answer while the server has not said yet: null (the dialog shows that it is checking). */
export type MacReleaseState = boolean | null;

/** The one question asked per page (every dialog shares it). */
let asked: Promise<boolean> | null = null;

/**
 * Whether the Mac app is published, asked once per page.
 *
 * @param fetchImpl The fetch to use (tests pass their own).
 * @returns True when the server says it is published; false for "no", an error or no answer.
 * Called from: src/ui/useMacRelease.ts; tests
 */
export function macReleasePublished(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  asked ??= fetchImpl('/api/mac-release', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return false;
      const body = (await response.json()) as { published?: unknown };
      return body.published === true;
    })
    .catch(() => false);
  return asked;
}

/**
 * Forgets the answer, so the next call asks again.
 * Called from: tests only
 */
export function forgetMacReleaseAnswer(): void {
  asked = null;
}
