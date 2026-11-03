/**
 * File: apps/web/src/features/live/LiveCallLayout.tsx
 * Purpose: The layout of the desktop main window's live call view (v1.0.2, reference layout) on the
 *          dark tokens: a top bar (logo, session name, status badge, where "Them" comes from, audio
 *          meters, and the collapse arrow), notices across the full width, then the transcript on
 *          the LEFT and the answers panel on the RIGHT (LiveAnswers.tsx: call timer, ⋮ menu, Exit,
 *          the answers newest first, the message box, and the large Answer and Screenshot buttons).
 *          The collapse arrow hides the answers panel, leaving the transcript the whole width.
 *          Below a 900 px wide view (Kite docked beside a meeting) they stack, the answers first.
 *          Layout only: the live page and the live harness pass in the real parts.
 * Used by: src/features/live/LivePage.tsx; tests/integration/harness/live.tsx
 * Depends on: src/ui (Badge, BrandLockup, icons), React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Live session); ADR-0035
 * Theme: docs/design/kite-ui-theme.md §6 (live view: dark); tokens from src/ui/theme.css
 *
 * The breakpoint is the live view's own width (a container query), not the window's: beside
 * the app sidebar a 900 px window leaves about 660 px, too narrow for two useful columns.
 */
'use client';

import { useState, type ReactNode } from 'react';
import { BrandLockup } from '@/ui/BrandLockup';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { CollapseIcon, ExpandIcon } from '@/ui/icons';

/** The call's status in the top bar. */
export interface LiveCallStatus {
  /** The badge's tone (green connected, amber connecting, red a channel lost). */
  tone: BadgeTone;
  /** The badge's text, for example "Connected". */
  label: string;
}

/** Props for LiveCallLayout. */
export interface LiveCallLayoutProps {
  /** The call's title, for example "Interview call" (shown as a mono eyebrow). */
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
  /** The answers panel (right). */
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
  // The collapse arrow: the answers panel hides and the transcript takes the whole width.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="k-dark @container flex min-h-screen flex-col bg-ui-bg text-ui-text">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-ui-border rounded-control bg-ui-band px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <BrandLockup tone="dark" size="sm" byline={false} />
          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-ui-border" />
          <div className="min-w-0">
            <p className="text-[13px] text-ui-muted">{props.title}</p>
            <h1 className="truncate text-[15px] font-medium text-ui-heading">{props.name}</h1>
          </div>
        </div>
        <Badge tone={props.status.tone}>{props.status.label}</Badge>
        {props.themSource && <p className="text-[13px] text-ui-muted">Them = {props.themSource}</p>}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex flex-col gap-1">{props.meters}</div>
          <button
            type="button"
            aria-label={collapsed ? 'Show answers' : 'Hide answers'}
            aria-pressed={collapsed}
            title={collapsed ? 'Show the answers panel' : 'Hide the answers panel'}
            onClick={() => setCollapsed((value) => !value)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-control text-ui-muted hover:bg-ui-surface hover:text-ui-text focus-visible:[box-shadow:var(--k-focus)] focus:outline-none pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            {collapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
        </div>
      </header>

      {props.notices && (
        <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">{props.notices}</div>
      )}

      {/* Stacked (answers first) below a 900 px wide view; side by side from 900 px, with the
          page then exactly one screen high so each column scrolls on its own. */}
      <div
        className={`grid flex-1 gap-4 p-4 sm:p-6 @min-[900px]:h-[calc(100vh-4.5rem)] @min-[900px]:grid-rows-1 ${collapsed ? '' : '@min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]'}`}
      >
        {/* Plain columns: the transcript and answers panel name their own regions. */}
        <div className="order-2 flex min-h-[22rem] flex-col @min-[900px]:order-1 @min-[900px]:min-h-0">
          {props.transcript}
        </div>
        {!collapsed && (
          <div className="order-1 flex h-[40rem] min-h-0 flex-col @min-[900px]:order-2 @min-[900px]:h-auto">
            {props.answers}
          </div>
        )}
      </div>
    </div>
  );
}
