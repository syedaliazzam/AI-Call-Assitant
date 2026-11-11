/**
 * File: apps/web/src/features/live/ThemSilentNotice.tsx
 * Purpose: The call window's notice about what the call hears (1.5.1, ADR-0069; core/live/callNotice.ts):
 *          a silent microphone or call sound (an alert), or the speech worker catching up or filling in
 *          the user's lines after the call (a status). Before 1.5.1 this file showed only "Nothing heard
 *          from Them for 20 seconds"; ThemSilentNotice keeps that entry point for the test harness.
 * Used by: src/features/live/LivePage.tsx; tests/integration/harness/live.tsx
 * Depends on: React, src/core/live/callNotice.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (live session); ADR-0069
 */
import { callNoticeFor, type CallNotice } from '@/core/live/callNotice';

/**
 * A call notice in the call window.
 *
 * @param props.notice The notice.
 * @param props.alert  True for a silent channel (read out at once); false for a status.
 * @returns The notice.
 * Rendered by: LivePage.tsx (in the live view's notices)
 */
export function SilentChannelNotice({ notice, alert }: { notice: CallNotice; alert: boolean }) {
  return (
    <p
      role={alert ? 'alert' : 'status'}
      className={`rounded-control border px-3 py-2 text-[13px] text-ui-text ${alert ? 'border-ui-warning bg-ui-warning-bg' : 'border-ui-border bg-ui-surface'}`}
    >
      {notice.text} {notice.detail}
    </p>
  );
}

/**
 * The silent-other-side notice, as a browser call shows it (the integration harness).
 *
 * @returns The notice.
 * Rendered by: tests/integration/harness/live.tsx
 */
export function ThemSilentNotice() {
  return (
    <SilentChannelNotice
      notice={callNoticeFor({ silent: 'them', backlog: 'ok', platform: 'browser' })!}
      alert
    />
  );
}
