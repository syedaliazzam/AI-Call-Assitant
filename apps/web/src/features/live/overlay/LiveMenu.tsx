/**
 * File: apps/web/src/features/live/overlay/LiveMenu.tsx
 * Purpose: The ⋮ menu during a call (spec S16): the email, Dashboard ↗, Get help ↗, Private, Display ›
 *          (Zoom, Theme, Opacity and Answer text size, in DisplaySheet.tsx since 17 Nov 2026, so the menu stays
 *          one complete card on a laptop screen), Auto answer, Answer preferences and Edit session, then
 *          Open call window and Reset position. ADR-0094: a Model row (Fast / Smart, the current one checked;
 *          Smart disabled with "Turned off by your admin" when an admin has turned it off). An entry shows only where it can work: a browser's
 *          picture-in-picture window has no opacity, a shell before 1.1.0 no separate pages window.
 *          v1.3.0 (ADR-0056): in desktop 1.3.0 a Position row, a 2 × 3 grid of the overlay's six
 *          positions with the current one highlighted, replaces Reset position. ADR-0095: a Voice switch (hands-free
 *          talking to the assistant, as bar 1's toggle) after Auto answer; the Model row also offers Fastest (Groq),
 *          and is one row showing the current model that opens its three choices in place. Desktop 1.5.0
 *          (ADR-0068): Recording type (Screen + audio / Audio only), where the app can record.
 *          ADR-0105 (desktop 1.7.1): choosing an item (a switch, a recording type, a position, a link) closes
 *          the menu; Display, Answer preferences and the Model row open more instead.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (ShareProtectionState), lucide-react, ./ModelChoice.tsx, src/core/storage (types),
 *             src/core/live/liveChannel.ts, src/features/privacy/usePrivate.ts,
 *             src/ui (PanelMenu, icons)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S16); ADR-0041, ADR-0042
 */
'use client';

import {
  DEFAULT_GLOBAL_HOTKEYS,
  hotkeyLabel,
  OVERLAY_GRID,
  type OverlayPreset,
  type RecordingKind,
  type ShareProtectionState,
} from '@kite/shared';
import { LifeBuoy, MonitorCog, SlidersHorizontal, Sparkles, User, Video } from 'lucide-react';
import { forwardRef, useState } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import type { AnswerModel } from '@/core/storage/types';
import { PRIVATE_LABEL, privateHint } from '@/features/privacy/usePrivate';
import { ChevronDownIcon, GridIcon, MonitorIcon, PenIcon } from '@/ui/icons';
import { MenuAction, MenuBlock, MenuList, MenuSwitch } from '@/ui/PanelMenu';
import { modelEntry } from '@/core/session/modelChoices';
import { modelOf, ModelOptions } from './ModelChoice';

/** The ⋮ menu's recording types (desktop 1.5.0, ADR-0068). */
export const RECORDING_TYPE_OPTIONS: readonly { value: RecordingKind; label: string }[] = [
  { value: 'screen', label: 'Screen + audio' },
  { value: 'audio', label: 'Audio only' },
];

/** The icons in the rows this file adds. */
const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true, className: 'shrink-0' } as const;

/** Each position's name, for its button (ADR-0056). */
export const POSITION_NAMES: Readonly<Record<OverlayPreset, string>> = {
  'top-left': 'Top left',
  'top-center': 'Top centre',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
};

/**
 * The Position row (v1.3.0, ADR-0056): six small screens in a 2 × 3 grid, each with a bar where the
 * overlay would sit; the current one is highlighted. A click puts the overlay there.
 *
 * @param props.position The current position (null until the shell says).
 * @param props.onSelect Puts the overlay at a position.
 * @returns The row.
 * Rendered by: LiveMenu
 */
export function PositionGrid({
  position,
  onSelect,
}: {
  /** The current position (null until the shell says). */
  position: OverlayPreset | null;
  /** Puts the overlay at a position. */
  onSelect: (preset: OverlayPreset) => void;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-2 text-input text-ui-text">
      <span id="overlay-position-label">Position</span>
      <div
        role="radiogroup"
        aria-labelledby="overlay-position-label"
        className="grid grid-cols-3 gap-1"
      >
        {[...OVERLAY_GRID.top, ...OVERLAY_GRID.bottom].map((preset) => {
          const current = preset === position;
          const bottom = preset.startsWith('bottom');
          const column = preset.endsWith('left')
            ? 'justify-start'
            : preset.endsWith('right')
              ? 'justify-end'
              : 'justify-center';
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={current}
              aria-label={POSITION_NAMES[preset]}
              onClick={() => onSelect(preset)}
              className={`flex h-6 w-9 rounded-[5px] border p-[3px] ${column} ${bottom ? 'items-end' : 'items-start'} ${
                current
                  ? 'border-ui-primary bg-ui-primary/15'
                  : 'border-ui-border hover:bg-ui-hover'
              } focus-visible:outline-none focus-visible:shadow-[var(--k-focus)]`}
            >
              <span
                aria-hidden="true"
                className={`block h-1.5 w-3.5 rounded-[2px] ${current ? 'bg-ui-primary' : 'bg-ui-muted'}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Props for LiveMenu. */
export interface LiveMenuProps {
  /** What the live page shows. */
  state: CompactState | null;
  /** Sends a command to the live page. */
  onCommand: (command: CompactCommand) => void;
  /** Protection (null where it does not apply). */
  protection: ShareProtectionState | null;
  /** Turns protection on or off. */
  onProtection?: ((on: boolean) => void) | undefined;
  /** The signed-in person's email, once known. */
  email?: string | null | undefined;
  /** Opens the Display sheet (Zoom, Theme, Opacity, Answer text size: DisplaySheet.tsx). */
  onDisplay: () => void;
  /** Opens the dashboard, where this app has a separate window for it. */
  onDashboard?: (() => void) | undefined;
  /** Opens the user guide, likewise. */
  onHelp?: (() => void) | undefined;
  /** Opens Edit session, likewise. */
  onEditSession?: (() => void) | undefined;
  /** Puts the overlay back at the top centre, where the window can do it (before desktop 1.3.0). */
  onResetPosition?: (() => void) | undefined;
  /** The overlay's position (desktop 1.3.0, ADR-0056). */
  position?: OverlayPreset | null;
  /** Puts the overlay at one of the six positions; absent where there are none. */
  onPosition?: ((preset: OverlayPreset) => void) | undefined;
  /** Opens the full call window. */
  onCallWindow: () => void;
  /**
   * v1.3.2: turns Click-through on or off; absent where the window cannot pass clicks through (a
   * browser, an older desktop app).
   */
  onClickThrough?: ((on: boolean) => void) | undefined;
  /** v1.3.2: true on macOS, for the shortcut's words (⌘ for Ctrl). */
  mac?: boolean;
  /** Opens the answer preferences. */
  onPreferences: () => void;
  /**
   * ADR-0094: switches this session's answer model (from the next answer). Absent: no Model row.
   */
  onModel?: ((model: AnswerModel) => void) | undefined;
  /** ADR-0094: closes the menu (after a model is picked; ADR-0105: after any choice). */
  onClose?: (() => void) | undefined;
}

/**
 * The menu.
 *
 * @param props See LiveMenuProps.
 * @param ref   Its element, so the window can grow to fit it.
 * @returns The menu.
 * Rendered by: CompactView.tsx
 */
export const LiveMenu = forwardRef<HTMLDivElement, LiveMenuProps>(function LiveMenu(props, ref) {
  const { state, onCommand, protection } = props;
  // ADR-0094: the Model row, when the live page says its model.
  const modelChoice = props.onModel ? modelOf(state) : null;
  // The Model row's three choices, open in place under it (one row while shut keeps the menu short).
  const [modelOpen, setModelOpen] = useState(false);
  /**
   * ADR-0105: a choice (a switch, a recording type, a position) is applied, then the menu closes. Rows that
   * open more (Display, Answer preferences, the Model row) keep it open; the links close it in CompactView.
   *
   * @param apply Applies the choice.
   * @returns The handler for the row.
   */
  const chosen =
    <T,>(apply: (value: T) => void) =>
    (value: T) => {
      apply(value);
      props.onClose?.();
    };
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Overlay settings"
      data-menu="overlay"
      // The window grows to fit it; it scrolls rather than being cut off on a short screen.
      className="k-overlay-menu absolute right-1.5 top-[calc(100%+6px)] z-30 flex max-h-[calc(100vh/var(--k-zoom,1)-3.75rem)] w-[21.5rem] flex-col gap-1.5 overflow-y-auto rounded-menu border border-ui-border p-1.5 shadow-modal [-webkit-app-region:no-drag]"
    >
      <MenuBlock>
        {props.email && (
          <p className="flex min-h-10 items-center gap-2.5 px-3 text-input text-ui-text">
            <User {...ICON} />
            <span className="min-w-0 truncate">{props.email}</span>
          </p>
        )}
        {props.onDashboard && (
          <MenuAction label="Dashboard" icon={<GridIcon />} out onSelect={props.onDashboard} />
        )}
        {props.onHelp && (
          <MenuAction label="Get help" icon={<LifeBuoy {...ICON} />} out onSelect={props.onHelp} />
        )}
        <MenuSwitch
          label={PRIVATE_LABEL}
          info={privateHint(protection)}
          checked={protection?.on ?? false}
          disabled={!protection?.supported || !props.onProtection}
          onChange={chosen((on: boolean) => props.onProtection?.(on))}
        />
        <MenuAction
          label="Display"
          icon={<MonitorCog {...ICON} />}
          info="Zoom, theme, opacity and answer text size."
          onSelect={props.onDisplay}
        />
      </MenuBlock>

      <MenuBlock>
        {/* ADR-0085: no Answer language here: calls are in English, and the session sets it. */}
        {state?.recording && (
          // Desktop 1.5.0 (ADR-0068): the type the Rec pill and Ctrl+Alt+R start (remembered here).
          <MenuList
            label="Recording type"
            icon={<Video {...ICON} />}
            value={state.recording.kind}
            options={RECORDING_TYPE_OPTIONS}
            onChange={chosen((kind: RecordingKind) => onCommand({ type: 'record-kind', kind }))}
          />
        )}
        {modelChoice && props.onModel && (
          // ADR-0094: the same choices as the wizard's "Select model"; applies from the next answer. One row
          // with the model in use; its choices open in place under it.
          <div role="group" aria-label="Model" data-menu-row="model">
            <button
              type="button"
              aria-expanded={modelOpen}
              aria-label={`Model: ${modelEntry(modelChoice.model).label}`}
              onClick={() => setModelOpen((was) => !was)}
              className="flex min-h-10 w-full items-center gap-2.5 px-3 py-1 text-left text-input text-ui-text hover:bg-ui-hover focus-visible:outline-none focus-visible:[box-shadow:var(--k-focus)]"
            >
              <Sparkles {...ICON} />
              <span className="shrink-0">Model</span>
              <span className="min-w-0 flex-1 truncate text-right text-[13px] text-ui-muted">
                {modelEntry(modelChoice.model).label}
              </span>
              <ChevronDownIcon size={14} />
            </button>
            {modelOpen && (
              <div className="px-1 pb-1">
                <ModelOptions
                  label="Answer model"
                  model={modelChoice.model}
                  smartAllowed={modelChoice.smartAllowed}
                  groqAllowed={modelChoice.groqAllowed}
                  geminiAllowed={modelChoice.geminiAllowed}
                  openaiAllowed={modelChoice.openaiAllowed}
                  moreModels={modelChoice.moreModels}
                  onSelect={props.onModel}
                  onClose={() => {
                    setModelOpen(false);
                    props.onClose?.();
                  }}
                />
              </div>
            )}
          </div>
        )}
        <MenuSwitch
          label="Auto answer"
          checked={state?.autoAnswer ?? false}
          disabled={!state}
          info="Paramount AI answers a finished question by itself, at most once every 15 seconds. This call only."
          onChange={chosen((on: boolean) => onCommand({ type: 'auto-answer', on }))}
        />
        {state?.voiceMode !== undefined && (
          // ADR-0095: the same as bar 1's Voice toggle (off by default in every call; Esc turns it off).
          <MenuSwitch
            label="Voice"
            checked={state.voiceMode !== 'off'}
            disabled={state.ended}
            info="Talk to Paramount AI hands-free: each pause sends what you said as a question. Your words aren't sent to the interviewer transcript. It pauses while the other person speaks. Esc turns it off."
            onChange={chosen((on: boolean) => onCommand({ type: 'voice-mode', on }))}
          />
        )}
        {props.onClickThrough && (
          <MenuSwitch
            label="Click-through"
            checked={state?.clickThrough ?? false}
            disabled={!state}
            info={`Clicks and typing outside the bars go to the app behind, so you can work in it with the panels open. The bars still take clicks, to turn this off. ${hotkeyLabel(DEFAULT_GLOBAL_HOTKEYS['click-through'], props.mac ?? false)}`}
            onChange={(on) => props.onClickThrough?.(on)}
          />
        )}
        {state?.style && (
          <MenuAction
            label="Answer preferences"
            icon={<SlidersHorizontal {...ICON} />}
            info="How answers are shaped: format, length and tone."
            onSelect={props.onPreferences}
          />
        )}
        {props.onEditSession && (
          <MenuAction
            label="Edit session"
            icon={<PenIcon />}
            info="Opens this session's details in another window. The call keeps running."
            onSelect={props.onEditSession}
          />
        )}
      </MenuBlock>

      <MenuBlock>
        <MenuAction label="Open call window" icon={<MonitorIcon />} onSelect={props.onCallWindow} />
        {props.onPosition && (
          <PositionGrid position={props.position ?? null} onSelect={chosen(props.onPosition)} />
        )}
        {props.onResetPosition && (
          <MenuAction label="Reset position" onSelect={props.onResetPosition} />
        )}
      </MenuBlock>
    </div>
  );
});
