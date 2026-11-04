/**
 * File: apps/web/src/features/live/overlay/LiveStrip.tsx
 * Purpose: Bar 2 of the stacked overlay, the live strip (v1.1.0, ADR-0041): level bars, the latest
 *          spoken words as chips, Clear and ⤢, which opens the transcript panel in its place. While the
 *          other person asks something, the question shows, highlighted, instead of the chips
 *          (replacing v1.0.4's separate "Them:" row). Notices and the hygiene prompts also show here,
 *          so they fit even with no panel open.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx, src/ui/icons.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0040, ADR-0041, ADR-0044
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import type { CompactChip, CompactCommand, CompactState } from '@/core/live/liveChannel';
import { ExpandIcon } from '@/ui/icons';
import { BUTTON, ICON_BUTTON, Keys, LevelBars, shortKeys, type LevelStore } from './parts';

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
  /** True on macOS (for the key hints). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
}

/**
 * The strip's middle: a hygiene prompt, a notice, the live question, or the words.
 *
 * @param props See LiveStripProps.
 * @returns The content.
 * Rendered by: LiveStrip
 */
function StripContent({ state, chips, question, onCommand, onExpand }: LiveStripProps) {
  if (state?.hygiene === 'paused') {
    return (
      <span role="alert" className="flex min-w-0 flex-1 items-center justify-end gap-2 text-[13px]">
        <span className="truncate">Listening is paused: no one has spoken for 30 minutes.</span>
        <button type="button" className={BUTTON} onClick={() => onCommand({ type: 'resume' })}>
          Resume
        </button>
      </span>
    );
  }
  if (state?.hygiene === 'ask') {
    return (
      <span role="alert" className="flex min-w-0 flex-1 items-center justify-end gap-2 text-[13px]">
        <span className="truncate">Still in a call?</span>
        <button type="button" className={BUTTON} onClick={() => onCommand({ type: 'still-here' })}>
          Yes
        </button>
      </span>
    );
  }
  if (state?.dictating || state?.dictationNotice) {
    return (
      <span
        role="status"
        className={`min-w-0 flex-1 truncate text-right text-[13px] ${state.dictating ? 'text-ui-danger' : 'text-ui-warning'}`}
      >
        {state.dictating
          ? 'Listening… speak your question; it is sent when you pause.'
          : state.dictationNotice}
      </span>
    );
  }
  if (state?.notice) {
    return (
      <span
        role="status"
        className="min-w-0 flex-1 truncate text-right text-[13px] text-ui-warning"
      >
        {state.notice}
      </span>
    );
  }
  if (state?.headphonesHint) {
    return (
      <span
        role="status"
        className="flex min-w-0 flex-1 items-center justify-end gap-2 text-[13px]"
      >
        <span className="truncate text-ui-muted">Your speakers are echoing. Use headphones.</span>
        <button
          type="button"
          className={BUTTON}
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
      className="flex h-8 min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden rounded-control focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
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
        chips.map((chip) => (
          <span
            key={chip.id}
            className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[13px] leading-5 ${chip.speaker === 'you' ? 'border-ui-you text-ui-you' : 'border-ui-border text-ui-text'}`}
          >
            {chip.text}
          </span>
        ))
      ) : (
        <span className="truncate text-[13px] text-ui-muted">
          {state ? 'Nothing said yet.' : 'Connecting to the call…'}
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
    <section
      aria-label="Live transcript bar"
      className="flex h-11 shrink-0 items-center gap-1.5 px-2 [-webkit-app-region:drag]"
    >
      <LevelBars on={state?.audio.them ?? false} levels={props.levels} />
      <StripContent {...props} />
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
        aria-label="Open the transcript"
        onClick={props.onExpand}
      >
        <ExpandIcon />
      </button>
    </section>
  );
}
