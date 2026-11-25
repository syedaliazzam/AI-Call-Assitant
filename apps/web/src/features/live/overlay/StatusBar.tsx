/**
 * File: apps/web/src/features/live/overlay/StatusBar.tsx
 * Purpose: The overlay's transcript bar (bar 2). ADR-0118 (like ParakeetAI): always shown during a call and
 *          always showing the live words, as short phrase chips in one line that scrolls to the newest
 *          words. On the left the level button, on the right Clear (the transcript) and the expand button;
 *          the level button and the expand button both open or close the full transcript panel, which opens
 *          under this bar (it no longer replaces it). The call's warnings are no longer on this line: they
 *          have their own slim line under the bar (WarningLine.tsx). ADR-0082 made this bar; ADR-0085: no
 *          answer-language control (the session sets the language). ADR-0123: a small hint before Clear says
 *          what Ctrl+Enter answers right now ("Them" on a call, "You" on your own).
 * Used by: src/features/live/CompactView.tsx (bar 2)
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx, src/ui/icons.tsx
 * Architecture: ADR-0118 (amends ADR-0041, ADR-0082, ADR-0085); ADR-0082;
 *               docs/design/paramount-ai-ui-spec.md §3 (S13, S15)
 *
 * Transcript words are only rendered on screen; they are never logged.
 */
'use client';

import { focusedHotkeys, hotkeyLabel, hotkeyAccelerator } from '@kite/shared';
import { useLayoutEffect, useRef } from 'react';
import type { CompactChip, CompactState } from '@/core/live/liveChannel';
import { CollapseIcon, ExpandIcon } from '@/ui/icons';
import { ICON_BUTTON, KeyChip, LevelButton, PILL, tipShortcut, type LevelStore } from './parts';

/** Props for StatusBar. */
export interface StatusBarProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** The chips to show (those on screen when Clear was pressed are gone). */
  chips: readonly CompactChip[];
  /** Whether the full transcript panel is open (the level and expand buttons' state). */
  transcriptOpen: boolean;
  /** Opens or closes the full transcript panel (the level button, the expand button, a click on the words). */
  onTranscript: (open: boolean) => void;
  /** Clears the words on screen. */
  onClear: () => void;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
}

/**
 * ADR-0118: the most chips the line keeps (the live page sends at most OVERLAY_CHIPS). The line shows the
 * newest that fit and scrolls the older ones out on the left.
 */
const MAX_CHIPS = 10;

/**
 * The live words as phrase chips in one line, newest on the right. When they do not fit, the line scrolls
 * to the newest (the oldest leave on the left, faded). A click opens or closes the full transcript.
 *
 * @param props.state   What the live page shows.
 * @param props.chips   The chips.
 * @param props.open    True while the full transcript panel is open.
 * @param props.onToggle Opens or closes the full transcript panel.
 * @returns The line.
 * Rendered by: StatusBar
 */
function WordsLine({
  state,
  chips,
  open,
  onToggle,
}: {
  /** What the live page shows. */
  state: CompactState | null;
  /** The chips. */
  chips: readonly CompactChip[];
  /** True while the full transcript panel is open. */
  open: boolean;
  /** Opens or closes the full transcript panel. */
  onToggle: () => void;
}) {
  const shown = chips.slice(-MAX_CHIPS);
  const line = useRef<HTMLSpanElement>(null);
  const newest = shown.at(-1);
  const key = `${shown.length}:${newest?.id}:${newest?.text.length}`;
  // ADR-0118: follow the newest words, like a ticker. Measured after each change of the words; the fade on the
  // left shows only while older words are scrolled out (data-overflow).
  useLayoutEffect(() => {
    const element = line.current;
    if (!element) return;
    const overflow = element.scrollWidth > element.clientWidth + 1;
    if (overflow) element.dataset.overflow = '';
    else delete element.dataset.overflow;
    // jsdom (unit tests) has no scrollTo on elements.
    if (overflow && typeof element.scrollTo === 'function') {
      element.scrollTo({ left: element.scrollWidth, behavior: 'smooth' });
    }
  }, [key]);
  return (
    <button
      type="button"
      aria-label={`Latest words: ${open ? 'close' : 'open'} the full transcript`}
      onClick={onToggle}
      className="flex h-7 min-w-0 flex-1 items-center overflow-hidden rounded-control text-left focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
    >
      {shown.length > 0 ? (
        <span
          ref={line}
          data-words-line=""
          // No scrollbar: the line moves by itself (scrollTo above); the fade marks the cut-off side.
          className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden data-[overflow]:[mask-image:linear-gradient(to_right,transparent,black_28px)]"
        >
          {shown.map((chip) => (
            <span
              key={chip.id}
              className={`shrink-0 whitespace-nowrap rounded-full border px-2 text-[13px] leading-5 ${chip.speaker === 'you' ? 'border-ui-you text-ui-you' : 'border-ui-border text-ui-text'}`}
            >
              {chip.text}
            </span>
          ))}
        </span>
      ) : (
        <span className="truncate text-[13px] text-ui-muted">
          {state && !state.ended ? 'Listening…' : 'Connecting to the call…'}
        </span>
      )}
    </button>
  );
}

/**
 * ADR-0123: what Ctrl+Enter (⌘↵ on a Mac) answers right now, small and muted beside the words: "Them" while the
 * other side has spoken in the last two minutes (their newest question), "You" otherwise (the user's own newest
 * spoken question). Text only, no tooltip (a title is an unprotected window); screen readers get the sentence.
 *
 * @param props.target Who the key answers now.
 * @param props.mac    True on macOS (the key's name).
 * @returns The hint.
 * Rendered by: StatusBar
 */
function PressHint({
  target,
  mac,
}: {
  /** Who the key answers now. */
  target: 'them' | 'you';
  /** True on macOS (the key's name). */
  mac: boolean;
}) {
  const key = tipShortcut(hotkeyAccelerator('answer', mac), mac);
  const who = target === 'them' ? "the other person's newest question" : 'your own newest question';
  return (
    <span
      role="note"
      data-press-hint={target}
      aria-label={`${key} answers ${who}`}
      className="inline-flex shrink-0 select-none items-center gap-1 text-[12px] font-medium [-webkit-app-region:no-drag]"
    >
      <KeyChip hotkey="answer" visibleAt="@min-[480px]/overlay:inline-flex" />
      <span aria-hidden="true" className={target === 'you' ? 'text-ui-you' : 'text-ui-muted'}>
        {target === 'them' ? 'Them' : 'You'}
      </span>
    </span>
  );
}

/**
 * The transcript bar.
 *
 * @param props See StatusBarProps.
 * @returns The bar (one row).
 * Rendered by: CompactView.tsx
 */
export function StatusBar(props: StatusBarProps) {
  const { state, mac, transcriptOpen } = props;
  // ADR-0110: a Mac's keys on a Mac.
  const clearKey = focusedHotkeys(mac)['clear-transcript'];
  // ADR-0118: the expand button names the transcript's own key (Ctrl+Alt+T, ⌘⌥T on a Mac; while the bars have focus).
  const transcriptKey = hotkeyAccelerator('transcript', mac);
  const toggle = () => props.onTranscript(!transcriptOpen);
  return (
    <div
      role="group"
      aria-label="Status bar"
      className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]"
    >
      <LevelButton
        on={state?.audio.them ?? false}
        levels={props.levels}
        label={transcriptOpen ? 'Hide the transcript' : 'Show the transcript'}
        onClick={toggle}
      />
      <span className="mx-1 flex min-w-0 flex-1 items-center rounded-control bg-ui-overlay-button px-2 py-0.5 [-webkit-app-region:no-drag]">
        <WordsLine state={state} chips={props.chips} open={transcriptOpen} onToggle={toggle} />
      </span>
      {state?.pressTarget && !state.ended && <PressHint target={state.pressTarget} mac={mac} />}
      <button
        type="button"
        className={PILL}
        onClick={props.onClear}
        disabled={!state}
        aria-label="Clear transcript"
        aria-keyshortcuts={hotkeyLabel(clearKey, mac)}
        // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
        // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
        {...{ 'aria-description': `Clear transcript (${tipShortcut(clearKey, mac)})` }}
      >
        Clear <KeyChip hotkey="clear-transcript" visibleAt="@min-[620px]:inline-flex" />
      </button>
      <button
        type="button"
        className={ICON_BUTTON}
        aria-label={transcriptOpen ? 'Close the full transcript' : 'Open the full transcript'}
        aria-pressed={transcriptOpen}
        aria-keyshortcuts={hotkeyLabel(transcriptKey, mac)}
        {...{
          'aria-description': `${transcriptOpen ? 'Close' : 'Open'} the full transcript (${tipShortcut(transcriptKey, mac)})`,
        }}
        onClick={toggle}
      >
        {transcriptOpen ? <CollapseIcon /> : <ExpandIcon />}
      </button>
    </div>
  );
}
