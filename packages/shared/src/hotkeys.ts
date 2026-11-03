/**
 * File: packages/shared/src/hotkeys.ts
 * Purpose: Kite's keyboard shortcuts, defined once so the desktop shell (global shortcuts), the
 *          web app (in-page shortcuts) and the labels on buttons and in Settings agree. Two kinds:
 *          global ones work from any app (desktop app, during a call); focused ones work only
 *          while Kite has focus, because system-wide they would break typing in other apps.
 *          The map follows docs/design/parakeet-parity.md (the team's current tool).
 * Used by: apps/web/src/platform (types.ts, desktop.ts, keymap.ts), apps/web/src/features/live,
 *          apps/web/src/features/settings, apps/desktop/src/hotkeys.ts, apps/desktop/src/preload.ts
 * Depends on: nothing (types and constants only)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §3.3, §7.3; ADR-0029
 */

/**
 * An action the Kite page carries out.
 * - `answer`: answer the latest question.
 * - `screenshot`: answer from a screenshot of the screen.
 * - `chat`: open the box for a typed question.
 * - `clear`: clear the current answer.
 * - `prev` / `next`: move through earlier answers.
 * - `ask-kite`: open Ask Kite (ADR-0030).
 * - `script-bar`: show or hide the overlay's slim script bar (v1.0.2, ADR-0035).
 */
export type HotkeyAction =
  'answer' | 'screenshot' | 'chat' | 'clear' | 'prev' | 'next' | 'ask-kite' | 'script-bar';

/** Every action the Kite page carries out (messages from the shell are checked against it). */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'answer',
  'screenshot',
  'chat',
  'clear',
  'prev',
  'next',
  'ask-kite',
  'script-bar',
];

/** A direction the overlay can move in. */
export type OverlayDirection = 'up' | 'down' | 'left' | 'right';

/** Something the shell does to the overlay window itself, without the page. */
export type OverlayAction =
  'overlay-toggle' | `overlay-${OverlayDirection}` | `overlay-${OverlayDirection}-big`;

/**
 * A shortcut that works from any app while a call is on. `script-bar` goes to the page like Answer
 * (the live page decides what the overlay shows); the overlay actions are done by the shell.
 */
export type CallHotkey = 'answer' | 'screenshot' | 'script-bar' | OverlayAction;

/** A shortcut that works from any app, or the shortcut held for as long as the app runs. */
export type GlobalHotkey = CallHotkey | 'ask-kite';

/**
 * Opens Ask Kite from any app, for as long as the desktop app runs (ADR-0030). It is the one global
 * shortcut held outside a call: unlike the others its keys edit nothing in other apps. On layouts
 * where Ctrl+Alt types a letter (AltGr), it can clash, which Settings → Hotkeys reports.
 */
export const ASK_KITE_HOTKEY = 'CommandOrControl+Alt+K';

/**
 * The global shortcuts, as Electron accelerators. "CommandOrControl" is ⌘ on macOS and Ctrl on
 * Windows and Linux. Registered only during a call (a global shortcut takes its keys from every
 * other app while it is registered).
 */
export const DEFAULT_GLOBAL_HOTKEYS: Readonly<Record<CallHotkey, string>> = {
  answer: 'CommandOrControl+Enter',
  screenshot: 'CommandOrControl+Shift+Enter',
  'overlay-toggle': 'CommandOrControl+Alt+H',
  // v1.0.2 (ADR-0035): the script bar. Registered only during a call, like the others. On layouts
  // where Ctrl+Alt types a letter (AltGr; Polish: AltGr+S types "ś") it can clash, and on macOS
  // ⌘⌥S is "Save All" in some apps; Settings → Hotkeys reports a shortcut another app holds.
  'script-bar': 'CommandOrControl+Alt+S',
  'overlay-up': 'CommandOrControl+Alt+Up',
  'overlay-down': 'CommandOrControl+Alt+Down',
  'overlay-left': 'CommandOrControl+Alt+Left',
  'overlay-right': 'CommandOrControl+Alt+Right',
  'overlay-up-big': 'CommandOrControl+Alt+Shift+Up',
  'overlay-down-big': 'CommandOrControl+Alt+Shift+Down',
  'overlay-left-big': 'CommandOrControl+Alt+Shift+Left',
  'overlay-right-big': 'CommandOrControl+Alt+Shift+Right',
};

/** The global shortcuts, in the order the shell registers them. */
export const GLOBAL_HOTKEYS = Object.keys(DEFAULT_GLOBAL_HOTKEYS) as readonly CallHotkey[];

/**
 * The shortcuts that work only while Kite has focus (the page's own key handling), never
 * registered globally: in other apps these keys delete and move by word.
 */
export const FOCUSED_HOTKEYS: Readonly<Record<'chat' | 'clear' | 'prev' | 'next', string>> = {
  chat: 'CommandOrControl+Shift+Backspace',
  clear: 'CommandOrControl+Backspace',
  prev: 'CommandOrControl+Left',
  next: 'CommandOrControl+Right',
};

/** Whether one global shortcut could be registered. */
export interface HotkeyStatus {
  /** The shortcut. */
  action: GlobalHotkey;
  /** Its keys, as an Electron accelerator (for example 'CommandOrControl+Enter'). */
  accelerator: string;
  /**
   * True when the shell registered it. False when another app already uses it. Answer and
   * Screenshot then work only while Kite has focus; the overlay shortcuts do not work.
   */
  registered: boolean;
}

/** One row of the shortcut list in Settings. */
export interface HotkeyRow {
  /** What the shortcut does. */
  label: string;
  /** Its keys, as an accelerator (the plain form when it has variants). */
  accelerator: string;
  /** The same keys in words where an accelerator cannot say it, for example the arrows. */
  keysOverride?: string;
  /** 'global' works from any app; 'focused' only while Kite has focus. */
  scope: 'global' | 'focused';
  /** The global shortcuts this row stands for (to report conflicts). */
  actions: readonly GlobalHotkey[];
}

/** The list Settings shows. */
export const HOTKEY_ROWS: readonly HotkeyRow[] = [
  {
    label: 'Answer',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.answer,
    scope: 'global',
    actions: ['answer'],
  },
  {
    label: 'Screenshot',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.screenshot,
    scope: 'global',
    actions: ['screenshot'],
  },
  {
    label: 'Show or hide overlay',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-toggle'],
    scope: 'global',
    actions: ['overlay-toggle'],
  },
  {
    label: 'Script bar',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['script-bar'],
    scope: 'global',
    actions: ['script-bar'],
  },
  {
    label: 'Move overlay (add Shift for bigger steps)',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-up'],
    keysOverride: 'CommandOrControl+Alt+Arrows',
    scope: 'global',
    actions: [
      'overlay-up',
      'overlay-down',
      'overlay-left',
      'overlay-right',
      'overlay-up-big',
      'overlay-down-big',
      'overlay-left-big',
      'overlay-right-big',
    ],
  },
  {
    label: 'Open Ask Kite',
    accelerator: ASK_KITE_HOTKEY,
    scope: 'global',
    actions: ['ask-kite'],
  },
  { label: 'Chat', accelerator: FOCUSED_HOTKEYS.chat, scope: 'focused', actions: [] },
  { label: 'Clear answer', accelerator: FOCUSED_HOTKEYS.clear, scope: 'focused', actions: [] },
  {
    label: 'Previous or next answer',
    accelerator: FOCUSED_HOTKEYS.prev,
    keysOverride: 'CommandOrControl+Left / Right',
    scope: 'focused',
    actions: [],
  },
];

/**
 * An accelerator in words for a button or a list: "Ctrl+Enter" on Windows, "⌘ Enter" on macOS.
 *
 * @param accelerator An Electron accelerator.
 * @param mac         True on macOS.
 * @returns The label.
 * Called from: the live view's and overlay's buttons, Settings; tests
 */
export function hotkeyLabel(accelerator: string, mac: boolean): string {
  const keys = accelerator
    .replace('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replace('Alt', mac ? '⌥' : 'Alt')
    .replace('Shift', mac ? '⇧' : 'Shift')
    .replace('Backspace', '⌫')
    .replace('Enter', '↵')
    .replace(/\bLeft\b/, '←')
    .replace(/\bRight\b/, '→')
    .replace(/\bUp\b/, '↑')
    .replace(/\bDown\b/, '↓');
  return mac ? keys.replaceAll('+', ' ') : keys;
}
