/**
 * File: apps/web/src/features/settings/HotkeyList.tsx
 * Purpose: Settings → Hotkeys: every shortcut with its keys and where it works, and, in the desktop
 *          app, any global shortcut another app already uses (ADR-0029). v1.3.0 (ADR-0056): the overlay's
 *          jump and nudge keys, and Transcript (Ctrl+Alt+T, checked like the others), for a desktop app
 *          with the six positions and the browser; an older desktop app sees its own move row. ADR-0095: a row
 *          shows the keys the desktop app reports holding, so a 1.3.0–1.6.5 app still shows Ctrl+Alt+Arrows.
 *          1.8.0 (ADR-0110): a Mac sees the Mac's keys (⌃⌥ for Clear, previous / next and zoom).
 *          ADR-0110 (amended 25 Nov 2026): in a browser the desktop-only shortcuts (show or hide, moves,
 *          Click-through, Rec) say "Desktop app only"; a shortcut another app holds says whether it still works
 *          with Paramount AI in front (the page handles it) or not at all; on a Mac a note says macOS may not
 *          report a shortcut another app holds.
 * Used by: src/features/settings/Settings.tsx
 * Depends on: @kite/shared (hotkeyRows), src/platform, src/ui/KeyCap.tsx, src/ui/useIsMac.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; docs/design/parakeet-parity.md
 */
'use client';

import {
  desktopOnlyRow,
  hotkeyAccelerator,
  hotkeyRows,
  type HotkeyRow,
  type HotkeyStatus,
} from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';
import { KeyCap } from '@/ui/KeyCap';
import { useIsMac } from '@/ui/useIsMac';

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
 * @param mac       True on a Mac (ADR-0110: the Mac's keys).
 * @returns The rows to show.
 * Called from: HotkeyList; tests
 */
export function hotkeyRowsFor(
  positions: boolean,
  recording = false,
  mac = false,
): readonly HotkeyRow[] {
  return hotkeyRows(mac).filter(
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
 * @param mac      True on a Mac (ADR-0110: the Mac's keys are the row's own).
 * @returns The accelerator to show.
 * Called from: HotkeyList; tests
 */
export function rowKeys(
  row: HotkeyRow,
  statuses: readonly HotkeyStatus[] | null,
  mac = false,
): string {
  const shown = row.keysOverride ?? row.accelerator;
  // Any of the row's shortcuts the app reports, compared with that shortcut's own keys.
  const status = statuses?.find((candidate) => row.actions.includes(candidate.action));
  const held = status?.accelerator;
  if (!status || !held || held === hotkeyAccelerator(status.action, mac)) return shown;
  // "CommandOrControl+Alt+Up" stands for the row's four arrows: "CommandOrControl+Alt+Arrows".
  if (row.keysOverride?.endsWith('+Arrows')) {
    return held.replace(/\+(Up|Down|Left|Right)$/, '+Arrows');
  }
  return row.keysOverride ? shown : held;
}

/**
 * ADR-0110 (amended 25 Nov 2026): what the Works column says for a row.
 *
 * @param row     The row.
 * @param desktop True in the desktop app (false in a browser).
 * @returns "Any app", "Paramount AI in front", or "Desktop app only" (a browser, for show or hide, moves,
 *          Click-through and Rec, which only the desktop app has).
 * Called from: HotkeyList; tests
 */
export function rowWhere(row: HotkeyRow, desktop: boolean): string {
  if (!desktop && desktopOnlyRow(row)) return 'Desktop app only';
  return row.scope === 'global' && desktop ? 'Any app' : 'Paramount AI in front';
}

/**
 * ADR-0110 (amended 25 Nov 2026): what a row says when another app holds its keys. The page handles some
 * shortcuts itself, which then still work with Paramount AI in front; the others do not work at all.
 *
 * @param row The row (with a conflict).
 * @returns The words after "In use by another app".
 * Called from: HotkeyList; tests
 */
export function conflictEffect(row: HotkeyRow): string {
  return desktopOnlyRow(row)
    ? 'does not work during calls'
    : 'works only while Paramount AI is in front';
}

/**
 * ADR-0110 (amended 25 Nov 2026): on a Mac, macOS may give a shortcut to Paramount AI even when another app
 * (a window tool, VoiceOver) uses the same keys, so "In use by another app" may never show there.
 */
export const MAC_CLASH_NOTE =
  'On a Mac, macOS may not tell Paramount AI that another app uses the same keys, so a clash may not show here. If a key does nothing during a call, check window tools such as Rectangle or Magnet (they use ⌃ ⌥ with arrows) and VoiceOver (⌃ ⌥).';

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
  const mac = useIsMac();
  // ADR-0110 (amended 25 Nov 2026): a browser has no global shortcuts, and none of the desktop-only ones.
  const desktop = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind === 'desktop',
    () => false,
  );
  const rows = hotkeyRowsFor(positions, recording, mac);
  const conflicts = rows.filter((row) => rowHasConflict(row, statuses));
  return (
    <>
      <p className="mb-3 text-[13px] text-ui-muted">
        &ldquo;Any app&rdquo; shortcuts work from every app in the desktop app, during a call; Open
        Ask AI works whenever the desktop app is running. &ldquo;Paramount AI in front&rdquo; ones
        never take keys from other apps. In a browser, they work while the Paramount AI tab has the
        keyboard, except the ones marked &ldquo;Desktop app only&rdquo;.
      </p>
      {mac && desktop && <p className="mb-3 text-[13px] text-ui-muted">{MAC_CLASH_NOTE}</p>}
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
                <KeyCap accelerator={rowKeys(row, statuses, mac)} />
              </td>
              <td className="py-2 text-ui-muted">
                {rowWhere(row, desktop)}
                {rowHasConflict(row, statuses) && (
                  <span className="ml-2 text-ui-danger">
                    In use by another app: {conflictEffect(row)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {conflicts.length > 0 && (
        <p role="status" className="mt-3 text-[13px] text-ui-danger">
          Another app uses {conflicts.map((row) => row.label).join(', ')}. Close that app or change
          its shortcut. Until then each one works only while Paramount AI is in front, or not at all
          during calls, as its row says.
        </p>
      )}
    </>
  );
}
