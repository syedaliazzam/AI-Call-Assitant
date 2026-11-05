/**
 * File: apps/web/src/features/live/overlay/parts.tsx
 * Purpose: The small pieces the call bars and panels share (spec S13–S15, ADR-0041): button looks,
 *          key-caps, the level bars and their button, the language list, the Auto answer pill and the
 *          status icons.
 * Used by: src/features/live/CompactView.tsx, src/features/live/overlay/*, src/features/live/TopBar.tsx
 * Depends on: @kite/shared (KeycapHotkey), src/core/live/liveChannel.ts, src/core/storage/types.ts
 *             (languages), src/ui (KeyCap, icons), React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1 (overlay), §3 (S13–S15); ADR-0041
 *
 * No title attributes here: a browser's title tooltip is a separate window that screen-share protection
 * may not reach (ADR-0042). Names go in aria-label, and hints are drawn in the page.
 */
'use client';

import type { KeycapHotkey } from '@kite/shared';
import { useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import type { CompactCommand, CompactLevels, CompactState } from '@/core/live/liveChannel';
import { ANSWER_LANGUAGES } from '@/core/storage/types';
import { ChevronDownIcon, GlobeIcon } from '@/ui/icons';
import { KeyCap } from '@/ui/KeyCap';

/**
 * A button's shape in a bar, without its side padding: a narrow icon button has none, and a later
 * "px-0" would not beat a "px-2" in the same class list (the order in the stylesheet decides).
 */
const BUTTON_SHAPE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-control text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]';

/** A button in a bar: not part of the drag handle, always a clear focus ring. */
export const BUTTON_BASE = `${BUTTON_SHAPE} px-2`;

/** A button in a bar, in the normal colours. */
export const BUTTON = `${BUTTON_BASE} bg-ui-overlay-button text-ui-text hover:bg-ui-overlay-button-hover`;

/** A pill button on the call bars (spec §1): Answer, Screenshot, Chat, Clear. */
export const PILL = `${BUTTON_BASE} bg-ui-pill text-ui-text hover:bg-ui-pill-hover`;

/** An icon button, as wide as it is tall. */
export const ICON_BUTTON = `${BUTTON_SHAPE} w-8 bg-ui-overlay-button text-ui-text hover:bg-ui-overlay-button-hover pointer-coarse:min-w-11`;

/** The narrow ▾ beside an icon. */
export const CHEVRON_BUTTON = `${BUTTON_SHAPE} w-5 text-ui-text hover:bg-ui-overlay-button`;

/** A quiet icon button for an answer's footer; the caller adds its colour. */
export const FOOTER_BUTTON = `${BUTTON_SHAPE} w-8 hover:bg-ui-overlay-button pointer-coarse:min-w-11`;

/**
 * One piece of the stacked overlay: its own rounded panel, see-through in the desktop app.
 *
 * @param glass True for the see-through panel.
 * @returns The classes.
 * Called from: CompactView.tsx, ScriptBar.tsx
 */
export function pieceClass(glass: boolean): string {
  return `k-overlay ${glass ? 'k-glass' : ''} rounded-bar border border-ui-border text-ui-text`;
}

/**
 * A key-cap on a button, hidden from screen readers (the button keeps its plain name). Hidden too when
 * the window is too narrow to fit it, for example a narrow picture-in-picture window.
 *
 * @param props.hotkey    Which shortcut.
 * @param props.visibleAt The container width from which it shows, as a Tailwind class; absent: always.
 * @param props.onPrimary True on a primary button, whose colours are reversed.
 * @returns The chip.
 * Rendered by: ControlBar.tsx, ChatBar.tsx, LiveStrip.tsx, TranscriptPanel.tsx, OverlayAnswer.tsx
 */
export function KeyChip({
  hotkey,
  visibleAt,
  onPrimary = false,
}: {
  /** Which shortcut. */
  hotkey: KeycapHotkey;
  /** The container width from which it shows, as a Tailwind class. */
  visibleAt?: string;
  /** True on a primary button, whose colours are reversed. */
  onPrimary?: boolean;
}) {
  return (
    <span aria-hidden="true" className={visibleAt ? `hidden ${visibleAt}` : 'inline-flex'}>
      <KeyCap hotkey={hotkey} onPrimary={onPrimary} />
    </span>
  );
}

/** The audio levels, kept outside React state so only the level bars redraw (v1.1.0). */
export interface LevelStore {
  /** The latest levels. */
  get: () => CompactLevels;
  /**
   * Listens for new levels.
   *
   * @param listener Called on each update.
   * @returns A function that stops listening.
   */
  subscribe: (listener: () => void) => () => void;
}

/** No levels (a harness, or before the live page has sent any). */
const SILENT: CompactLevels = { you: 0, them: 0 };

/** How tall each bar can be, in px, at full level; they move together around these. */
const BAR_SHAPE = [0.55, 1, 0.7, 0.85];

/**
 * The level bars: they move with the other side's sound, in the accent colour, and turn red when its
 * audio is not connected.
 *
 * @param props.on     True while the other side's audio is connected.
 * @param props.levels Where the live levels come from, if anywhere.
 * @returns The bars.
 * Rendered by: LevelButton, IconMode.tsx
 */
export function LevelBars({
  on,
  levels,
}: {
  /** True while the other side's audio is connected. */
  on: boolean;
  /** Where the live levels come from, if anywhere. */
  levels?: LevelStore | undefined;
}) {
  const level = useSyncExternalStore(
    levels?.subscribe ?? (() => () => undefined),
    levels?.get ?? (() => SILENT),
    () => SILENT,
  ).them;
  return (
    <span
      role="img"
      aria-label={
        on ? "The other side's audio: connected" : "The other side's audio: not connected"
      }
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center gap-[3px] ${on ? 'text-ui-accent' : 'text-ui-danger'}`}
    >
      {BAR_SHAPE.map((shape, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current transition-[height] duration-100"
          // Still a row of bars in silence (spec S13), and they grow with the sound.
          style={{ height: Math.round(4 + 6 * shape + 9 * shape * Math.min(1, level * 1.6)) }}
        />
      ))}
    </span>
  );
}

/**
 * One side's status: its icon, with a red dot while it is capturing.
 *
 * @param props.on    True when it is capturing.
 * @param props.label Which side, for screen readers.
 * @param props.icon  Its icon.
 * @returns The status.
 * Rendered by: ControlBar.tsx
 */
export function StatusIcon({
  on,
  label,
  icon,
}: {
  /** True when it is capturing. */
  on: boolean;
  /** Which side, for screen readers. */
  label: string;
  /** Its icon. */
  icon: ReactNode;
}) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${on ? 'capturing' : 'not connected'}`}
      className={`relative inline-flex h-8 w-7 shrink-0 items-center justify-center ${on ? 'text-ui-text' : 'text-ui-muted'}`}
    >
      {icon}
      {on && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-1 size-2 rounded-full bg-ui-dot-danger"
        />
      )}
    </span>
  );
}

/**
 * The level bars as a button: it opens or closes the transcript panel.
 *
 * @param props.on      True while the other side's audio is connected.
 * @param props.levels  Where the live levels come from, if anywhere.
 * @param props.label   What pressing it does.
 * @param props.onClick Opens or closes the panel.
 * @returns The button.
 * Rendered by: LiveStrip.tsx, TranscriptPanel.tsx
 */
export function LevelButton({
  on,
  levels,
  label,
  onClick,
}: {
  /** True while the other side's audio is connected. */
  on: boolean;
  /** Where the live levels come from, if anywhere. */
  levels?: LevelStore | undefined;
  /** What pressing it does. */
  label: string;
  /** Opens or closes the panel. */
  onClick: () => void;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        className={`${ICON_BUTTON} bg-ui-pill`}
        aria-label={label}
        onClick={onClick}
      >
        <LevelBars on={on} levels={levels} />
      </button>
    </span>
  );
}

/**
 * The answer language: a button and, while open, its list. In the page, not a browser's own list
 * (ADR-0042). Answers use it; the transcript stays English, because the speech model is English only.
 *
 * @param props.state     What the live page shows.
 * @param props.onCommand Sends a command to the live page.
 * @param props.open      True while the list is open.
 * @param props.onOpen    Opens or closes the list.
 * @param props.listRef   The list's element, so the window can grow to fit it.
 * @returns The button and the list.
 * Rendered by: LiveStrip.tsx, TranscriptPanel.tsx
 */
export function LanguageControl({
  state,
  onCommand,
  open,
  onOpen,
  listRef,
}: {
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** True while the list is open. */
  open: boolean;
  /** Opens or closes the list. */
  onOpen: (open: boolean) => void;
  /** The list's element. */
  listRef?: RefObject<HTMLUListElement | null>;
}) {
  const language = ANSWER_LANGUAGES.find((option) => option.value === state?.language);
  return (
    <>
      <button
        type="button"
        data-popup-button
        className={PILL}
        aria-label={`Answer language: ${language?.label ?? 'English'}`}
        aria-expanded={open}
        onClick={() => onOpen(!open)}
      >
        <GlobeIcon />
        {language?.label ?? 'English'}
        <ChevronDownIcon size={14} />
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Answer language"
          className="k-overlay-menu absolute left-10 top-9 z-30 flex max-h-56 w-44 flex-col overflow-y-auto rounded-control border border-ui-border py-1 text-[13px] shadow-modal [-webkit-app-region:no-drag]"
        >
          {ANSWER_LANGUAGES.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === state?.language}
                onClick={() => {
                  onOpen(false);
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
    </>
  );
}

/**
 * The Auto answer pill: a toggle with a dot that says whether it is on.
 *
 * @param props.state     What the live page shows.
 * @param props.onCommand Sends a command to the live page.
 * @returns The pill.
 * Rendered by: CompactView.tsx, OverlayAnswer.tsx
 */
export function AutoAnswerPill({
  state,
  onCommand,
}: {
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
}) {
  const on = state?.autoAnswer ?? false;
  return (
    <button
      type="button"
      className={PILL}
      aria-pressed={on}
      disabled={!state}
      onClick={() => onCommand({ type: 'auto-answer', on: !on })}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${on ? 'bg-ui-accent' : 'bg-ui-muted'}`}
      />
      Auto answer {on ? 'On' : 'Off'}
    </button>
  );
}
