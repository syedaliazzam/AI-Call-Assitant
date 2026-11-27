/**
 * File: apps/web/src/ui/shownKeys.ts
 * Purpose: ADR-0128: the one place the screens get a shortcut's keys from. Settings → Hotkeys, Help, the key-cap
 *          chips and the call bars' tooltips all read the keys here, so they never disagree. In the desktop app the
 *          keys are the ones the app reports holding (a Mac 1.8.0 or Windows 1.7.4 app still holds its own
 *          release's keys until it updates); elsewhere, and until the app answers, the shared table's keys for this
 *          computer (@kite/shared hotkeyAccelerator()).
 * Used by: src/ui/KeyCap.tsx, src/features/settings/HotkeyList.tsx, src/features/live (the bars' tooltips and
 *          notices), src/features/home/LauncherConnect.tsx
 * Depends on: @kite/shared (heldAccelerator, hotkeyLabel), src/platform (checkHotkeys), React
 * Architecture: docs/decisions/ADR-0128-hotkeys-per-computer-one-source.md
 */
'use client';

import { heldAccelerator, hotkeyLabel, type HotkeyStatus, type KeycapHotkey } from '@kite/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';

/** What the desktop app last reported holding (null in a browser, and until it answers). */
let held: readonly HotkeyStatus[] | null = null;

/** True once this page has asked the desktop app (it asks once per page load). */
let asked = false;

/** Components waiting for the report. */
const listeners = new Set<() => void>();

/**
 * Keeps what the desktop app reported, and lets every screen showing keys update.
 *
 * @param statuses The report (null: nothing to show from the app).
 * @returns Nothing.
 * Called from: askOnce(); HotkeyList.tsx (after its own check, which is newer); tests
 */
export function rememberHeldHotkeys(statuses: readonly HotkeyStatus[] | null): void {
  held = statuses;
  asked = true;
  for (const listener of listeners) listener();
}

/**
 * Asks the desktop app once which keys it holds. In a browser the answer is null at once. Inside a call the app
 * answers from what it holds; outside one it tries each key and releases it straight away, as Settings → Hotkeys
 * always has.
 *
 * @returns Nothing.
 * Called from: useHeldHotkeys()
 */
function askOnce(): void {
  if (asked || typeof window === 'undefined') return;
  asked = true;
  getPlatform()
    .checkHotkeys()
    .then((statuses) => rememberHeldHotkeys(statuses))
    // An app that cannot answer: the table's keys stay (asked stays true, so it is not asked again and again).
    .catch(() => undefined);
}

/**
 * Subscribes a component to the report.
 *
 * @param listener Called when the report arrives or changes.
 * @returns A function that unsubscribes.
 * Called from: useHeldHotkeys() (useSyncExternalStore)
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The keys the desktop app reported holding, asking it on first use; re-renders the component when they arrive.
 *
 * @returns The report, or null (a browser, the server render, or before the app answers).
 * Called from: KeyCap.tsx, HotkeyList.tsx and the call bars (ControlBar, StatusBar, OverlayAnswer, RecordControls,
 *              LiveMenu, TopBar, AnswerPanel)
 */
export function useHeldHotkeys(): readonly HotkeyStatus[] | null {
  useEffect(askOnce, []);
  return useSyncExternalStore(
    subscribe,
    () => held,
    () => null,
  );
}

/**
 * A shortcut's keys as an accelerator, from the one source (ADR-0128).
 *
 * @param hotkey The shortcut.
 * @param mac    True for the Mac's keys.
 * @returns What the desktop app holds for it, else the table's keys.
 * Called from: shownKeyLabel(), the call bars' tooltips, KeyCap.tsx; tests
 */
export function shownAccelerator(hotkey: KeycapHotkey, mac: boolean): string {
  return heldAccelerator(hotkey, mac, held);
}

/**
 * A shortcut's keys in words for a tooltip, a notice or Help: "Ctrl+Enter" on Windows, "⌃ ↵" on a Mac.
 *
 * @param hotkey The shortcut.
 * @param mac    True for the Mac's keys.
 * @returns The words.
 * Called from: the call bars' notices (OverlayAnswer, AnswerPanel, useLiveAnswers), LauncherConnect.tsx,
 *              clickThroughHint.ts; tests
 */
export function shownKeyLabel(hotkey: KeycapHotkey, mac: boolean): string {
  return hotkeyLabel(shownAccelerator(hotkey, mac), mac);
}

/**
 * Forgets the report, so a test starts from nothing.
 *
 * @returns Nothing.
 * Called from: tests only
 */
export function forgetHeldHotkeys(): void {
  held = null;
  asked = false;
}
