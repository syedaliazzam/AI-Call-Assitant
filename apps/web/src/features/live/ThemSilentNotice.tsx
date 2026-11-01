/**
 * File: apps/web/src/features/live/ThemSilentNotice.tsx
 * Purpose: The notice shown when "Them" has been silent for 20 s during a connected call (Day 6
 *          Stage 4e; the rule is core/audio/silence.ts): check the shared tab or app.
 * Used by: src/features/live/LivePage.tsx; tests/integration/harness/live.tsx
 * Depends on: React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); day-06 Stage 4
 */

/**
 * The notice.
 *
 * @returns The notice.
 * Rendered by: LivePage.tsx (in the live view's notices)
 */
export function ThemSilentNotice() {
  return (
    <p
      role="alert"
      className="border-l-[3px] border-ui-warning bg-ui-warning-bg px-3 py-2 text-sm text-ui-text"
    >
      Nothing heard from Them for 20 seconds. Check that the right tab or app is shared and playing
      sound (in Chrome, share the meeting tab with &ldquo;Also share tab audio&rdquo; on).
    </p>
  );
}
