/**
 * File: apps/web/src/features/live/LiveCallLayout.tsx
 * Purpose: The layout of the live call view (UI theme stage U3) on the dark tokens: a top bar
 *          (logo, session name in mono, status badge, audio meters), notices across the full
 *          width, then the transcript on the left and the answer panel on the right. Below a
 *          900 px wide view (Kite docked beside a meeting) they stack, the answers first.
 *          Layout only: the live page and the live harness pass in the real parts.
 * Used by: src/features/live/LivePage.tsx; tests/integration/harness/live.tsx
 * Depends on: src/ui (Badge), React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session)
 * Theme: docs/design/kite-ui-theme.md §6 (live view: dark); tokens from src/ui/theme.css
 *
 * The breakpoint is the live view's own width (a container query), not the window's: beside
 * the app sidebar a 900 px window leaves about 660 px, too narrow for two useful columns.
 */
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from '@/ui/Badge';

/** The call's status in the top bar. */
export interface LiveCallStatus {
  /** The badge's tone (green connected, amber connecting, red a channel lost). */
  tone: BadgeTone;
  /** The badge's text, for example "Connected". */
  label: string;
}

/** Props for LiveCallLayout. */
export interface LiveCallLayoutProps {
  /** The call's title, for example "Sales call" (shown as a mono eyebrow). */
  title: string;
  /** The session's company or topic (the session name). */
  name: string;
  /** Where "Them" comes from, for example "the shared tab's audio", or null. */
  themSource: string | null;
  /** The status badge. */
  status: LiveCallStatus;
  /** The audio meters (right of the top bar). */
  meters: ReactNode;
  /** Notices across the full width (channel errors, save failures, echo), or nothing. */
  notices?: ReactNode;
  /** The transcript (left). */
  transcript: ReactNode;
  /** The action row and answer panel (right). */
  answers: ReactNode;
}

/**
 * The live call view's layout.
 *
 * @param props See LiveCallLayoutProps.
 * @returns The dark call screen.
 * Rendered by: LivePage.tsx (live view); the live harness
 */
export function LiveCallLayout(props: LiveCallLayoutProps) {
  return (
    <div className="k-dark @container flex min-h-screen flex-col bg-ui-bg text-ui-text">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-ui-border bg-ui-band px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          {/* The product mark (UI stage U4 replaces it with the company logo lockup). */}
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center bg-ui-primary text-sm font-bold text-ui-on-primary"
          >
            K
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ui-muted">
              {props.title}
            </p>
            <h1 className="truncate font-mono text-[15px] font-medium text-ui-heading">
              {props.name}
            </h1>
          </div>
        </div>
        <Badge tone={props.status.tone}>{props.status.label}</Badge>
        {props.themSource && (
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ui-muted">
            Them = {props.themSource}
          </p>
        )}
        <div className="ml-auto flex flex-col gap-1">{props.meters}</div>
      </header>

      {props.notices && (
        <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">{props.notices}</div>
      )}

      {/* Stacked (answers first) below a 900 px wide view; side by side from 900 px, with the
          page then exactly one screen high so each column scrolls on its own. */}
      <div className="grid flex-1 gap-4 p-4 sm:p-6 @min-[900px]:h-[calc(100vh-4.5rem)] @min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @min-[900px]:grid-rows-1">
        {/* Plain columns: the transcript and answer panel name their own regions. */}
        <div className="order-2 flex min-h-[22rem] flex-col @min-[900px]:order-1 @min-[900px]:min-h-0">
          {props.transcript}
        </div>
        <div className="order-1 flex min-h-0 flex-col @min-[900px]:order-2 @min-[900px]:overflow-y-auto">
          {props.answers}
        </div>
      </div>
    </div>
  );
}
