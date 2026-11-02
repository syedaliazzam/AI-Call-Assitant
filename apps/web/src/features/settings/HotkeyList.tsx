/**
 * File: apps/web/src/features/settings/HotkeyList.tsx
 * Purpose: Settings → Hotkeys: every shortcut with its keys and where it works, and, in the desktop
 *          app, any global shortcut another app already uses (ADR-0029).
 * Used by: src/features/settings/Settings.tsx
 * Depends on: @kite/shared (HOTKEY_ROWS, hotkeyLabel), src/platform
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; docs/design/parakeet-parity.md
 */
'use client';

import { HOTKEY_ROWS, hotkeyLabel, type HotkeyRow, type HotkeyStatus } from '@kite/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';

/**
 * Nothing to subscribe to: the OS does not change during a page's life.
 *
 * @returns An unsubscribe function that does nothing.
 * Called from: HotkeyList (useSyncExternalStore)
 */
const subscribeNever = () => () => undefined;

/**
 * Whether the shortcuts use ⌘ (macOS). Server render: not a Mac.
 *
 * @returns True on macOS.
 * Called from: HotkeyList (useSyncExternalStore)
 */
const isMac = () => getPlatform().hotkeyModifier() === '⌘';

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
 * The shortcut list.
 *
 * @returns The list.
 * Rendered by: Settings.tsx
 */
export function HotkeyList() {
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const [statuses, setStatuses] = useState<HotkeyStatus[] | null>(null);
  useEffect(() => {
    getPlatform()
      .checkHotkeys()
      .then(setStatuses)
      .catch(() => undefined);
  }, []);
  const conflicts = HOTKEY_ROWS.filter((row) => rowHasConflict(row, statuses));
  return (
    <>
      <p className="mb-3 text-sm text-ui-muted">
        &ldquo;Any app&rdquo; shortcuts work from every app in the desktop app, during a call; Open
        Ask Kite works whenever the desktop app is running. &ldquo;Kite in front&rdquo; ones never
        take keys from other apps. In a browser, all of them work while Kite has focus.
      </p>
      <table className="w-full text-left text-sm">
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
          {HOTKEY_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-ui-border">
              <th scope="row" className="py-2 pr-4 font-semibold text-ui-text">
                {row.label}
              </th>
              <td className="py-2 pr-4 text-ui-muted">
                <kbd className="font-mono text-xs">
                  {hotkeyLabel(row.keysOverride ?? row.accelerator, mac)}
                </kbd>
              </td>
              <td className="py-2 text-ui-muted">
                {row.scope === 'global' ? 'Any app' : 'Kite in front'}
                {rowHasConflict(row, statuses) && (
                  <span className="ml-2 text-ui-danger">In use by another app</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {conflicts.length > 0 && (
        <p role="status" className="mt-3 text-sm text-ui-danger">
          Another app uses {conflicts.map((row) => row.label).join(', ')}. Close that app or change
          its shortcut. Answer and Screenshot still work while Kite is in front.
        </p>
      )}
    </>
  );
}
