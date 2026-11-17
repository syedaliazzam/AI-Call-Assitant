/**
 * File: apps/web/src/features/settings/HotkeyList.tsx
 * Purpose: Settings → Hotkeys: every shortcut with its keys and where it works, and, in the desktop
 *          app, any global shortcut another app already uses (ADR-0029). v1.3.0 (ADR-0056): the overlay's
 *          jump and nudge keys, and Transcript (Ctrl+Alt+T, checked like the others), for a desktop app
 *          with the six positions and the browser; an older desktop app sees its own move row. ADR-0095: a row
 *          shows the keys the desktop app reports holding, so a 1.3.0–1.6.5 app still shows Ctrl+Alt+Arrows.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: @kite/shared (HOTKEY_ROWS), src/platform, src/ui/KeyCap.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; docs/design/parakeet-parity.md
 */
'use client';

import { HOTKEY_ROWS, hotkeyAccelerator, type HotkeyRow, type HotkeyStatus } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';
import { KeyCap } from '@/ui/KeyCap';

/**
 * Whether another app holds any of a row's global shortcuts.
 *
 * @param row      The row.
 * @param statuses What the desktop app found (null: not checked).
 * @returns True when one is taken.
 * Called from: HotkeyList; tests
 */
export function rowHasConflict(row: HotkeyRow, statuses: readonly HotkeyStatus[] | null): boolean {
  return (statuses ?? []).some(
    (status) => !status.registered && row.actions.includes(status.action),
  );
}

/**
 * The rows for a desktop app with or without the overlay's six positions, and with or without
 * recording (desktop 1.5.0, ADR-0068).
 *
 * @param positions True for a desktop app from 1.3.0, or the browser.
 * @param recording True where meetings can be recorded (a desktop app from 1.5.0).
 * @returns The rows to show.
 * Called from: HotkeyList; tests
 */
export function hotkeyRowsFor(positions: boolean, recording = false): readonly HotkeyRow[] {
  return HOTKEY_ROWS.filter(
    (row) =>
      (row.shells === undefined || (row.shells === 'positions') === positions) &&
      (!row.recording || recording),
  );
}

/**
 * The keys a row shows: its own, or (ADR-0095) the ones the desktop app reports it really holds when they
 * differ. A desktop app before 1.7.0 still moves the overlay with Ctrl+Alt+Arrows (1.7.0: Ctrl+Shift+Arrows),
 * and its list must say so until it updates.
 *
 * @param row      The row.
 * @param statuses What the desktop app reported (null in a browser, or before it answers).
 * @returns The accelerator to show.
 * Called from: HotkeyList; tests
 */
export function rowKeys(row: HotkeyRow, statuses: readonly HotkeyStatus[] | null): string {
  const shown = row.keysOverride ?? row.accelerator;
  // Any of the row's shortcuts the app reports, compared with that shortcut's own keys.
  const status = statuses?.find((candidate) => row.actions.includes(candidate.action));
  const held = status?.accelerator;
  if (!status || !held || held === hotkeyAccelerator(status.action)) return shown;
  // "CommandOrControl+Alt+Up" stands for the row's four arrows: "CommandOrControl+Alt+Arrows".
  if (row.keysOverride?.endsWith('+Arrows')) {
    return held.replace(/\+(Up|Down|Left|Right)$/, '+Arrows');
  }
  return row.keysOverride ? shown : held;
}

/**
 * Never changes after load (the platform is fixed for the page's life).
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: HotkeyList (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * The shortcut list.
 *
 * @returns The list.
 * Rendered by: Settings.tsx
 */
export function HotkeyList() {
  const [statuses, setStatuses] = useState<HotkeyStatus[] | null>(null);
  useEffect(() => {
    getPlatform()
      .checkHotkeys()
      .then(setStatuses)
      .catch(() => undefined);
  }, []);
  const positions = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind !== 'desktop' || getPlatform().overlayPositions(),
    () => true,
  );
  const recording = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().recording !== null,
    () => false,
  );
  const rows = hotkeyRowsFor(positions, recording);
  const conflicts = rows.filter((row) => rowHasConflict(row, statuses));
  return (
    <>
      <p className="mb-3 text-[13px] text-ui-muted">
        &ldquo;Any app&rdquo; shortcuts work from every app in the desktop app, during a call; Open
        Ask AI works whenever the desktop app is running. &ldquo;Paramount AI in front&rdquo; ones
        never take keys from other apps. In a browser, all of them work while Paramount AI has
        focus.
      </p>
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr className="border-b border-ui-border text-ui-muted">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Action
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Keys
            </th>
            <th scope="col" className="py-2 font-semibold">
              Works
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-ui-border">
              <th scope="row" className="py-2 pr-4 font-semibold text-ui-text">
                {row.label}
              </th>
              <td className="py-2 pr-4 text-ui-muted">
                <KeyCap accelerator={rowKeys(row, statuses)} />
              </td>
              <td className="py-2 text-ui-muted">
                {row.scope === 'global' ? 'Any app' : 'Paramount AI in front'}
                {rowHasConflict(row, statuses) && (
                  <span className="ml-2 text-ui-danger">In use by another app</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {conflicts.length > 0 && (
        <p role="status" className="mt-3 text-[13px] text-ui-danger">
          Another app uses {conflicts.map((row) => row.label).join(', ')}. Close that app or change
          its shortcut. Answer and Screenshot still work while Paramount AI is in front.
        </p>
      )}
    </>
  );
}
