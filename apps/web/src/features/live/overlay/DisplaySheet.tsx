/**
 * File: apps/web/src/features/live/overlay/DisplaySheet.tsx
 * Purpose: The ⋮ menu's Display sheet during a call: Zoom, Theme, Opacity (where the window can do it) and
 *          Answer text size, with Back to the menu. They were rows of the ⋮ menu itself until the menu grew
 *          taller than a laptop screen (17 Nov 2026: the Voice switch and the third model); together here they
 *          keep the menu one complete card that needs no scrolling, as Answer preferences already does.
 * Used by: src/features/live/CompactView.tsx (opened from LiveMenu's Display row)
 * Depends on: lucide-react, src/core/storage/appearancePrefs.ts, src/core/storage/overlayPrefs.ts,
 *             src/ui/PanelMenu.tsx, ./parts.tsx (BUTTON)
 * Architecture: docs/design/paramount-ai-ui-spec.md §3 (S16); ADR-0042 (drawn in the page, inside the
 *               protected window)
 */
'use client';

import { ArrowLeft } from 'lucide-react';
import { forwardRef } from 'react';
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
import { MenuBlock, MenuStepper, MenuTheme } from '@/ui/PanelMenu';
import { BUTTON } from './parts';

/** How much + and − change the opacity. */
const OPACITY_STEP = 0.05;

/** Props for DisplaySheet. */
export interface DisplaySheetProps {
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
  /** Goes back to the menu. */
  onBack: () => void;
}

/**
 * The sheet.
 *
 * @param props See DisplaySheetProps.
 * @param ref   Its element, so the window can grow to fit it and outside clicks close it.
 * @returns The sheet.
 * Rendered by: CompactView.tsx
 */
export const DisplaySheet = forwardRef<HTMLDivElement, DisplaySheetProps>(function DisplaySheet(
  { theme, zoom, fontScale, opacity, onOpacity, onBack },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Display"
      data-menu="display"
      className="k-overlay-menu absolute right-1.5 top-[calc(100%+6px)] z-30 flex max-h-[calc(100vh/var(--k-zoom,1)-3.75rem)] w-[21.5rem] flex-col gap-1.5 overflow-y-auto rounded-menu border border-ui-border p-1.5 text-ui-text shadow-modal [-webkit-app-region:no-drag]"
    >
      <div className="flex items-center gap-1 px-1 py-0.5">
        <button type="button" className={BUTTON} onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={14} />
          Back
        </button>
        <span className="text-[13px] font-medium">Display</span>
      </div>
      <MenuBlock>
        <MenuStepper
          label="Zoom"
          value={`${Math.round(zoom * 100)}%`}
          canMore={zoom < ZOOM_RANGE.max}
          canLess={zoom > ZOOM_RANGE.min}
          onMore={() => setZoom(clampStep(zoom + ZOOM_RANGE.step, ZOOM_RANGE))}
          onLess={() => setZoom(clampStep(zoom - ZOOM_RANGE.step, ZOOM_RANGE))}
          onReset={() => setZoom(ZOOM_RANGE.default)}
        />
        <MenuTheme value={theme} onChange={(choice) => setTheme(choice, 'call')} />
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
      </MenuBlock>
    </div>
  );
});
