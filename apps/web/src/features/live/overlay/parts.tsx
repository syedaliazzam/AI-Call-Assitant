/**
 * File: apps/web/src/features/live/overlay/parts.tsx
 * Purpose: The small pieces the stacked overlay's bars and panels share (v1.1.0, ADR-0041): button
 *          looks, key hints in their short form, the level bars and the status icons.
 * Used by: src/features/live/CompactView.tsx, src/features/live/overlay/*, src/features/live/TopBar.tsx
 * Depends on: src/core/live/liveChannel.ts (CompactLevels), React
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041
 *
 * No title attributes here: a browser's title tooltip is a separate window that screen-share protection
 * may not reach (ADR-0042). Names go in aria-label, and hints are drawn in the page.
 */
'use client';

import { useSyncExternalStore, type ReactNode } from 'react';
import type { CompactLevels } from '@/core/live/liveChannel';

/** A button in a bar: not part of the drag handle, always a clear focus ring. */
export const BUTTON_BASE =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-control px-2 text-[13px] font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 [-webkit-app-region:no-drag]';

/** A button in a bar, in the normal colours. */
export const BUTTON = `${BUTTON_BASE} bg-ui-overlay-button text-ui-text hover:bg-ui-overlay-button-hover`;

/** An icon button, as wide as it is tall. */
export const ICON_BUTTON = `${BUTTON} w-8 px-0 pointer-coarse:min-w-11`;

/** A quiet icon button for an answer's footer; the caller adds its colour. */
export const FOOTER_BUTTON = `${BUTTON_BASE} w-8 px-0 hover:bg-ui-overlay-button pointer-coarse:min-w-11`;

/**
 * One piece of the stacked overlay: its own rounded panel, see-through in the desktop app.
 *
 * @param glass True for the see-through panel.
 * @returns The classes.
 * Called from: CompactView.tsx, ScriptBar.tsx
 */
export function pieceClass(glass: boolean): string {
  return `k-overlay ${glass ? 'k-glass' : ''} rounded-card border border-ui-border text-ui-text`;
}

/**
 * A shortcut shown on a button, hidden from screen readers (the button keeps its plain name). Shown at
 * every width the window allows; hidden only below that, for example in a narrow picture-in-picture
 * window.
 *
 * @param props.children The keys.
 * @returns The label.
 * Rendered by: ControlBar.tsx, LiveStrip.tsx, TranscriptPanel.tsx, OverlayAnswer.tsx
 */
export function Keys({
  children,
}: {
  /** The keys. */
  children: ReactNode;
}) {
  return (
    <kbd
      aria-hidden="true"
      className="hidden whitespace-nowrap rounded-full bg-ui-overlay-button px-1 text-[12px] font-normal @min-[540px]:inline"
    >
      {children}
    </kbd>
  );
}

/**
 * A shortcut in the short form used on buttons: "Ctrl↵", "Ctrl⇧↵", "Ctrl⇧␣" (⌘↵, ⌘⇧↵, ⌘⇧␣ on macOS).
 *
 * @param accelerator An Electron accelerator, for example 'CommandOrControl+Shift+Enter'.
 * @param mac         True on macOS.
 * @returns The short label.
 * Called from: ControlBar.tsx, LiveStrip.tsx, TranscriptPanel.tsx, OverlayAnswer.tsx, TopBar.tsx; tests
 */
export function shortKeys(accelerator: string, mac: boolean): string {
  const glyphs: Record<string, string> = {
    CommandOrControl: mac ? '⌘' : 'Ctrl',
    Shift: '⇧',
    Alt: mac ? '⌥' : 'Alt',
    Enter: '↵',
    Backspace: '⌫',
    Space: '␣',
    Left: '←',
    Right: '→',
  };
  const parts = accelerator.split('+').map((part) => glyphs[part] ?? part);
  // No spaces: they must fit the 560 px bar.
  return parts.join('');
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
 * The level bars at the start of the live-words row: they move with the other side's sound, and turn
 * red when its audio is not connected.
 *
 * @param props.on     True while the other side's audio is connected.
 * @param props.levels Where the live levels come from, if anywhere.
 * @returns The bars.
 * Rendered by: LiveStrip.tsx, TranscriptPanel.tsx
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
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center gap-[3px] ${on ? 'text-ui-success' : 'text-ui-danger'}`}
    >
      {BAR_SHAPE.map((shape, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current transition-[height] duration-100"
          // 5 px at rest, so the bars show even in silence.
          style={{ height: 5 + Math.round(14 * shape * Math.min(1, level * 1.6)) }}
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
