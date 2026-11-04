/**
 * File: apps/web/src/features/live/overlay/LiveMenu.tsx
 * Purpose: The overlay's ⋮ menu during a call (v1.1.0, ADR-0041): Dashboard ↗, Private, Zoom, Theme,
 *          Opacity, Font size, Language, Auto answer, Edit session, Open call window and Reset position,
 *          then the answer preferences. An entry shows only where it can work: a browser's
 *          picture-in-picture window has no opacity, a shell before 1.1.0 no separate pages window.
 * Used by: src/features/live/CompactView.tsx
 * Depends on: @kite/shared (ShareProtectionState), src/core/storage (appearancePrefs, overlayPrefs,
 *             types), src/core/live/liveChannel.ts, src/features/privacy/usePrivate.ts,
 *             src/features/session-setup/labels.ts, src/ui (PanelMenu, icons)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5; ADR-0041, ADR-0042
 */
'use client';

import { forwardRef } from 'react';
import type { ShareProtectionState } from '@kite/shared';
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
import { ANSWER_LANGUAGES } from '@/core/storage/types';
import { PRIVATE_LABEL, privateHint } from '@/features/privacy/usePrivate';
import { FORMAT_OPTIONS, LENGTH_OPTIONS, TONE_OPTIONS } from '@/features/session-setup/labels';
import { GlobeIcon, GridIcon, MonitorIcon, PenIcon } from '@/ui/icons';
import {
  MenuAction,
  MenuBlock,
  MenuList,
  MenuStepper,
  MenuSwitch,
  MenuTheme,
} from '@/ui/PanelMenu';

/** How much + and − change the opacity. */
const OPACITY_STEP = 0.05;

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
  /** The theme chosen. */
  theme: ThemeChoice;
  /** The UI scale. */
  zoom: number;
  /** The overlay's text size. */
  fontScale: number;
  /** The chosen panel opacity, where the window can do it. */
  opacity?: number | undefined;
  /** Sets the opacity. */
  onOpacity?: ((value: number) => void) | undefined;
  /** Opens the dashboard, where this app has a separate window for it. */
  onDashboard?: (() => void) | undefined;
  /** Opens Edit session, where this app has a separate window for it. */
  onEditSession?: (() => void) | undefined;
  /** Puts the overlay back at the top centre, where the window can do it. */
  onResetPosition?: (() => void) | undefined;
  /** Opens the full call window. */
  onCallWindow: () => void;
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
  const style = state?.style;
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Overlay settings"
      data-menu="overlay"
      // The window grows to fit it; it scrolls rather than being cut off on a short screen.
      className="k-overlay-menu absolute right-2 top-[3.25rem] z-30 flex max-h-[calc(100vh-3.75rem)] w-72 flex-col gap-1.5 overflow-y-auto rounded-card border border-ui-border p-1.5 shadow-modal [-webkit-app-region:no-drag]"
    >
      <MenuBlock>
        {props.onDashboard && (
          <MenuAction label="Dashboard" icon={<GridIcon />} out onSelect={props.onDashboard} />
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
        <MenuTheme value={props.theme} onChange={setTheme} />
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
          label="Font size"
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
        <MenuList
          label="Answer language"
          icon={<GlobeIcon />}
          value={state?.language ?? 'en'}
          options={ANSWER_LANGUAGES}
          onChange={(code) => onCommand({ type: 'language', code })}
        />
        <MenuSwitch
          label="Auto answer"
          checked={state?.autoAnswer ?? false}
          disabled={!state}
          info="Kite answers a finished question by itself, at most once every 15 seconds. This call only."
          onChange={(on) => onCommand({ type: 'auto-answer', on })}
        />
      </MenuBlock>

      <MenuBlock>
        {props.onEditSession && (
          <MenuAction label="Edit session" icon={<PenIcon />} onSelect={props.onEditSession} />
        )}
        <MenuAction label="Open call window" icon={<MonitorIcon />} onSelect={props.onCallWindow} />
        {props.onResetPosition && (
          <MenuAction label="Reset position" onSelect={props.onResetPosition} />
        )}
      </MenuBlock>

      {style && (
        <MenuBlock>
          <p className="px-2 py-1 text-[12px] font-medium text-ui-muted">Answer preferences</p>
          <MenuList
            label="Format"
            value={style.format}
            options={FORMAT_OPTIONS}
            onChange={(format) => onCommand({ type: 'style', style: { ...style, format } })}
          />
          <MenuList
            label="Length"
            value={style.length}
            options={LENGTH_OPTIONS}
            onChange={(length) => onCommand({ type: 'style', style: { ...style, length } })}
          />
          <MenuList
            label="Tone"
            value={style.tone}
            options={TONE_OPTIONS}
            onChange={(tone) => onCommand({ type: 'style', style: { ...style, tone } })}
          />
        </MenuBlock>
      )}
    </div>
  );
});
