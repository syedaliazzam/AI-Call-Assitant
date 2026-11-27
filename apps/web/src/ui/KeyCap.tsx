/**
 * File: apps/web/src/ui/KeyCap.tsx
 * Purpose: The key-cap chip on a button, for example [Ctrl ⇧ ↵]. It reads the shortcut from the hotkey
 *          map, so no key is ever written into a screen, and shows the Mac's symbols on a Mac (spec §4;
 *          ADR-0110: ⌃ for Control). ADR-0128: the keys come from src/ui/shownKeys.ts (the keys the desktop app
 *          holds, else the table's), and Settings → Hotkeys can ask for the other computer's set (`mac`).
 * Used by: the call bars, the chat bar, the transcript and answer panels, Settings → Hotkeys and Help
 * Depends on: @kite/shared (the hotkey map), src/platform (the macOS check), src/ui/shownKeys.ts, React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1 (overlay key-cap), §4 (hotkeys); ADR-0128
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { heldAccelerator, keycapParts, type KeycapHotkey } from '@kite/shared';
import {
  ArrowBigUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CornerDownLeft,
  Delete,
  Space,
  type LucideIcon,
} from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getPlatform } from '@/platform';
import { useHeldHotkeys } from './shownKeys';

/** The keys drawn as icons: at 12 px these characters are too small to read in Inter. */
const KEY_ICONS: Readonly<Record<string, LucideIcon>> = {
  '⇧': ArrowBigUp,
  '↵': CornerDownLeft,
  '⌫': Delete,
  '␣': Space,
  '←': ArrowLeft,
  '→': ArrowRight,
  '↑': ArrowUp,
  '↓': ArrowDown,
};

/** Props for KeyCap. */
export interface KeyCapProps {
  /** Which shortcut to show. */
  hotkey?: KeycapHotkey;
  /** Its keys instead, for a row of the map that names them itself ("…+Arrows"). */
  accelerator?: string;
  /** True on a primary button, whose colours are reversed. */
  onPrimary?: boolean;
  /** Extra classes, appended. */
  className?: string;
  /**
   * ADR-0128: true or false to draw the Mac's or the Windows symbols whatever this computer is (Settings →
   * Hotkeys' Mac / Windows switch). Absent: this computer's.
   */
  mac?: boolean;
}

/**
 * Nothing to subscribe to: the operating system does not change while a page is open.
 *
 * @returns An unsubscribe function that does nothing.
 */
const subscribeNever = () => () => undefined;

/**
 * Whether this is macOS.
 *
 * @returns True on macOS.
 * Called from: KeyCap
 */
const isMac = () => getPlatform().hotkeyModifier() === '⌘';

/**
 * The chip. The server cannot know the operating system, so it renders the Windows keys and the browser
 * corrects them after hydration.
 *
 * @param props See KeyCapProps.
 * @returns The chip, as a <kbd>.
 * Rendered by: the call bars, the chat bar, the panels
 */
export function KeyCap({
  hotkey,
  accelerator,
  onPrimary = false,
  className = '',
  mac: macView,
}: KeyCapProps) {
  const thisMac = useSyncExternalStore(subscribeNever, isMac, () => false);
  const mac = macView ?? thisMac;
  // ADR-0128: the keys the desktop app holds (subscribing re-draws the chip when it answers), but only for this
  // computer's own set: the other computer's set is the table's.
  const held = useHeldHotkeys();
  const keys =
    accelerator ?? (hotkey ? heldAccelerator(hotkey, mac, mac === thisMac ? held : null) : '');
  return (
    <kbd
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] ${onPrimary ? 'bg-ui-on-primary/15' : 'bg-ui-keycap'} px-1.5 text-chip whitespace-nowrap ${className}`}
    >
      {keycapParts(keys, mac).map((part) => {
        const Icon = KEY_ICONS[part];
        return Icon ? (
          <span key={part} className="inline-flex">
            <Icon aria-hidden="true" size={14} />
            <span className="sr-only">{part}</span>
          </span>
        ) : (
          <span key={part}>{part}</span>
        );
      })}
    </kbd>
  );
}
