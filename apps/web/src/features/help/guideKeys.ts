/**
 * File: apps/web/src/features/help/guideKeys.ts
 * Purpose: ADR-0128: the user guide on /help names keys for the computer it is read on. The guide is written with
 *          the Windows keys in bold ("**Ctrl+Alt+K**"); on a Mac those words become the Mac's keys ("⌃ ⌥ K"). The
 *          Mac keys are the Windows keys with Control for Ctrl and Option for Alt (ADR-0110 amended 27 Nov 2026),
 *          so the shared macKeys() and hotkeyLabel() make them, as they make the Mac set everywhere else. The
 *          guide's Hotkeys section is not text at all: /help shows Settings → Hotkeys' own list there.
 * Used by: src/features/help/HelpPage.tsx
 * Depends on: @kite/shared (macKeys, hotkeyLabel)
 * Architecture: docs/decisions/ADR-0128-hotkeys-per-computer-one-source.md
 */
import { hotkeyLabel, macKeys } from '@kite/shared';

/**
 * Where the guide (docs/user-guide/using-kite.md) shows the shortcut list: a paragraph of exactly these words,
 * which /help replaces with Settings → Hotkeys' list (the same rows, keys and Mac / Windows switch).
 */
export const HOTKEYS_MARKER = '{{hotkeys}}';

/**
 * Windows keys as the guide writes them: "Ctrl+Enter", "Ctrl+Alt+Shift+Arrows", "Ctrl+=", "Ctrl+-", and a group
 * such as "Ctrl+Shift+Left / Right" or "Ctrl+Left / Ctrl+Right".
 */
export const GUIDE_KEYS =
  /(?:Ctrl|Alt)(?:\+(?:[A-Za-z0-9]+|=|-))+(?: \/ (?:Ctrl\+)?(?:Left|Right|Up|Down))*/g;

/**
 * One key, or one part of a group, as the guide writes it for Windows, turned into an accelerator.
 *
 * @param words For example "Ctrl+Alt+K" or "Right".
 * @returns The accelerator ("CommandOrControl+Alt+K", "Right").
 * Called from: guideKeysFor(); tests (to check the guide's keys against the shared table)
 */
export function guideAccelerator(words: string): string {
  return words.replace(/^Ctrl\+/, 'CommandOrControl+');
}

/**
 * A bold piece of the guide with its keys written for this computer.
 *
 * @param text The bold words (for example "Ctrl+Alt+K", or "Click-through on — press Ctrl+Alt+X to turn off").
 * @param mac  True on a Mac.
 * @returns The same words, with the Mac's keys on a Mac ("⌃ ⌥ K"); unchanged elsewhere.
 * Called from: HelpPage.tsx (bold pieces); tests
 */
export function guideKeysFor(text: string, mac: boolean): string {
  if (!mac) return text;
  return text.replace(GUIDE_KEYS, (keys) =>
    keys
      .split(' / ')
      .map((part) => hotkeyLabel(macKeys(guideAccelerator(part)), true))
      .join(' / '),
  );
}
