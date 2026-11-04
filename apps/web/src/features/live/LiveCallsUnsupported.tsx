/**
 * File: apps/web/src/features/live/LiveCallsUnsupported.tsx
 * Purpose: What the live page shows on a phone or tablet (UI theme stage U3): live calls need
 *          Kite on a Windows or Mac computer (the desktop app, or Chrome or Edge), with a link
 *          to the dashboard to review past sessions. Whether this device can run a call is
 *          decided in src/platform (supportsLiveCalls()).
 * Used by: src/features/live/LiveSession.tsx; tests/integration/harness/live.tsx
 * Depends on: src/ui (Eyebrow, LinkButton)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §4 (desktop vs browser)
 * Theme: docs/design/kite-ui-theme.md §6 (dark call screens, empty states)
 */
import { Eyebrow } from '@/ui/Eyebrow';
import { LinkButton } from '@/ui/LinkButton';

/**
 * The "live calls need a computer" message.
 *
 * @returns A dark, full-height notice with one primary link.
 * Rendered by: LiveSession.tsx (when the platform cannot run a call); the live harness
 */
export function LiveCallsUnsupported() {
  return (
    <div className="k-dark flex min-h-screen flex-col justify-center bg-ui-bg px-6 py-12 text-ui-text">
      <div className="mx-auto max-w-md">
        <Eyebrow>Live call</Eyebrow>
        <h1 className="mt-1 text-[24px] font-semibold leading-tight text-ui-heading">
          Live calls need a computer
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed">
          Paramount AI listens to both sides of a call and needs screen or tab sharing, so a call
          runs in the Paramount AI desktop app on Windows or Mac, or in Chrome or Edge on a
          computer.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-ui-muted">
          On this device you can still review past sessions: their notes, answers and transcript.
        </p>
        <LinkButton href="/" variant="primary" className="mt-6">
          Review past sessions
        </LinkButton>
      </div>
    </div>
  );
}
