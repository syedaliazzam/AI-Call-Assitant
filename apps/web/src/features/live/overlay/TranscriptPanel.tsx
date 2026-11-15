/**
 * File: apps/web/src/features/live/overlay/TranscriptPanel.tsx
 * Purpose: The transcript panel (spec S15): on top the overlay's status bar (ADR-0082, StatusBar.tsx: the
 *          level button, language, the line with the call's messages, Clear and collapse), and the bubbles below: oldest at the top, newest at the bottom, following the newest unless the
 *          reader has scrolled up, when "Scroll to bottom" shows. You on the right, the other person on
 *          the left, each with who and when under the words.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: src/core/live/liveChannel.ts, ./StatusBar.tsx,
 *             src/features/live/TranscriptBubbles.tsx, src/features/live/useStickToBottom.ts,
 *             src/ui/icons.tsx, ./parts.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15); ADR-0041, ADR-0082
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { useMemo, type RefObject } from 'react';
import type { CompactCommand, CompactGroup, CompactState } from '@/core/live/liveChannel';
import { TranscriptBubbles } from '@/features/live/TranscriptBubbles';
import { useAccountName } from '@/features/shell/AccountName';
import { useStickToBottom } from '@/features/live/useStickToBottom';
import { ChevronDownIcon } from '@/ui/icons';
import { BUTTON, type LevelStore } from './parts';
import { StatusBar } from './StatusBar';

/** No bubbles yet: one shared empty list. */
const NO_GROUPS: readonly CompactGroup[] = [];

/** Props for TranscriptPanel. */
export interface TranscriptPanelProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Clears the words on screen. */
  onClear: () => void;
  /** Closes the panel: bar 2 comes back. */
  onCollapse: () => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
  /** The text size chosen in the menu. */
  fontScale: number;
  /** Whether the language list is open. */
  languagesOpen: boolean;
  /** Opens or closes the language list. */
  onLanguagesOpen: (open: boolean) => void;
  /** The language list's element, so the window can grow to fit it. */
  languagesRef?: RefObject<HTMLUListElement | null>;
  /** ADR-0082: opens a device list (a status message's button). */
  onList: (list: 'audio' | 'mic') => void;
  /** ADR-0082: true while a screen recording runs with Private off. */
  privateOff: boolean;
  /** ADR-0082: turns Private back on. */
  onPrivateOn: () => void;
}

/**
 * The panel.
 *
 * @param props See TranscriptPanelProps.
 * @returns The panel's contents.
 * Rendered by: CompactView.tsx
 */
export function TranscriptPanel(props: TranscriptPanelProps) {
  const { state, mac, onCommand } = props;
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
      {/* ADR-0082: the overlay's one status bar is the panel's header: the level button closes the panel,
          and the line shows the call's messages (the words are below). */}
      <StatusBar
        state={state}
        chips={[]}
        question={null}
        words={false}
        transcriptOpen
        onTranscript={(open) => {
          if (!open) props.onCollapse();
        }}
        onCommand={onCommand}
        onClear={props.onClear}
        onCollapse={props.onCollapse}
        collapseLabel="Close the transcript"
        onList={props.onList}
        privateOff={props.privateOff}
        onPrivateOn={props.onPrivateOn}
        mac={mac}
        levels={props.levels}
        languagesOpen={props.languagesOpen}
        onLanguagesOpen={props.onLanguagesOpen}
        {...(props.languagesRef ? { languagesRef: props.languagesRef } : {})}
      />
      {/* v1.3.2: as tall as the turns, up to the panel's height; then it scrolls (data-scroll: the overlay
          measures how tall it would be, to fit the window to it). */}
      <div className="relative flex min-h-0 flex-auto flex-col px-1.5 pb-1.5">
        <div
          ref={ref}
          onScroll={onScroll}
          aria-label="Live transcript"
          aria-live="polite"
          data-scroll=""
          className="min-h-0 flex-auto overflow-y-auto rounded-control bg-ui-overlay-button px-3 py-2"
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
