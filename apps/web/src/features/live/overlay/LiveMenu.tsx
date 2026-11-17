/**
 * File: apps/web/src/features/live/overlay/LiveMenu.tsx
 * Purpose: The ⋮ menu during a call (spec S16): the email, Dashboard ↗, Get help ↗, Private, Zoom, Theme,
 *          Opacity, Answer text size, Auto answer, Answer preferences and Edit session, then
 *          Open call window and Reset position. ADR-0094: a Model row (Fast / Smart, the current one checked;
 *          Smart disabled with "Turned off by your admin" when an admin has turned it off). An entry shows only where it can work: a browser's
 *          picture-in-picture window has no opacity, a shell before 1.1.0 no separate pages window.
 *          v1.3.0 (ADR-0056): in desktop 1.3.0 a Position row, a 2 × 3 grid of the overlay's six
 *          positions with the current one highlighted, replaces Reset position. ADR-0095: a Voice switch (hands-free
 *          talking to the assistant, as bar 1's toggle) after Auto answer; the Model row also offers Fastest (Groq). Desktop 1.5.0
 *          (ADR-0068): Recording type (Screen + audio / Audio only), where the app can record.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (ShareProtectionState), lucide-react, ./ModelChoice.tsx, src/core/storage (appearancePrefs,
 *             overlayPrefs, types), src/core/live/liveChannel.ts, src/features/privacy/usePrivate.ts,
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
import { LifeBuoy, SlidersHorizontal, Sparkles, User, Video } from 'lucide-react';
import { forwardRef } from 'react';
import type { CompactCommand, CompactState } from '@/core/live/liveChannel';
import {
  clampStep,
  FONT_SCALE_RANGE,
  setFontScale,
  setTheme,
  setZoom,
  ZOOM_RANGE,
  type ThemeChoice,
} from '@/core/storage/appearancePrefs';
import { OVERLAY_OPACITY } from '@/core/storage/overlayPrefs';
import type { AnswerModel } from '@/core/storage/types';
import { PRIVATE_LABEL, privateHint } from '@/features/privacy/usePrivate';
import { GridIcon, MonitorIcon, PenIcon } from '@/ui/icons';
import {
  MenuAction,
  MenuBlock,
  MenuList,
  MenuStepper,
  MenuSwitch,
  MenuTheme,
} from '@/ui/PanelMenu';
import { modelOf, ModelOptions } from './ModelChoice';

/** The ⋮ menu's recording types (desktop 1.5.0, ADR-0068). */
export const RECORDING_TYPE_OPTIONS: readonly { value: RecordingKind; label: string }[] = [
  { value: 'screen', label: 'Screen + audio' },
  { value: 'audio', label: 'Audio only' },
];

/** How much + and − change the opacity. */
const OPACITY_STEP = 0.05;

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
  /** The theme chosen. */
  theme: ThemeChoice;
  /** The UI scale. */
  zoom: number;
  /** The answer text size. */
  fontScale: number;
  /** The chosen panel opacity, where the window can do it. */
  opacity?: number | undefined;
  /** Sets the opacity. */
  onOpacity?: ((value: number) => void) | undefined;
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
  /** ADR-0094: closes the menu (after a model is picked). */
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
  const { state, onCommand, protection, zoom, fontScale, opacity, onOpacity } = props;
  // ADR-0094: the Model row, when the live page says its model.
  const modelChoice = props.onModel ? modelOf(state) : null;
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
          onChange={(on) => props.onProtection?.(on)}
        />
        <MenuStepper
          label="Zoom"
          value={`${Math.round(zoom * 100)}%`}
          canMore={zoom < ZOOM_RANGE.max}
          canLess={zoom > ZOOM_RANGE.min}
          onMore={() => setZoom(clampStep(zoom + ZOOM_RANGE.step, ZOOM_RANGE))}
          onLess={() => setZoom(clampStep(zoom - ZOOM_RANGE.step, ZOOM_RANGE))}
          onReset={() => setZoom(ZOOM_RANGE.default)}
        />
        <MenuTheme value={props.theme} onChange={(choice) => setTheme(choice, 'call')} />
      </MenuBlock>

      <MenuBlock>
        {opacity !== undefined && onOpacity && (
          <MenuStepper
            label="Opacity"
            value={`${Math.round(opacity * 100)}%`}
            canMore={opacity < OVERLAY_OPACITY.max}
            canLess={opacity > OVERLAY_OPACITY.min}
            onMore={() =>
              onOpacity(
                Math.min(OVERLAY_OPACITY.max, Math.round((opacity + OPACITY_STEP) * 100) / 100),
              )
            }
            onLess={() =>
              onOpacity(
                Math.max(OVERLAY_OPACITY.min, Math.round((opacity - OPACITY_STEP) * 100) / 100),
              )
            }
            onReset={() => onOpacity(OVERLAY_OPACITY.default)}
          />
        )}
        <MenuStepper
          label="Answer text size"
          value={`${Math.round(fontScale * 100)}%`}
          canMore={fontScale < FONT_SCALE_RANGE.max}
          canLess={fontScale > FONT_SCALE_RANGE.min}
          onMore={() =>
            setFontScale(clampStep(fontScale + FONT_SCALE_RANGE.step, FONT_SCALE_RANGE))
          }
          onLess={() =>
            setFontScale(clampStep(fontScale - FONT_SCALE_RANGE.step, FONT_SCALE_RANGE))
          }
          onReset={() => setFontScale(FONT_SCALE_RANGE.default)}
        />
        {/* ADR-0085: no Answer language here: calls are in English, and the session sets it. */}
        {state?.recording && (
          // Desktop 1.5.0 (ADR-0068): the type the Rec pill and Ctrl+Alt+R start (remembered here).
          <MenuList
            label="Recording type"
            icon={<Video {...ICON} />}
            value={state.recording.kind}
            options={RECORDING_TYPE_OPTIONS}
            onChange={(kind) => onCommand({ type: 'record-kind', kind })}
          />
        )}
        {modelChoice && props.onModel && (
          // ADR-0094: the same two choices as the wizard's "Select model"; applies from the next answer.
          <div role="group" aria-label="Model" data-menu-row="model">
            <p className="flex min-h-10 items-center gap-2.5 px-3 pt-1 text-input text-ui-text">
              <Sparkles {...ICON} />
              <span className="min-w-0 flex-1 truncate">Model</span>
            </p>
            <div className="px-1 pb-1">
              <ModelOptions
                label="Answer model"
                model={modelChoice.model}
                smartAllowed={modelChoice.smartAllowed}
                groqAllowed={modelChoice.groqAllowed}
                onSelect={props.onModel}
                onClose={() => props.onClose?.()}
              />
            </div>
          </div>
        )}
        <MenuSwitch
          label="Auto answer"
          checked={state?.autoAnswer ?? false}
          disabled={!state}
          info="Paramount AI answers a finished question by itself, at most once every 15 seconds. This call only."
          onChange={(on) => onCommand({ type: 'auto-answer', on })}
        />
        {state?.voiceMode !== undefined && (
          // ADR-0095: the same as bar 1's Voice toggle (off by default in every call; Esc turns it off).
          <MenuSwitch
            label="Voice"
            checked={state.voiceMode !== 'off'}
            disabled={state.ended}
            info="Talk to Paramount AI hands-free: each pause sends what you said as a question. Your words aren't sent to the interviewer transcript. It pauses while the other person speaks. Esc turns it off."
            onChange={(on) => onCommand({ type: 'voice-mode', on })}
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
          <PositionGrid position={props.position ?? null} onSelect={props.onPosition} />
        )}
        {props.onResetPosition && (
          <MenuAction label="Reset position" onSelect={props.onResetPosition} />
        )}
      </MenuBlock>
    </div>
  );
});
