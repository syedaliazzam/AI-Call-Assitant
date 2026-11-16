/**
 * File: apps/web/src/features/live/overlay/StatusBar.tsx
 * Purpose: The overlay's one status bar (ADR-0082; it replaces the warning bar and the two-row transcript
 *          bar, LiveStrip.tsx): the level button (opens or closes the transcript panel), one line, then
 *          Clear (the transcript) and collapse. ADR-0085: no answer-language control (calls are in
 *          English; the session's language is set in the session, not mid-call). The line shows the current warning
 *          or state with its button ("Can't hear the other side · Choose audio source", "Speakers echoing —
 *          use headphones · OK", "Listening… · Cancel"), else the live words or the other person's
 *          question. With the transcript panel open the same row is the panel's header, and its line shows
 *          only the messages (the words are in the panel below).
 * Used by: src/features/live/CompactView.tsx (bar 2), src/features/live/overlay/TranscriptPanel.tsx (header)
 * Depends on: @kite/shared (hotkeys), src/core/live/liveChannel.ts, ./parts.tsx, ./statusLine.ts,
 *             src/ui/icons.tsx
 * Architecture: ADR-0082; docs/design/paramount-ai-ui-spec.md §3 (S13, S15); ADR-0041
 *
 * Transcript words are only rendered on screen; they are never logged.
 */
'use client';

import { FOCUSED_HOTKEYS, hotkeyLabel } from '@kite/shared';
import type { CompactChip, CompactCommand, CompactState } from '@/core/live/liveChannel';
import { CollapseIcon } from '@/ui/icons';
import {
  BUTTON,
  ICON_BUTTON,
  KeyChip,
  LevelButton,
  PILL,
  tipShortcut,
  type LevelStore,
} from './parts';
import { statusMessage, type StatusMessage } from './statusLine';

/** Props for StatusBar. */
export interface StatusBarProps {
  /** What the live page shows (null until it answers). */
  state: CompactState | null;
  /** The chips to show (those on screen when Clear was pressed are gone). */
  chips: readonly CompactChip[];
  /** The live question to show, unless it was cleared. */
  question: string | null;
  /**
   * True for bar 2 (the line shows the words when there is no message); false for the transcript panel's
   * header (the words are in the panel).
   */
  words: boolean;
  /** Whether the transcript panel is open (the level button's state). */
  transcriptOpen: boolean;
  /** Opens or closes the transcript panel (the level button, and a click on the words). */
  onTranscript: (open: boolean) => void;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Clears the words on screen. */
  onClear: () => void;
  /** Collapse: bar 2 collapses the overlay to bar 1; the panel's header closes the panel. */
  onCollapse: () => void;
  /** The collapse button's name. */
  collapseLabel: string;
  /** Opens a device list (a "can't hear" message's button). */
  onList: (list: 'audio' | 'mic') => void;
  /** True while a screen recording runs with Private off. */
  privateOff: boolean;
  /** Turns Private back on. */
  onPrivateOn: () => void;
  /** ADR-0085: true while Private is off during the call (an amber line with Turn on). */
  privateOffInCall?: boolean;
  /** True on macOS (for the shortcuts' spoken names). */
  mac: boolean;
  /** Where the live levels come from. */
  levels?: LevelStore | undefined;
}

/** How many chips the line shows. */
const MAX_CHIPS = 4;

/** Each tone's text colour. */
const TONE: Readonly<Record<StatusMessage['tone'], string>> = {
  alert: 'text-ui-warning',
  warning: 'text-ui-warning',
  listening: 'text-ui-danger',
  muted: 'text-ui-muted',
  offer: 'text-ui-text',
};

/**
 * One message with its button.
 *
 * @param props.message      The message.
 * @param props.onCommand    Sends a command to the live page.
 * @param props.onList       Opens a device list.
 * @param props.onPrivateOn  Turns Private back on.
 * @returns The line's content.
 * Rendered by: StatusBar
 */
function MessageLine({
  message,
  onCommand,
  onList,
  onPrivateOn,
}: {
  /** The message. */
  message: StatusMessage;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Opens a device list. */
  onList: (list: 'audio' | 'mic') => void;
  /** Turns Private back on. */
  onPrivateOn: () => void;
}) {
  const action = message.action;
  return (
    <span data-status={message.key} className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
      <span
        role={message.tone === 'alert' ? 'alert' : 'status'}
        className={`min-w-0 flex-1 truncate ${TONE[message.tone]}`}
        // ADR-0085: words for screen readers (no title: its tooltip is an unprotected window). A spread,
        // as jsx-a11y's role list predates ARIA 1.3's aria-description (Chromium reads it).
        {...{ 'aria-description': message.detail ?? message.text }}
      >
        {message.text}
      </span>
      {action && (
        <button
          type="button"
          // A device list it opens is a popup: a click on this button is not a click outside it.
          {...(action.kind === 'list' ? { 'data-popup-button': '' } : {})}
          className={`${BUTTON} h-6 shrink-0 text-[13px]`}
          onClick={() => {
            if (action.kind === 'command') onCommand(action.command);
            else if (action.kind === 'list') onList(action.list);
            else onPrivateOn();
          }}
        >
          {action.label}
        </button>
      )}
      {message.dismiss && (
        <button
          type="button"
          className={`${BUTTON} h-6 shrink-0 text-[13px]`}
          onClick={() => onCommand(message.dismiss!.command)}
        >
          {message.dismiss.label}
        </button>
      )}
    </span>
  );
}

/**
 * The live words: the other person's question while they ask it, else the latest chips, else
 * "Listening…". A click opens the transcript panel.
 *
 * @param props.state   What the live page shows.
 * @param props.chips   The chips.
 * @param props.question The live question, if any.
 * @param props.onOpen  Opens the transcript panel.
 * @returns The line's content.
 * Rendered by: StatusBar
 */
function WordsLine({
  state,
  chips,
  question,
  onOpen,
}: {
  /** What the live page shows. */
  state: CompactState | null;
  /** The chips. */
  chips: readonly CompactChip[];
  /** The live question, if any. */
  question: string | null;
  /** Opens the transcript panel. */
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="Latest words: open the transcript"
      onClick={onOpen}
      className="flex h-7 min-w-0 flex-1 items-center gap-1 overflow-hidden rounded-control text-left focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] [-webkit-app-region:no-drag]"
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
 * The status bar.
 *
 * @param props See StatusBarProps.
 * @returns The bar (one row).
 * Rendered by: CompactView.tsx, TranscriptPanel.tsx
 */
export function StatusBar(props: StatusBarProps) {
  const { state, mac } = props;
  const message = statusMessage(state, props.privateOff, props.privateOffInCall ?? false);
  const clearKey = FOCUSED_HOTKEYS['clear-transcript'];
  return (
    <div
      role="group"
      aria-label="Status bar"
      className="relative flex h-11 shrink-0 items-center gap-1 px-1.5 [-webkit-app-region:drag]"
    >
      <LevelButton
        on={state?.audio.them ?? false}
        levels={props.levels}
        label={props.transcriptOpen ? 'Hide the transcript' : 'Show the transcript'}
        onClick={() => props.onTranscript(!props.transcriptOpen)}
      />
      <span className="mx-1 flex min-w-0 flex-1 items-center rounded-control bg-ui-overlay-button px-2 py-0.5 [-webkit-app-region:no-drag]">
        {message ? (
          <MessageLine
            message={message}
            onCommand={props.onCommand}
            onList={props.onList}
            onPrivateOn={props.onPrivateOn}
          />
        ) : props.words ? (
          <WordsLine
            state={state}
            chips={props.chips}
            question={props.question}
            onOpen={() => props.onTranscript(true)}
          />
        ) : (
          // The panel's header with nothing to say: the line stays, empty, so the row keeps its shape.
          <span className="h-7 flex-1" />
        )}
      </span>
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
        aria-label={props.collapseLabel}
        onClick={props.onCollapse}
      >
        <CollapseIcon />
      </button>
    </div>
  );
}
