/**
 * File: apps/web/src/ui/KeyCap.tsx
 * Purpose: The key-cap chip on a button, for example [Ctrl ⇧ ↵]. It reads the shortcut from the hotkey
 *          map, so no key is ever written into a screen, and shows ⌘ on macOS (spec §4).
 * Used by: the call bars, the chat bar, the transcript and answer panels
 * Depends on: @kite/shared (the hotkey map), src/platform (the macOS check), React
 * Architecture: docs/design/paramount-ai-ui-spec.md §1 (overlay key-cap), §4 (hotkeys)
 * Theme: tokens from src/ui/tokens/theme.css
 */
'use client';

import { hotkeyAccelerator, keycapParts, type KeycapHotkey } from '@kite/shared';
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
  hotkey: KeycapHotkey;
  /** Extra classes, appended. */
  className?: string;
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
export function KeyCap({ hotkey, className = '' }: KeyCapProps) {
  const mac = useSyncExternalStore(subscribeNever, isMac, () => false);
  return (
    <kbd
      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] bg-ui-keycap px-1.5 text-chip whitespace-nowrap ${className}`}
    >
      {keycapParts(hotkeyAccelerator(hotkey), mac).map((part) => {
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
