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
 * - `answer`: answer the latest question. ADR-0123: on a call (the other side spoke in the last two minutes) the
 *   other person's newest question; on your own, the user's own newest spoken question.
 * - `screenshot`: answer from a screenshot of the screen.
 * - `chat`: ADR-0123: answer the user's own newest spoken question from the "You" transcript (Ctrl+Shift+Space),
 *   on a call too. ADR-0082 to ADR-0123 it was the voice question (listen, then send after a pause). The id stays
 *   'chat' so a desktop app from before 1.6.4 still sends it (it opened the typed chat box until then).
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
 * Ctrl+Alt+Arrows and a bigger nudge (`-big`) on Ctrl+Alt+Shift+Arrows; 1.3.0 has no bigger nudge. The jumps
 * were on Ctrl+Alt+Arrows from 1.3.0 to 1.6.5 and are on Ctrl+Shift+Arrows from desktop 1.7.0 (ADR-0095).
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
  // v1.3.2: Click-through. X is free among the Ctrl+Alt shortcuts (H, S, K, T, Enter). Goes to the
  // live page like the script bar; on AltGr layouts it can clash, which Settings → Hotkeys reports.
  'click-through': 'CommandOrControl+Alt+X',
  // Desktop 1.5.0 (ADR-0068): start or stop recording. R is free among the Ctrl+Alt shortcuts (H, S, K,
  // T, X, Enter). Goes to the live page, which asks for consent first; on AltGr layouts it can
  // clash, which Settings → Hotkeys reports. A shell before 1.5.0 does not register it.
  record: 'CommandOrControl+Alt+R',
  // v1.3.0 (ADR-0056): the jumps between the six positions; the small nudge is Ctrl+Alt+Shift+Arrows.
  // ADR-0095 (desktop 1.7.0, the developer's choice): the jumps moved from Ctrl+Alt+Arrows to Ctrl+Shift+Arrows.
  // In other apps Ctrl+Shift+Arrows selects text by word (on macOS ⌘⇧←/→ to the line's start or end), so,
  // like every key here, they are held only while a call runs and released at End.
  'overlay-spot-left': 'CommandOrControl+Shift+Left',
  'overlay-spot-right': 'CommandOrControl+Shift+Right',
  'overlay-row-top': 'CommandOrControl+Shift+Up',
  'overlay-row-bottom': 'CommandOrControl+Shift+Down',
  'overlay-up': 'CommandOrControl+Alt+Shift+Up',
  'overlay-down': 'CommandOrControl+Alt+Shift+Down',
  'overlay-left': 'CommandOrControl+Alt+Shift+Left',
  'overlay-right': 'CommandOrControl+Alt+Shift+Right',
};

/**
 * ADR-0110 (desktop 1.8.0 and the web app on a Mac): the keys that differ on macOS. With "CommandOrControl"
 * these would be ⌘←/→ (start and end of the line), ⌘⌫ (delete to the line's start), ⌘= / ⌘- / ⌘0 (every app's
 * zoom), ⌘⇧ with arrows (select to the line's or document's edge) and ⌘⌥H ("Hide Others" in every app):
 * text-editing and window keys every Mac app uses, which a call would take from them. On a Mac they use ⌃⌥
 * (Control+Option) instead, and the jumps between the six positions ⌃⌘ with arrows. ⌃⌥ is also VoiceOver's
 * key (VO); a VoiceOver user can set VO to Caps Lock, or Settings → Hotkeys shows the key another app holds.
 * Every other key is the same as on Windows, with ⌘ for Ctrl. Reviewed 25 Nov 2026 (ADR-0110 amendment): with ⌃
 * for Ctrl instead, these would take Mission Control (⌃←/→) or text keys, so they stay; the whole table is pinned
 * in apps/web/tests/unit/shared/hotkeys.test.ts.
 */
export const MAC_HOTKEY_CHANGES: Readonly<Partial<Record<CallHotkey, string>>> = {
  'clear-transcript': 'Control+Alt+Shift+Backspace',
  clear: 'Control+Alt+Backspace',
  prev: 'Control+Alt+Left',
  next: 'Control+Alt+Right',
  'zoom-in': 'Control+Alt+=',
  'zoom-out': 'Control+Alt+-',
  'zoom-reset': 'Control+Alt+0',
  'overlay-toggle': 'Control+Alt+H',
  'overlay-spot-left': 'Control+Command+Left',
  'overlay-spot-right': 'Control+Command+Right',
  'overlay-row-top': 'Control+Command+Up',
  'overlay-row-bottom': 'Control+Command+Down',
};

/** ADR-0110: the global shortcuts on a Mac (DEFAULT_GLOBAL_HOTKEYS with MAC_HOTKEY_CHANGES). */
export const MAC_GLOBAL_HOTKEYS: Readonly<Record<CallHotkey, string>> = {
  ...DEFAULT_GLOBAL_HOTKEYS,
  ...MAC_HOTKEY_CHANGES,
};

/**
 * The global shortcuts for this computer (ADR-0110).
 *
 * @param mac True on macOS.
 * @returns MAC_GLOBAL_HOTKEYS on a Mac, otherwise DEFAULT_GLOBAL_HOTKEYS.
 * Called from: apps/desktop/src/main.ts (installHotkeys), hotkeyAccelerator(), hotkeyRows(); the overlay's
 *              labels; tests
 */
export function globalHotkeys(mac: boolean): Readonly<Record<CallHotkey, string>> {
  return mac ? MAC_GLOBAL_HOTKEYS : DEFAULT_GLOBAL_HOTKEYS;
}

/**
 * Turns the transcript on or off (v1.3.0, ADR-0056): only while the overlay's bars have focus (the
 * page's own key handling), never global. Settings checks whether another app holds it globally (then
 * it never reaches the bars). On layouts where Ctrl+Alt is AltGr, Ctrl+Alt+T may type a letter there.
 */
export const TRANSCRIPT_HOTKEY = 'CommandOrControl+Alt+T';

/** The global shortcuts, in the order the shell registers them. */
export const GLOBAL_HOTKEYS = Object.keys(DEFAULT_GLOBAL_HOTKEYS) as readonly CallHotkey[];

/** The shortcuts the page also handles itself while it has focus. */
export type FocusedHotkey = 'clear' | 'clear-transcript' | 'prev' | 'next';

/**
 * The shortcuts that the page also handles itself while Kite has focus (platform/keymap.ts): in a browser,
 * and with a desktop app before 1.6.4, they work only then. ADR-0082: desktop 1.6.4 also holds them during a
 * call (DEFAULT_GLOBAL_HOTKEYS); the keys are the same. ADR-0110: focusedHotkeys(true) for a Mac.
 */
export const FOCUSED_HOTKEYS: Readonly<Record<FocusedHotkey, string>> = {
  // v1.1.0: this key was Chat until 1.0.4; Chat moved to Ctrl+Shift+Space.
  'clear-transcript': DEFAULT_GLOBAL_HOTKEYS['clear-transcript'],
  clear: DEFAULT_GLOBAL_HOTKEYS.clear,
  prev: DEFAULT_GLOBAL_HOTKEYS.prev,
  next: DEFAULT_GLOBAL_HOTKEYS.next,
};

/**
 * The page's own shortcuts for this computer (ADR-0110).
 *
 * @param mac True on macOS.
 * @returns The keys of Clear transcript, Clear answers, previous and next.
 * Called from: hotkeyAccelerator(); the overlay's labels (OverlayAnswer.tsx, StatusBar.tsx); tests
 */
export function focusedHotkeys(mac: boolean): Readonly<Record<FocusedHotkey, string>> {
  const keys = globalHotkeys(mac);
  return {
    'clear-transcript': keys['clear-transcript'],
    clear: keys.clear,
    prev: keys.prev,
    next: keys.next,
  };
}

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
 * clearing, zoom), then Paramount AI's own. ADR-0110: with a Mac's keys on a Mac.
 *
 * @param mac True on macOS.
 * @returns The rows.
 * Called from: apps/web/src/features/settings/HotkeyList.tsx; HOTKEY_ROWS; tests
 */
export function hotkeyRows(mac: boolean): readonly HotkeyRow[] {
  const keys = globalHotkeys(mac);
  return [
    {
      // ADR-0123: who it answers depends on whether the other side spoke in the last two minutes.
      label: 'Answer (on a call: their newest question; on your own: yours)',
      accelerator: keys.answer,
      scope: 'global',
      actions: ['answer'],
    },
    {
      label: 'Answer from a screenshot',
      accelerator: keys.screenshot,
      scope: 'global',
      actions: ['screenshot'],
    },
    {
      // ADR-0123: the user's own newest spoken question, on a call too (it listened for a voice question before).
      label: 'Answer your own last spoken question (on a call too)',
      accelerator: keys.chat,
      scope: 'global',
      actions: ['chat'],
    },
    {
      label: 'Screenshot and voice question (Esc cancels)',
      accelerator: SCREENSHOT_SEND_HOTKEY,
      scope: 'global',
      actions: ['screenshot-send'],
    },
    {
      label: 'Previous or next answer',
      accelerator: keys.prev,
      keysOverride: mac ? 'Control+Alt+Left / Right' : 'CommandOrControl+Left / Right',
      scope: 'global',
      actions: ['prev', 'next'],
    },
    {
      label: 'Clear answers',
      accelerator: keys.clear,
      scope: 'global',
      actions: ['clear'],
    },
    {
      label: 'Clear transcript',
      accelerator: keys['clear-transcript'],
      scope: 'global',
      actions: ['clear-transcript'],
    },
    {
      label: 'Zoom the overlay in, out, or back to 100 %',
      accelerator: keys['zoom-in'],
      keysOverride: mac ? 'Control+Alt+= / - / 0' : 'CommandOrControl+= / - / 0',
      scope: 'global',
      actions: ['zoom-in', 'zoom-out', 'zoom-reset'],
    },
    {
      label: 'Show or hide overlay',
      accelerator: keys['overlay-toggle'],
      scope: 'global',
      actions: ['overlay-toggle'],
    },
    {
      label: 'Script bar',
      accelerator: keys['script-bar'],
      scope: 'global',
      actions: ['script-bar'],
    },
    {
      label: 'Click-through on or off (clicks and typing go to the app behind the overlay)',
      accelerator: keys['click-through'],
      scope: 'global',
      actions: ['click-through'],
    },
    {
      label: 'Start or stop recording (asks first)',
      accelerator: keys.record,
      scope: 'global',
      actions: ['record'],
      recording: true,
    },
    {
      // ADR-0095: Ctrl+Shift+Arrows from desktop 1.7.0; Settings shows the keys an older app reports instead.
      label:
        'Move overlay to the next position (← → in its row, ↑ ↓ top or bottom row; during a call only)',
      accelerator: keys['overlay-row-top'],
      keysOverride: mac ? 'Control+Command+Arrows' : 'CommandOrControl+Shift+Arrows',
      scope: 'global',
      actions: ['overlay-spot-left', 'overlay-spot-right', 'overlay-row-top', 'overlay-row-bottom'],
      shells: 'positions',
    },
    {
      label: 'Nudge overlay',
      accelerator: keys['overlay-up'],
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
      // ADR-0122: during a call with the overlay open, the same key opens the overlay's chat bar.
      label: 'Open Ask AI (during a call: the chat bar under the bars)',
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
}

/** The list Settings shows on Windows (hotkeyRows(false)). */
export const HOTKEY_ROWS: readonly HotkeyRow[] = hotkeyRows(false);

/**
 * ADR-0110 (amended 25 Nov 2026): the shortcuts the page also handles itself while a Paramount AI window has
 * the keyboard (apps/web/src/platform/keymap.ts; Escape for the voice question; Ctrl+Alt+T for the transcript).
 * When another app holds one of these, it still works with Paramount AI in front, and in a browser these are
 * the ones that work (while the tab has the keyboard). The others (show or hide the overlay, its jumps and
 * nudges, Click-through, Rec) exist only as the desktop app's global shortcuts: held by another app, they do
 * not work at all, and a browser has none of them.
 */
export const PAGE_HANDLED_HOTKEYS: ReadonlySet<GlobalHotkey | 'transcript'> = new Set<
  GlobalHotkey | 'transcript'
>([
  'answer',
  'screenshot',
  'chat',
  'screenshot-send',
  'clear',
  'clear-transcript',
  'prev',
  'next',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
  'script-bar',
  'ask-kite',
  'voice-cancel',
  'transcript',
]);

/**
 * Whether a shortcut still works through the page when the desktop app cannot hold it (PAGE_HANDLED_HOTKEYS).
 *
 * @param action The shortcut.
 * @returns True when the page handles it too (with Paramount AI in front, or in a browser tab).
 * Called from: apps/web/src/platform/desktop.ts (the in-call warning), desktopOnlyRow(); tests
 */
export function worksInPage(action: GlobalHotkey | 'transcript'): boolean {
  return PAGE_HANDLED_HOTKEYS.has(action);
}

/**
 * Whether a Settings row works only in the desktop app: none of its shortcuts is handled by the page (the
 * classic move row of a desktop app before 1.3.0 names none, and is desktop-only too).
 *
 * @param row The row.
 * @returns True for show or hide, the moves, Click-through and Rec.
 * Called from: apps/web/src/features/settings/HotkeyList.tsx; tests
 */
export function desktopOnlyRow(row: Pick<HotkeyRow, 'actions'>): boolean {
  return row.actions.every((action) => !worksInPage(action));
}

/** A shortcut a key-cap chip can show (v1.2.0, spec §4): any global or focused one. */
export type KeycapHotkey = GlobalHotkey | keyof typeof FOCUSED_HOTKEYS | 'chat-send' | 'transcript';

/**
 * The keys of a shortcut, from the one map above, so no screen ever writes a key itself.
 *
 * @param hotkey The shortcut.
 * @param mac    True on macOS (ADR-0110: a Mac's keys); default false.
 * @returns Its Electron accelerator.
 * Called from: apps/web/src/ui/KeyCap.tsx, apps/web/src/features/settings/HotkeyList.tsx; tests
 */
export function hotkeyAccelerator(hotkey: KeycapHotkey, mac = false): string {
  if (hotkey === 'ask-kite') return ASK_KITE_HOTKEY;
  if (hotkey === 'voice-cancel') return VOICE_CANCEL_HOTKEY;
  if (hotkey === 'chat-send') return CHAT_SEND_KEY;
  if (hotkey === 'transcript') return TRANSCRIPT_HOTKEY;
  if (hotkey in FOCUSED_HOTKEYS) return focusedHotkeys(mac)[hotkey as FocusedHotkey];
  return globalHotkeys(mac)[hotkey as CallHotkey];
}

/** What each part of an accelerator looks like on a key-cap chip. */
const KEYCAP_SYMBOLS: Readonly<Record<string, string>> = {
  // ADR-0110: a Mac's keys name ⌘ and ⌃ themselves (Control+Alt, Control+Command).
  Command: '⌘',
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
 * (spec §4: on macOS, Ctrl shows as ⌘). ADR-0110: "Control" is ⌃ on a Mac (Ctrl elsewhere).
 *
 * @param accelerator An Electron accelerator.
 * @param mac         True on macOS.
 * @returns The parts, in order.
 * Called from: apps/web/src/ui/KeyCap.tsx; tests
 */
export function keycapParts(accelerator: string, mac: boolean): string[] {
  return accelerator.split('+').map((part) => {
    if (part === 'CommandOrControl') return mac ? '⌘' : 'Ctrl';
    if (part === 'Control') return mac ? '⌃' : 'Ctrl';
    if (part === 'Alt') return mac ? '⌥' : 'Alt';
    return KEYCAP_SYMBOLS[part] ?? part;
  });
}

/**
 * An accelerator in words for a button or a list: "Ctrl+Enter" on Windows, "⌘ Enter" on macOS.
 * ADR-0110: "Control" is ⌃ and "Command" ⌘ on a Mac ("⌃ ⌥ ←").
 *
 * @param accelerator An Electron accelerator.
 * @param mac         True on macOS.
 * @returns The label.
 * Called from: the live view's and overlay's buttons, Settings; tests
 */
export function hotkeyLabel(accelerator: string, mac: boolean): string {
  const keys = accelerator
    .replace('CommandOrControl', mac ? '⌘' : 'Ctrl')
    .replace(/\bControl\b/, mac ? '⌃' : 'Ctrl')
    .replace(/\bCommand\b/, '⌘')
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
