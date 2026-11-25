/**
 * File: apps/web/src/features/live/overlay/TranscriptPanel.tsx
 * Purpose: The full transcript panel (spec S15): the bubbles, oldest at the top, newest at the bottom,
 *          following the newest unless the reader has scrolled up, when "Scroll to bottom" shows. You on the
 *          right, the other person on the left, each with who and when under the words. ADR-0118: it opens
 *          under the transcript bar (bar 2), which stays with its level, Clear and expand buttons, so the
 *          panel has no header of its own any more (ADR-0082 made bar 2 its header and hid bar 2).
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/live/liveChannel.ts, src/features/live/TranscriptBubbles.tsx,
 *             src/features/live/useStickToBottom.ts, src/ui/icons.tsx, ./parts.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15); ADR-0041, ADR-0082, ADR-0118
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { useMemo } from 'react';
import type { CompactCommand, CompactGroup, CompactState } from '@/core/live/liveChannel';
import { TranscriptBubbles } from '@/features/live/TranscriptBubbles';
import { useAccountName } from '@/features/shell/AccountName';
import { useStickToBottom } from '@/features/live/useStickToBottom';
import { ChevronDownIcon } from '@/ui/icons';
import { BUTTON } from './parts';

/** No bubbles yet: one shared empty list. */
const NO_GROUPS: readonly CompactGroup[] = [];

/** Props for TranscriptPanel. */
export interface TranscriptPanelProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** Sends a command to the live page ("Answer this" on a bubble). */
  onCommand: (command: CompactCommand) => void;
  /** The text size chosen in the menu. */
  fontScale: number;
}

/**
 * The panel.
 *
 * @param props See TranscriptPanelProps.
 * @returns The panel's contents.
 * Rendered by: CompactView.tsx
 */
export function TranscriptPanel(props: TranscriptPanelProps) {
  const { state, onCommand } = props;
  const groups = state?.groups ?? NO_GROUPS;
  // v1.3.2: the user's own turns show the account's display name (the overlay page gives it).
  const youName = useAccountName();
  const last = groups.at(-1);
  // Follows the newest words, including words still settling.
  const { ref, onScroll, paused, jump } = useStickToBottom(
    `${groups.length}:${last?.id}:${last?.finalText.length}:${last?.provisionalText.length}`,
  );
  const answeredIds = useMemo(
    () => new Set(groups.filter((group) => group.answered).map((group) => group.id)),
    [groups],
  );

  return (
    <section aria-label="Transcript panel" className="flex min-h-0 flex-auto flex-col">
      {/* v1.3.2: as tall as the turns, up to the panel's height; then it scrolls (data-scroll: the overlay
          measures how tall it would be, to fit the window to it). */}
      <div className="relative flex min-h-0 flex-auto flex-col p-1.5">
        <div
          ref={ref}
          onScroll={onScroll}
          aria-label="Live transcript"
          aria-live="polite"
          data-scroll=""
          // ADR-0085: room for the scrollbar is always kept, so the words wrap the same with or without it.
          // Otherwise a scrollbar that appeared once (a smaller zoom) narrowed the text, which then wrapped
          // onto one more line and kept the panel scrolling at its old height.
          className="min-h-0 flex-auto overflow-y-auto rounded-control bg-ui-overlay-button px-3 py-2 [scrollbar-gutter:stable]"
          style={{ zoom: props.fontScale }}
        >
          <TranscriptBubbles
            groups={groups}
            size="overlay"
            themName={state?.themName}
            youName={youName}
            startedAt={state?.startedAt}
            answeredIds={answeredIds}
            onAnswerThis={(group) => onCommand({ type: 'answer-this', groupId: group.id })}
            emptyText="Listening… Lines appear here as you and the other person speak."
          />
        </div>
        {paused && (
          <button
            type="button"
            onClick={jump}
            className={`${BUTTON} absolute bottom-3 left-1/2 -translate-x-1/2 bg-ui-pill shadow-modal`}
          >
            <ChevronDownIcon size={14} />
            Scroll to bottom
          </button>
        )}
      </div>
    </section>
  );
}
