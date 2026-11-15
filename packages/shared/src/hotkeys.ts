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
 * - `chat`: ADR-0082: the voice question (Ctrl+Shift+Space). Kite listens to the microphone, shows
 *   "Listening…", and sends the spoken question after a pause; it is never a "You" transcript line and never
 *   counts as a reply. The id stays 'chat' so a desktop app from before 1.6.4 still sends it (it opened the
 *   typed chat box until then).
 * - `clear`: ADR-0082: clear the answers on screen (it only cancelled a streaming answer before).
 * - `clear-transcript`: clear the words on screen (v1.1.0: Ctrl+Shift+Backspace, formerly Chat).
 * - `prev` / `next`: move through earlier answers.
 * - `ask-kite`: open Ask Kite (ADR-0030).
 * - `script-bar`: show or hide the overlay's slim script bar (v1.0.2, ADR-0035).
 * - `screenshot-send`: ADR-0082: the screenshot and voice question (Ctrl+Alt+Enter): a screenshot first, then
 *   the spoken question, sent together. The id stays (it sent the chat bar's message with a screenshot from
 *   v1.2.0, spec S14).
 * - `click-through`: turn the overlay's Click-through mode on or off (v1.3.2): every click and key outside
 *   the bars goes to the app behind.
 * - `record`: start or stop recording the meeting (desktop 1.5.0, ADR-0068). The page asks for consent
 *   before a start and confirms a stop, as the Rec pill does.
 * - `zoom-in` / `zoom-out` / `zoom-reset`: ADR-0082: the overlay's zoom (the ⋮ menu's Zoom), one step up or
 *   down, or back to 100 %.
 * - `voice-cancel`: ADR-0082: Escape while a voice question is listening: stop without sending.
 */
export type HotkeyAction =
  | 'answer'
  | 'screenshot'
  | 'chat'
  | 'clear'
  | 'clear-transcript'
  | 'prev'
  | 'next'
  | 'ask-kite'
  | 'script-bar'
  | 'screenshot-send'
  | 'click-through'
  | 'record'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'voice-cancel';

/** Every action the Kite page carries out (messages from the shell are checked against it). */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'answer',
  'screenshot',
  'chat',
  'clear',
  'clear-transcript',
  'prev',
  'next',
  'ask-kite',
  'script-bar',
  'screenshot-send',
  'click-through',
  'record',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'voice-cancel',
];

/** A direction the overlay can move in. */
export type OverlayDirection = 'up' | 'down' | 'left' | 'right';

/**
 * A jump between the overlay's six positions (v1.3.0, ADR-0056): one spot left or right within its row
 * (stopping at the edges), or to the top or bottom row.
 */
export type OverlayJump =
  'overlay-spot-left' | 'overlay-spot-right' | 'overlay-row-top' | 'overlay-row-bottom';

/**
 * Something the shell does to the overlay window itself, without the page: show or hide it, jump
 * between positions, or nudge it a little (`overlay-up` and so on). Until 1.2.0 the nudge was on
 * Ctrl+Alt+Arrows and a bigger nudge (`-big`) on Ctrl+Alt+Shift+Arrows; 1.3.0 has no bigger nudge.
 */
export type OverlayAction = 'overlay-toggle' | `overlay-${OverlayDirection}` | OverlayJump;

/**
 * A shortcut that works from any app while a call is on. `chat` and `script-bar` go to the page like
 * Answer (the live page decides what the overlay shows); the overlay actions are done by the shell.
 * ADR-0082 (desktop 1.6.4, the developer's choice, as ParakeetAI does): Clear answers, Clear transcript,
 * previous / next answer, the zoom keys and the screenshot and voice question are held during a call too.
 */
export type CallHotkey =
  | 'answer'
  | 'screenshot'
  | 'chat'
  | 'screenshot-send'
  | 'clear'
  | 'clear-transcript'
  | 'prev'
  | 'next'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'script-bar'
  | 'click-through'
  | 'record'
  | OverlayAction;

/**
 * A shortcut that works from any app, the shortcut held for as long as the app runs, or Escape while a voice
 * question listens (ADR-0082).
 */
export type GlobalHotkey = CallHotkey | 'ask-kite' | 'voice-cancel';

/**
 * Opens Ask Kite from any app, for as long as the desktop app runs (ADR-0030). It is the one global
 * shortcut held outside a call: unlike the others its keys edit nothing in other apps. On layouts
 * where Ctrl+Alt types a letter (AltGr), it can clash, which Settings → Hotkeys reports.
 */
export const ASK_KITE_HOTKEY = 'CommandOrControl+Alt+K';

/**
 * The screenshot and voice question (ADR-0082; v1.2.0 to 1.6.3 it sent the chat bar's message with a
 * screenshot). Desktop 1.6.4 holds it for the whole call with the other call shortcuts; a 1.2.0–1.6.3 shell
 * holds it while the page asks (setChatHotkey), which the page now does for the whole call. On layouts where
 * Ctrl+Alt is AltGr it can clash, which Settings → Hotkeys reports.
 */
export const SCREENSHOT_SEND_HOTKEY = 'CommandOrControl+Alt+Enter';

/**
 * ADR-0082: cancels a voice question while it listens. Held by desktop 1.6.4 only for those few seconds
 * (Escape belongs to every other app the rest of the time).
 */
export const VOICE_CANCEL_HOTKEY = 'Escape';

/** The chat bar's own Send key: only ever in the chat box, never a shortcut. */
export const CHAT_SEND_KEY = 'Enter';

/**
 * The global shortcuts, as Electron accelerators. "CommandOrControl" is ⌘ on macOS and Ctrl on
 * Windows and Linux. Registered only during a call (a global shortcut takes its keys from every
 * other app while it is registered).
 */
export const DEFAULT_GLOBAL_HOTKEYS: Readonly<Record<CallHotkey, string>> = {
  answer: 'CommandOrControl+Enter',
  screenshot: 'CommandOrControl+Shift+Enter',
  // v1.1.0 (ADR-0041): global during a call, because the meeting usually has the keyboard. It edits
  // no text in other apps, but some apps and input methods use it, which Settings → Hotkeys reports.
  // ADR-0082: the voice question (it opened the typed chat box until 1.6.3).
  chat: 'CommandOrControl+Shift+Space',
  // ADR-0082: the screenshot and voice question, held with the others from desktop 1.6.4.
  'screenshot-send': SCREENSHOT_SEND_HOTKEY,
  // ADR-0082 (desktop 1.6.4, the developer's choice for ParakeetAI parity): global during a call. Until
  // 1.6.3 these worked only while Paramount AI had the keyboard, which the overlay gives back after most
  // clicks. While a call runs, other apps cannot use them (for example Ctrl+Backspace to delete a word in
  // a code editor); they are released at End. Settings → Hotkeys says so.
  'clear-transcript': 'CommandOrControl+Shift+Backspace',
  clear: 'CommandOrControl+Backspace',
  prev: 'CommandOrControl+Left',
  next: 'CommandOrControl+Right',
  // ADR-0082: the overlay's zoom, as in browsers (Ctrl+= / Ctrl+- / Ctrl+0). Global during a call, like the
  // keys above: a browser or editor behind the overlay does not zoom with them while the call runs.
  'zoom-in': 'CommandOrControl+=',
  'zoom-out': 'CommandOrControl+-',
  'zoom-reset': 'CommandOrControl+0',
  'overlay-toggle': 'CommandOrControl+Alt+H',
  // v1.0.2 (ADR-0035): the script bar. Registered only during a call, like the others. On layouts
  // where Ctrl+Alt types a letter (AltGr; Polish: AltGr+S types "ś") it can clash, and on macOS
  // ⌘⌥S is "Save All" in some apps; Settings → Hotkeys reports a shortcut another app holds.
  'script-bar': 'CommandOrControl+Alt+S',
  // v1.3.2: Click-through. X is free among the Ctrl+Alt shortcuts (H, S, K, T, Enter, Arrows). Goes to the
  // live page like the script bar; on AltGr layouts it can clash, which Settings → Hotkeys reports.
  'click-through': 'CommandOrControl+Alt+X',
  // Desktop 1.5.0 (ADR-0068): start or stop recording. R is free among the Ctrl+Alt shortcuts (H, S, K,
  // T, X, Enter, Arrows). Goes to the live page, which asks for consent first; on AltGr layouts it can
  // clash, which Settings → Hotkeys reports. A shell before 1.5.0 does not register it.
  record: 'CommandOrControl+Alt+R',
  // v1.3.0 (ADR-0056): Ctrl+Alt+Arrows jump between the six positions; the small nudge moved to
  // Ctrl+Alt+Shift+Arrows. Never Ctrl+Shift+Arrows: in other apps that selects text by word.
  'overlay-spot-left': 'CommandOrControl+Alt+Left',
  'overlay-spot-right': 'CommandOrControl+Alt+Right',
  'overlay-row-top': 'CommandOrControl+Alt+Up',
  'overlay-row-bottom': 'CommandOrControl+Alt+Down',
  'overlay-up': 'CommandOrControl+Alt+Shift+Up',
  'overlay-down': 'CommandOrControl+Alt+Shift+Down',
  'overlay-left': 'CommandOrControl+Alt+Shift+Left',
  'overlay-right': 'CommandOrControl+Alt+Shift+Right',
};

/**
 * Turns the transcript on or off (v1.3.0, ADR-0056): only while the overlay's bars have focus (the
 * page's own key handling), never global. Settings checks whether another app holds it globally (then
 * it never reaches the bars). On layouts where Ctrl+Alt is AltGr, Ctrl+Alt+T may type a letter there.
 */
export const TRANSCRIPT_HOTKEY = 'CommandOrControl+Alt+T';

/** The global shortcuts, in the order the shell registers them. */
export const GLOBAL_HOTKEYS = Object.keys(DEFAULT_GLOBAL_HOTKEYS) as readonly CallHotkey[];

/**
 * The shortcuts that the page also handles itself while Kite has focus (platform/keymap.ts): in a browser,
 * and with a desktop app before 1.6.4, they work only then. ADR-0082: desktop 1.6.4 also holds them during a
 * call (DEFAULT_GLOBAL_HOTKEYS); the keys are the same.
 */
export const FOCUSED_HOTKEYS: Readonly<
  Record<'clear' | 'clear-transcript' | 'prev' | 'next', string>
> = {
  // v1.1.0: this key was Chat until 1.0.4; Chat moved to Ctrl+Shift+Space.
  'clear-transcript': DEFAULT_GLOBAL_HOTKEYS['clear-transcript'],
  clear: DEFAULT_GLOBAL_HOTKEYS.clear,
  prev: DEFAULT_GLOBAL_HOTKEYS.prev,
  next: DEFAULT_GLOBAL_HOTKEYS.next,
};

/** Whether one global shortcut could be registered. */
export interface HotkeyStatus {
  /**
   * The shortcut. 'transcript' (v1.3.0) is never held: Settings only checks that no other app holds
   * its keys.
   */
  action: GlobalHotkey | 'transcript';
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
  actions: readonly (GlobalHotkey | 'transcript')[];
  /** Desktop 1.5.0 (ADR-0068): shown only where meetings can be recorded (a desktop app from 1.5.0). */
  recording?: true;
  /**
   * Which desktop apps the row is for (v1.3.0, ADR-0056): 'positions' for one with the six positions
   * (1.3.0 and later, and the browser's list), 'classic' only for an older desktop app. Absent: all.
   */
  shells?: 'positions' | 'classic';
}

/**
 * The list Settings shows. ADR-0082: in ParakeetAI's order first (answer, screenshot, voice, answers,
 * clearing, zoom), then Paramount AI's own.
 */
export const HOTKEY_ROWS: readonly HotkeyRow[] = [
  {
    label: 'Answer',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.answer,
    scope: 'global',
    actions: ['answer'],
  },
  {
    label: 'Answer from a screenshot',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.screenshot,
    scope: 'global',
    actions: ['screenshot'],
  },
  {
    label: 'Voice question: speak, sent when you pause (Esc cancels)',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.chat,
    scope: 'global',
    actions: ['chat'],
  },
  {
    label: 'Screenshot and voice question',
    accelerator: SCREENSHOT_SEND_HOTKEY,
    scope: 'global',
    actions: ['screenshot-send'],
  },
  {
    label: 'Previous or next answer',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.prev,
    keysOverride: 'CommandOrControl+Left / Right',
    scope: 'global',
    actions: ['prev', 'next'],
  },
  {
    label: 'Clear answers',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.clear,
    scope: 'global',
    actions: ['clear'],
  },
  {
    label: 'Clear transcript',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['clear-transcript'],
    scope: 'global',
    actions: ['clear-transcript'],
  },
  {
    label: 'Zoom the overlay in, out, or back to 100 %',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['zoom-in'],
    keysOverride: 'CommandOrControl+= / - / 0',
    scope: 'global',
    actions: ['zoom-in', 'zoom-out', 'zoom-reset'],
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
    label: 'Click-through on or off (clicks and typing go to the app behind the overlay)',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['click-through'],
    scope: 'global',
    actions: ['click-through'],
  },
  {
    label: 'Start or stop recording (asks first)',
    accelerator: DEFAULT_GLOBAL_HOTKEYS.record,
    scope: 'global',
    actions: ['record'],
    recording: true,
  },
  {
    label: 'Move overlay to the next position (← → in its row, ↑ ↓ top or bottom row)',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-row-top'],
    keysOverride: 'CommandOrControl+Alt+Arrows',
    scope: 'global',
    actions: ['overlay-spot-left', 'overlay-spot-right', 'overlay-row-top', 'overlay-row-bottom'],
    shells: 'positions',
  },
  {
    label: 'Nudge overlay',
    accelerator: DEFAULT_GLOBAL_HOTKEYS['overlay-up'],
    keysOverride: 'CommandOrControl+Alt+Shift+Arrows',
    scope: 'global',
    actions: ['overlay-up', 'overlay-down', 'overlay-left', 'overlay-right'],
    shells: 'positions',
  },
  {
    // An older desktop app (before 1.3.0) still moves the overlay step by step on these keys.
    label: 'Move overlay (add Shift for bigger steps)',
    accelerator: 'CommandOrControl+Alt+Up',
    keysOverride: 'CommandOrControl+Alt+Arrows',
    scope: 'global',
    actions: [],
    shells: 'classic',
  },
  {
    label: 'Open Ask AI',
    accelerator: ASK_KITE_HOTKEY,
    scope: 'global',
    actions: ['ask-kite'],
  },
  {
    label: 'Transcript on or off (while the bars have focus)',
    accelerator: TRANSCRIPT_HOTKEY,
    scope: 'focused',
    actions: ['transcript'],
    shells: 'positions',
  },
];

/** A shortcut a key-cap chip can show (v1.2.0, spec §4): any global or focused one. */
export type KeycapHotkey = GlobalHotkey | keyof typeof FOCUSED_HOTKEYS | 'chat-send' | 'transcript';

/**
 * The keys of a shortcut, from the one map above, so no screen ever writes a key itself.
 *
 * @param hotkey The shortcut.
 * @returns Its Electron accelerator.
 * Called from: apps/web/src/ui/KeyCap.tsx; tests
 */
export function hotkeyAccelerator(hotkey: KeycapHotkey): string {
  if (hotkey === 'ask-kite') return ASK_KITE_HOTKEY;
  if (hotkey === 'voice-cancel') return VOICE_CANCEL_HOTKEY;
  if (hotkey === 'chat-send') return CHAT_SEND_KEY;
  if (hotkey === 'transcript') return TRANSCRIPT_HOTKEY;
  if (hotkey in FOCUSED_HOTKEYS) return FOCUSED_HOTKEYS[hotkey as keyof typeof FOCUSED_HOTKEYS];
  return DEFAULT_GLOBAL_HOTKEYS[hotkey as CallHotkey];
}

/** What each part of an accelerator looks like on a key-cap chip. */
const KEYCAP_SYMBOLS: Readonly<Record<string, string>> = {
  Shift: '⇧',
  Backspace: '⌫',
  Enter: '↵',
  Space: '␣',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
};

/**
 * An accelerator as a key-cap chip's parts: ["Ctrl", "⇧", "↵"] on Windows, ["⌘", "⇧", "↵"] on macOS
 * (spec §4: on macOS, Ctrl shows as ⌘).
 *
 * @param accelerator An Electron accelerator.
 * @param mac         True on macOS.
 * @returns The parts, in order.
 * Called from: apps/web/src/ui/KeyCap.tsx; tests
 */
export function keycapParts(accelerator: string, mac: boolean): string[] {
  return accelerator.split('+').map((part) => {
    if (part === 'CommandOrControl') return mac ? '⌘' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    return KEYCAP_SYMBOLS[part] ?? part;
  });
}

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
    .replace('Space', '␣')
    .replace(/\bLeft\b/, '←')
    .replace(/\bRight\b/, '→')
    .replace(/\bUp\b/, '↑')
    .replace(/\bDown\b/, '↓');
  return mac ? keys.replaceAll('+', ' ') : keys;
}
