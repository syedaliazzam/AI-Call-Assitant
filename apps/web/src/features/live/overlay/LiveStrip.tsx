/**
 * File: apps/web/src/features/live/overlay/LiveStrip.tsx
 * Purpose: Bar 2 of the call bars (spec S13): the level button, which opens the transcript panel;
 *          language; Clear; collapse; and under them the live strip with "Listening…" or the latest
 *          words. While the other person asks something, the question shows, highlighted, instead of the
 *          words. Notices and the hygiene prompts also show in the strip, so they fit even with no panel
 *          open.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S13); ADR-0040, ADR-0041, ADR-0044
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import type { RefObject } from 'react';
import type { CompactChip, CompactCommand, CompactState } from '@/core/live/liveChannel';
import { CollapseIcon } from '@/ui/icons';
import {
  BUTTON,
  ICON_BUTTON,
  KeyChip,
  LanguageControl,
  LevelButton,
  PILL,
  type LevelStore,
} from './parts';

/** Props for LiveStrip. */
export interface LiveStripProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** The chips to show (those on screen when Clear was pressed are gone). */
  chips: readonly CompactChip[];
  /** The live question to show, unless it was cleared. */
  question: string | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Clears the words on screen. */
  onClear: () => void;
  /** Opens the transcript panel. */
  onExpand: () => void;
  /** Collapses the overlay to bar 1. */
  onCollapse: () => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
  /** Whether the language list is open. */
  languagesOpen: boolean;
  /** Opens or closes the language list. */
  onLanguagesOpen: (open: boolean) => void;
  /** The language list's element, so the window can grow to fit it. */
  languagesRef?: RefObject<HTMLUListElement | null>;
}

/** How many chips the strip shows. */
const MAX_CHIPS = 4;

/**
 * The strip: a hygiene prompt, a notice, the live question, or the words.
 *
 * @param props See LiveStripProps.
 * @returns The content.
 * Rendered by: LiveStrip
 */
function StripContent({ state, chips, question, onCommand, onExpand }: LiveStripProps) {
  if (state?.hygiene === 'paused') {
    return (
      <span role="alert" className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="truncate">Listening is paused: no one has spoken for 30 minutes.</span>
        <button
          type="button"
          className={`${BUTTON} h-6`}
          onClick={() => onCommand({ type: 'resume' })}
        >
          Resume
        </button>
      </span>
    );
  }
  if (state?.hygiene === 'ask') {
    return (
      <span role="alert" className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="truncate">Still in a call?</span>
        <button
          type="button"
          className={`${BUTTON} h-6`}
          onClick={() => onCommand({ type: 'still-here' })}
        >
          Yes
        </button>
      </span>
    );
  }
  if (state?.dictating || state?.dictationNotice) {
    return (
      <span
        role="status"
        className={`min-w-0 flex-1 truncate text-[13px] ${state.dictating ? 'text-ui-danger' : 'text-ui-warning'}`}
      >
        {state.dictating
          ? 'Listening… speak your question; it is sent when you pause.'
          : state.dictationNotice}
      </span>
    );
  }
  if (state?.notice) {
    return (
      <span role="status" className="min-w-0 flex-1 truncate text-[13px] text-ui-warning">
        {state.notice}
      </span>
    );
  }
  if (state?.headphonesHint) {
    return (
      <span role="status" className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
        <span className="truncate text-ui-muted">Your speakers are echoing. Use headphones.</span>
        <button
          type="button"
          className={`${BUTTON} h-6`}
          onClick={() => onCommand({ type: 'headphones-seen' })}
        >
          OK
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label="Latest words: open the transcript"
      onClick={onExpand}
      className="flex h-6 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-control text-left focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
    >
      {question ? (
        <span
          aria-label="Current question from the other person"
          aria-live="polite"
          className="truncate text-[14px] font-medium text-ui-accent"
        >
          {question}
        </span>
      ) : chips.length > 0 ? (
        // As many as fit at the overlay's narrowest: a cut-off chip reads as a mistake.
        chips.slice(-MAX_CHIPS).map((chip) => (
          <span
            key={chip.id}
            className={`shrink-0 rounded-full border px-2 text-[13px] leading-5 ${chip.speaker === 'you' ? 'border-ui-you text-ui-you' : 'border-ui-border text-ui-text'}`}
          >
            {chip.text}
          </span>
        ))
      ) : (
        <span className="truncate text-[13px] text-ui-muted">
          {state ? 'Listening…' : 'Connecting to the call…'}
        </span>
      )}
    </button>
  );
}

/**
 * Bar 2.
 *
 * @param props See LiveStripProps.
 * @returns The bar.
 * Rendered by: CompactView.tsx
 */
export function LiveStrip(props: LiveStripProps) {
  const { state, mac } = props;
  return (
    <section aria-label="Live transcript bar" className="flex flex-col gap-1 p-1.5">
      <div className="relative flex h-8 items-center gap-1 [-webkit-app-region:drag]">
        <LevelButton
          on={state?.audio.them ?? false}
          levels={props.levels}
          label="Open the transcript"
          onClick={props.onExpand}
        />
        <LanguageControl
          state={state}
          onCommand={props.onCommand}
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
          aria-label="Hide the transcript bar"
          onClick={props.onCollapse}
        >
          <CollapseIcon />
        </button>
      </div>
      <div className="flex h-8 items-center rounded-control bg-ui-overlay-button px-2">
        <StripContent {...props} />
      </div>
    </section>
  );
}
