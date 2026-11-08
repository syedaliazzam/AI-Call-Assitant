/**
 * File: apps/web/src/features/settings/OverlaySetting.tsx
 * Purpose: The overlay's Settings: the switch "Start calls in the overlay" (ADR-0029; gone in a desktop
 *          app from 1.1.0, where every call starts there, ADR-0041); and, in the desktop app from 1.0.2
 *          (ADR-0035), where the overlay opens and "Reset size and position"; and (v1.1.0) "More
 *          see-through when the pointer is elsewhere", which moved here from the overlay's menu.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/overlayPrefs.ts, src/platform (overlay placement), src/ui (Toggle,
 *             Select, Button)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029, ADR-0035
 */
'use client';

import type { OverlayPreset } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getOverlayFade,
  getStartInOverlay,
  setOverlayFadePref,
  setStartInOverlay,
} from '@/core/storage/overlayPrefs';
import { getPlatform } from '@/platform';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Toggle } from '@/ui/Toggle';

/** The position choices, in the order shown (the first is the default). */
export const OVERLAY_POSITION_OPTIONS: readonly { value: OverlayPreset; label: string }[] = [
  { value: 'top-center', label: 'Top centre (default)' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
];

/**
 * The setting never changes from outside this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: OverlaySetting (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this app can place the overlay (a desktop app from 1.0.2). Server render: no.
 *
 * @returns True where the position controls work.
 * Called from: OverlaySetting (useSyncExternalStore)
 */
const canPlace = () => getPlatform().overlayPlacement();

/**
 * Whether every call starts in the overlay (a desktop app from 1.1.0). Server render: no.
 *
 * @returns True where the "Start calls in the overlay" switch does not apply.
 * Called from: OverlaySetting (useSyncExternalStore)
 */
const alwaysOverlay = () => getPlatform().hasHomePanel();

/**
 * Whether the overlay window can be see-through (the desktop app). Server render: no.
 *
 * @returns True where the fade setting works.
 * Called from: OverlaySetting (useSyncExternalStore)
 */
const hasWindowControls = () => getPlatform().overlayWindowControls();

/**
 * The overlay's settings. The server render shows the defaults (no localStorage or desktop app
 * there); the browser shows the saved values, then the user's choices. The position controls are
 * shown only where they work, so a browser or an older desktop app never shows a dead control.
 *
 * @returns The settings.
 * Rendered by: Settings.tsx
 */
export function OverlaySetting() {
  const saved = useSyncExternalStore(subscribeNever, getStartInOverlay, () => true);
  const [choice, setChoice] = useState<boolean | null>(null);
  const placement = useSyncExternalStore(subscribeNever, canPlace, () => false);
  const always = useSyncExternalStore(subscribeNever, alwaysOverlay, () => false);
  const windowControls = useSyncExternalStore(subscribeNever, hasWindowControls, () => false);
  const savedFade = useSyncExternalStore(subscribeNever, getOverlayFade, () => false);
  const [fade, setFade] = useState<boolean | null>(null);
  // The remembered preset, read from the shell once; null until it answers.
  const [preset, setPreset] = useState<OverlayPreset | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (!placement) return;
    let active = true;
    void getPlatform()
      .getOverlayPreset()
      .then((value) => {
        if (active) setPreset(value);
      });
    return () => {
      active = false;
    };
  }, [placement]);

  return (
    <div className="flex flex-col gap-4">
      {!always && (
        <Toggle
          label="Start calls in the overlay"
          hint="On: Connect opens the overlay on top of your meeting and minimises this window once the call starts. In a browser the overlay is a picture-in-picture window (Chrome or Edge)."
          checked={choice ?? saved}
          onChange={(next) => {
            setStartInOverlay(next);
            setChoice(next);
          }}
        />
      )}
      {windowControls && (
        <Toggle
          label="More see-through when the pointer is elsewhere"
          hint="The overlay's panels stay at the opacity you chose while the pointer is on them."
          checked={fade ?? savedFade}
          onChange={(next) => {
            setOverlayFadePref(next);
            setFade(next);
          }}
        />
      )}
      {placement && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Select
              label="Overlay position"
              hint="Where the overlay opens. Choosing one also moves an open overlay there."
              options={OVERLAY_POSITION_OPTIONS}
              value={preset ?? 'top-center'}
              onChange={(next) => {
                setPreset(next);
                setResetDone(false);
                getPlatform().placeOverlay(next);
              }}
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              // Reset: the default size at the default place, remembered for next time.
              setPreset('top-center');
              getPlatform().placeOverlay('top-center');
              setResetDone(true);
            }}
          >
            Reset size and position
          </Button>
          {resetDone && (
            <p role="status" className="text-[13px] text-ui-muted">
              The overlay is back at the top centre.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
