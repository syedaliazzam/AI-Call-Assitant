/**
 * File: apps/web/src/features/live/overlay/TranscriptPanel.tsx
 * Purpose: The stacked overlay's transcript panel (v1.1.0, ADR-0041): it takes bar 2's place, with the
 *          level bars, Language, Clear and collapse on top, and the bubbles below: oldest at the top,
 *          newest at the bottom, following the newest unless the reader has scrolled up, when "Jump to
 *          latest" shows. You on the right, the other person on the left under their name.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, src/core/storage/types.ts
 *             (languages), src/features/live/TranscriptBubbles.tsx, src/features/live/useStickToBottom.ts,
 *             src/ui/icons.tsx, ./parts.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 *
 * Transcript text is only rendered on screen; it is never logged.
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import { useMemo, useState } from 'react';
import type { CompactCommand, CompactGroup, CompactState } from '@/core/live/liveChannel';
import { ANSWER_LANGUAGES } from '@/core/storage/types';
import { TranscriptBubbles } from '@/features/live/TranscriptBubbles';
import { useStickToBottom } from '@/features/live/useStickToBottom';
import { ChevronDownIcon, CollapseIcon, GlobeIcon } from '@/ui/icons';
import { BUTTON, ICON_BUTTON, Keys, LevelBars, shortKeys, type LevelStore } from './parts';

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
  /** True on macOS (for the key hints). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
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
  const { state, mac, onCommand } = props;
  const groups = state?.groups ?? NO_GROUPS;
  const last = groups.at(-1);
  // Follows the newest words, including words still settling.
  const { ref, onScroll, paused, jump } = useStickToBottom(
    `${groups.length}:${last?.id}:${last?.finalText.length}:${last?.provisionalText.length}`,
  );
  const answeredIds = useMemo(
    () => new Set(groups.filter((group) => group.answered).map((group) => group.id)),
    [groups],
  );
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const language = ANSWER_LANGUAGES.find((option) => option.value === state?.language);

  return (
    <section aria-label="Transcript panel" className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex h-11 shrink-0 items-center gap-1.5 border-b border-ui-border px-2 [-webkit-app-region:drag]">
        <LevelBars on={state?.audio.them ?? false} levels={props.levels} />
        <button
          type="button"
          className={BUTTON}
          aria-label={`Answer language: ${language?.label ?? 'English'}`}
          aria-expanded={languagesOpen}
          onClick={() => setLanguagesOpen((was) => !was)}
        >
          <GlobeIcon />
          {language?.label ?? 'English'}
          <ChevronDownIcon size={14} />
        </button>
        {languagesOpen && (
          // In the page, not a browser's own list (ADR-0042). Answers use it; the transcript stays
          // English, because the speech model is English only.
          <ul
            role="listbox"
            aria-label="Answer language"
            className="k-overlay-menu absolute left-10 top-10 z-30 flex max-h-56 w-44 flex-col overflow-y-auto rounded-control border border-ui-border py-1 text-[13px] shadow-modal [-webkit-app-region:no-drag]"
          >
            {ANSWER_LANGUAGES.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === state?.language}
                  onClick={() => {
                    setLanguagesOpen(false);
                    onCommand({ type: 'language', code: option.value });
                  }}
                  className="w-full px-3 py-1 text-left hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className={BUTTON}
          onClick={props.onClear}
          disabled={!state}
          aria-keyshortcuts={hotkeyLabel(FOCUSED_HOTKEYS['clear-transcript'], mac)}
        >
          Clear <Keys>{shortKeys(FOCUSED_HOTKEYS['clear-transcript'], mac)}</Keys>
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
      <div className="relative min-h-0 flex-1">
        <div
          ref={ref}
          onScroll={onScroll}
          aria-label="Live transcript"
          aria-live="polite"
          className="h-full overflow-y-auto px-3 py-2"
          style={{ zoom: props.fontScale }}
        >
          <TranscriptBubbles
            groups={groups}
            size="overlay"
            glassBubbles
            themName={state?.themName}
            answeredIds={answeredIds}
            onAnswerThis={(group) => onCommand({ type: 'answer-this', groupId: group.id })}
            emptyText="Listening… Lines appear here as you and the other person speak."
          />
        </div>
        {paused && (
          <button
            type="button"
            onClick={jump}
            className={`${BUTTON} absolute bottom-2 left-1/2 -translate-x-1/2 shadow-modal`}
          >
            Jump to latest
          </button>
        )}
      </div>
    </section>
  );
}
