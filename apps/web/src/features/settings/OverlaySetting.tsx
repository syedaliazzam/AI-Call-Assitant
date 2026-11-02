/**
 * File: apps/web/src/features/settings/OverlaySetting.tsx
 * Purpose: The Settings switch "Start calls in the overlay" (default on; ADR-0029): Connect opens
 *          the overlay and minimises the main window.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: src/core/storage/overlayPrefs.ts, src/ui/Toggle.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (compact view); ADR-0029
 */
'use client';

import { useState, useSyncExternalStore } from 'react';
import { getStartInOverlay, setStartInOverlay } from '@/core/storage/overlayPrefs';
import { Toggle } from '@/ui/Toggle';

/**
 * The setting never changes from outside this page, so nothing needs to be subscribed to.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: OverlaySetting (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * The switch. The server render shows the default (no localStorage there); the browser shows the
 * saved value, then the user's choice.
 *
 * @returns The switch.
 * Rendered by: Settings.tsx
 */
export function OverlaySetting() {
  const saved = useSyncExternalStore(subscribeNever, getStartInOverlay, () => true);
  const [choice, setChoice] = useState<boolean | null>(null);
  return (
    <Toggle
      label="Start calls in the overlay"
      hint="On: Connect opens the overlay on top of your meeting and minimises this window. In a browser, press Overlay once the call is connected: browsers ask for a click first."
      checked={choice ?? saved}
      onChange={(next) => {
        setStartInOverlay(next);
        setChoice(next);
      }}
    />
  );
}
