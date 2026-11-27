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
 *          report a shortcut another app holds. ADR-0055 (amended 26 Nov 2026): when another app holds the
 *          Click-through key, a warning says it is the one way to turn Click-through off from the overlay.
 *          Mac 1.8.1 (ADR-0110 amended 27 Nov 2026): the Mac keys are the Windows keys with ⌃; on a Mac each row that
 *          shares a macOS shortcut (⌃ ← / → Mission Control, ⌃ ⌫ text, ⌃ ⌥ VoiceOver) says so (macSystemNotes()).
 *          ADR-0128: the list opens on this computer's set, with a Mac / Windows switch to see the other; in the
 *          desktop app this computer's set shows the keys the app reports holding, for a group row too (a Mac
 *          1.8.0 app's ⌃ ⌥ ← / →); Help shows this same list, and the key-caps and tooltips read the same report
 *          (src/ui/shownKeys.ts).
 * Used by: src/features/settings/Settings.tsx, src/features/help/HelpPage.tsx (the Hotkeys section)
 * Depends on: @kite/shared (hotkeyRows, heldRowKeys), src/platform, src/ui/KeyCap.tsx, src/ui/useIsMac.ts,
 *             src/ui/shownKeys.ts, src/ui/SegmentedControl.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; docs/design/parakeet-parity.md; ADR-0128
 */
'use client';

import {
  desktopOnlyRow,
  heldRowKeys,
  hotkeyLabel,
  hotkeyRows,
  macSystemNotes,
  type HotkeyRow,
  type HotkeyStatus,
} from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';
import { KeyCap } from '@/ui/KeyCap';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { rememberHeldHotkeys } from '@/ui/shownKeys';
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
 * and its list must say so until it updates. ADR-0128: a group row ("Control+Left / Right", the zoom keys) shows
 * the held modifiers too, so a Mac 1.8.0 app reads ⌃ ⌥ ← / → and ⌃ ⌥ = / - / 0 (until then it showed the new
 * keys there); the rule is the shared heldRowKeys(), which Help uses through this list.
 *
 * @param row      The row.
 * @param statuses What the desktop app reported (null in a browser, before it answers, or for the other
 *                 computer's set).
 * @param mac      True for the Mac's keys (ADR-0110: the Mac's keys are the row's own).
 * @returns The accelerator to show.
 * Called from: HotkeyList; tests
 */
export function rowKeys(
  row: HotkeyRow,
  statuses: readonly HotkeyStatus[] | null,
  mac = false,
): string {
  return heldRowKeys(row, statuses, mac);
}

/** ADR-0128: which computer's keys the list shows. */
export type KeySet = 'mac' | 'windows';

/** ADR-0128: the switch's two choices. */
const KEY_SETS = [
  { value: 'mac', label: 'Mac' },
  { value: 'windows', label: 'Windows' },
] as const;

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
  // ADR-0055 (amended 26 Nov 2026): Click-through's key is the one way to turn the mode off from the overlay.
  if (isClickThroughRow(row)) {
    return 'cannot turn Click-through off, so the bars keep their clicks in Click-through mode (W turns it off)';
  }
  return desktopOnlyRow(row)
    ? 'does not work during calls'
    : 'works only while Paramount AI is in front';
}

/**
 * Whether a row is Click-through's (ADR-0055 amended 26 Nov 2026: its key is the way to turn the mode off).
 *
 * @param row The row.
 * @returns True for the Click-through row.
 * Called from: conflictEffect(), HotkeyList; tests
 */
export function isClickThroughRow(row: HotkeyRow): boolean {
  return row.actions.includes('click-through');
}

/**
 * ADR-0055 (amended 26 Nov 2026), safety net (d): the warning when another app holds the Click-through key.
 *
 * @param keys The key as the user reads it ("Ctrl+Alt+X", "⌘ ⌥ X").
 * @returns The warning.
 * Called from: HotkeyList; tests
 */
export function clickThroughClashWarning(keys: string): string {
  return `Another app uses ${keys}, the shortcut that turns Click-through off. While Click-through is on, the whole overlay passes clicks to the app behind it and only that shortcut turns it off, so until you free it the bars keep their clicks in Click-through mode and W on bar 1 turns it off. The call window's "Turn click-through off" always works.`;
}

/**
 * ADR-0110 (amended 25 Nov 2026): on a Mac, macOS may give a shortcut to Paramount AI even when another app
 * (a window tool, VoiceOver) uses the same keys, so "In use by another app" may never show there.
 */
export const MAC_CLASH_NOTE =
  'On a Mac, macOS may not tell Paramount AI that another app uses the same keys, so a clash may not show here. If a key does nothing during a call, check window tools such as Rectangle or Magnet and VoiceOver (⌃ ⌥). The notes under a row name the macOS shortcuts it shares.';

/**
 * Never changes after load (the platform is fixed for the page's life).
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: HotkeyList (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * ADR-0128: the desktop app's report as the list uses it for the set it shows. Only this computer's own set comes
 * from the app: the other computer's keys are the table's, and this app's clashes say nothing about them.
 *
 * @param viewMac  True while the list shows the Mac's set.
 * @param thisMac  True on a Mac.
 * @param statuses What the desktop app reported (null in a browser, or before it answers).
 * @returns The report for the shown set, or null.
 * Called from: HotkeyList; tests
 */
export function statusesForView(
  viewMac: boolean,
  thisMac: boolean,
  statuses: readonly HotkeyStatus[] | null,
): readonly HotkeyStatus[] | null {
  return viewMac === thisMac ? statuses : null;
}

/**
 * The shortcut list, with the Mac / Windows switch (ADR-0128).
 *
 * @returns The list.
 * Rendered by: Settings.tsx, HelpPage.tsx
 */
export function HotkeyList() {
  const [reported, setReported] = useState<HotkeyStatus[] | null>(null);
  useEffect(() => {
    getPlatform()
      .checkHotkeys()
      .then((found) => {
        setReported(found);
        // ADR-0128: the key-caps and tooltips of this page read the same, newer report.
        rememberHeldHotkeys(found);
      })
      .catch(() => undefined);
  }, []);
  // ADR-0128: null until the user picks a set, so the list follows this computer (known after hydration).
  const [picked, setPicked] = useState<KeySet | null>(null);
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
  const thisMac = useIsMac();
  // ADR-0128: the set shown ("mac" shows ⌃ ⌥ ⇧, "windows" Ctrl Alt Shift), this computer's until picked.
  const mac = picked === null ? thisMac : picked === 'mac';
  const statuses = statusesForView(mac, thisMac, reported);
  // ADR-0110 (amended 25 Nov 2026): a browser has no global shortcuts, and none of the desktop-only ones.
  const desktop = useSyncExternalStore(
    subscribeNever,
    () => getPlatform().kind === 'desktop',
    () => false,
  );
  const rows = hotkeyRowsFor(positions, recording, mac);
  const conflicts = rows.filter((row) => rowHasConflict(row, statuses));
  // ADR-0055 (amended 26 Nov 2026): Click-through's key taken gets a warning of its own.
  const clickThroughClash = conflicts.find(isClickThroughRow);
  return (
    <>
      <p className="mb-3 text-[13px] text-ui-muted">
        &ldquo;Any app&rdquo; shortcuts work from every app in the desktop app, during a call; Open
        Ask AI works whenever the desktop app is running. &ldquo;Paramount AI in front&rdquo; ones
        never take keys from other apps. In a browser, they work while the Paramount AI tab has the
        keyboard, except the ones marked &ldquo;Desktop app only&rdquo;.
      </p>
      {/* ADR-0128: a small switch to see the other computer's keys; it opens on this computer's. */}
      <div className="mb-3 w-56" data-key-set={mac ? 'mac' : 'windows'}>
        <SegmentedControl
          label="Keys for"
          options={KEY_SETS}
          value={mac ? 'mac' : 'windows'}
          onChange={(value) => setPicked(value)}
        />
      </div>
      {mac !== thisMac && (
        <p className="mb-3 text-[13px] text-ui-muted">
          {mac
            ? 'These are the keys on a Mac (Mac desktop app 1.8.1 or later, or a browser on a Mac).'
            : 'These are the keys on Windows (Windows desktop app 1.7.5 or later, or a browser on Windows).'}
        </p>
      )}
      {mac && thisMac && desktop && (
        <p className="mb-3 text-[13px] text-ui-muted">{MAC_CLASH_NOTE}</p>
      )}
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
                <KeyCap accelerator={rowKeys(row, statuses, mac)} mac={mac} />
              </td>
              <td className="py-2 text-ui-muted">
                {rowWhere(row, desktop)}
                {mac &&
                  macSystemNotes(row).map((note) => (
                    <span
                      key={note}
                      data-mac-note=""
                      className="mt-1 block text-[12px] text-ui-muted"
                    >
                      {note}
                    </span>
                  ))}
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
      {clickThroughClash && (
        <p
          role="alert"
          data-click-through-clash=""
          className="mt-3 rounded-control border border-ui-warning bg-ui-warning-bg px-3 py-2 text-[13px] text-ui-text"
        >
          {clickThroughClashWarning(hotkeyLabel(rowKeys(clickThroughClash, statuses, mac), mac))}
        </p>
      )}
    </>
  );
}
