/**
 * File: apps/web/src/features/live/overlay/TranscriptPanel.tsx
 * Purpose: The transcript panel (spec S15): the level button, language, Clear and collapse on top, and
 *          the bubbles below: oldest at the top, newest at the bottom, following the newest unless the
 *          reader has scrolled up, when "Scroll to bottom" shows. You on the right, the other person on
 *          the left, each with who and when under the words.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts,
 *             src/features/live/TranscriptBubbles.tsx, src/features/live/useStickToBottom.ts,
 *             src/ui/icons.tsx, ./parts.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S15); ADR-0041
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { useMemo, type RefObject } from 'react';
import type { CompactCommand, CompactGroup, CompactState } from '@/core/live/liveChannel';
import { TranscriptBubbles } from '@/features/live/TranscriptBubbles';
import { useAccountName } from '@/features/shell/AccountName';
import { useStickToBottom } from '@/features/live/useStickToBottom';
import { ChevronDownIcon, CollapseIcon } from '@/ui/icons';
import {
  BUTTON,
  ICON_BUTTON,
  KeyChip,
  LanguageControl,
  LevelButton,
  PILL,
  type LevelStore,
} from './parts';

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
      <div className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]">
        <LevelButton
          on={state?.audio.them ?? false}
          levels={props.levels}
          label="Hide the transcript"
          onClick={props.onCollapse}
        />
        <LanguageControl
          state={state}
          onCommand={onCommand}
          open={props.languagesOpen}
          onOpen={props.onLanguagesOpen}
          {...(props.languagesRef ? { listRef: props.languagesRef } : {})}
        />
        <span className="flex-1" />
        <button
          type="button"
          className={PILL}
          onClick={props.onClear}
          disabled={!state}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS['clear-transcript'], mac)}
        >
          Clear <KeyChip hotkey="clear-transcript" visibleAt="@min-[620px]:inline-flex" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          aria-label="Close the transcript"
          onClick={props.onCollapse}
        >
          <CollapseIcon />
        </button>
      </div>
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
