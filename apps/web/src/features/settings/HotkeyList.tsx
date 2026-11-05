/**
 * File: apps/web/src/features/settings/HotkeyList.tsx
 * Purpose: Settings → Hotkeys: every shortcut with its keys and where it works, and, in the desktop
 *          app, any global shortcut another app already uses (ADR-0029).
 * Used by: src/features/settings/Settings.tsx
 * Depends on: @kite/shared (HOTKEY_ROWS), src/platform, src/ui/KeyCap.tsx
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.3; docs/design/parakeet-parity.md
 */
'use client';

import { HOTKEY_ROWS, type HotkeyRow, type HotkeyStatus } from '@kite/shared';
import { useEffect, useState } from 'react';
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
  const conflicts = HOTKEY_ROWS.filter((row) => rowHasConflict(row, statuses));
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
          {HOTKEY_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-ui-border">
              <th scope="row" className="py-2 pr-4 font-semibold text-ui-text">
                {row.label}
              </th>
              <td className="py-2 pr-4 text-ui-muted">
                <KeyCap accelerator={row.keysOverride ?? row.accelerator} />
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
