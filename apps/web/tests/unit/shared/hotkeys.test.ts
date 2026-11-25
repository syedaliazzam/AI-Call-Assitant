/**
 * Tests packages/shared/src/hotkeys.ts (v1.0.2, ADR-0035): no two Kite shortcuts share keys — the
 * call shortcuts, the focused ones and Ask Kite together — so adding the script bar (Ctrl+Alt+S)
 * cannot shadow another Kite shortcut; every global shortcut has a Settings row, and the script
 * bar is a page action the shell forwards (like Answer), not an overlay action. ADR-0110: the Mac keys
 * never hold a Mac text-editing or window key, change nothing else, never collide, and show ⌃ ⌥ / ⌃ ⌘.
 * Reviewed 25 Nov 2026: the whole table pinned on both systems; no Mac key takes a macOS system key or a
 * Zoom, Meet or Teams key; on Windows only the known Ctrl+Alt+H / Meet clash; which keys the page also handles.
 */
import {
  ASK_KITE_HOTKEY,
  DEFAULT_GLOBAL_HOTKEYS,
  desktopOnlyRow,
  FOCUSED_HOTKEYS,
  focusedHotkeys,
  GLOBAL_HOTKEYS,
  globalHotkeys,
  HOTKEY_ACTIONS,
  hotkeyAccelerator,
  hotkeyLabel,
  hotkeyRows,
  keycapParts,
  HOTKEY_ROWS,
  MAC_GLOBAL_HOTKEYS,
  MAC_HOTKEY_CHANGES,
  PAGE_HANDLED_HOTKEYS,
  SCREENSHOT_SEND_HOTKEY,
  TRANSCRIPT_HOTKEY,
  VOICE_CANCEL_HOTKEY,
  worksInPage,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';

describe('key-cap chips (spec §4)', () => {
  it('reads every kind of shortcut from the one map', () => {
    expect(hotkeyAccelerator('answer')).toBe(DEFAULT_GLOBAL_HOTKEYS.answer);
    expect(hotkeyAccelerator('clear-transcript')).toBe(FOCUSED_HOTKEYS['clear-transcript']);
    expect(hotkeyAccelerator('ask-kite')).toBe(ASK_KITE_HOTKEY);
  });

  it('draws the keys as the bars show them', () => {
    expect(keycapParts(hotkeyAccelerator('answer'), false)).toEqual(['Ctrl', '↵']);
    expect(keycapParts(hotkeyAccelerator('screenshot'), false)).toEqual(['Ctrl', '⇧', '↵']);
    expect(keycapParts(hotkeyAccelerator('chat'), false)).toEqual(['Ctrl', '⇧', '␣']);
    expect(keycapParts(hotkeyAccelerator('clear-transcript'), false)).toEqual(['Ctrl', '⇧', '⌫']);
    expect(keycapParts(hotkeyAccelerator('prev'), false)).toEqual(['Ctrl', '←']);
  });

  it('shows ⌘ and ⌥ on macOS', () => {
    expect(keycapParts(hotkeyAccelerator('answer'), true)).toEqual(['⌘', '↵']);
    expect(keycapParts(hotkeyAccelerator('ask-kite'), true)).toEqual(['⌘', '⌥', 'K']);
  });
});

describe('Kite shortcuts', () => {
  it('never share an accelerator (global, Ask Kite and Escape together)', () => {
    const all = [
      ...Object.values(DEFAULT_GLOBAL_HOTKEYS),
      ASK_KITE_HOTKEY,
      VOICE_CANCEL_HOTKEY,
    ].map((accelerator) => accelerator.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it('ADR-0082: holds the ParakeetAI keys during a call; the focused ones are the same keys', () => {
    expect(DEFAULT_GLOBAL_HOTKEYS).toMatchObject({
      answer: 'CommandOrControl+Enter',
      screenshot: 'CommandOrControl+Shift+Enter',
      chat: 'CommandOrControl+Shift+Space',
      'screenshot-send': 'CommandOrControl+Alt+Enter',
      prev: 'CommandOrControl+Left',
      next: 'CommandOrControl+Right',
      clear: 'CommandOrControl+Backspace',
      'clear-transcript': 'CommandOrControl+Shift+Backspace',
      'zoom-in': 'CommandOrControl+=',
      'zoom-out': 'CommandOrControl+-',
      'zoom-reset': 'CommandOrControl+0',
      record: 'CommandOrControl+Alt+R',
      'click-through': 'CommandOrControl+Alt+X',
      'overlay-toggle': 'CommandOrControl+Alt+H',
    });
    for (const [action, keys] of Object.entries(FOCUSED_HOTKEYS)) {
      expect(DEFAULT_GLOBAL_HOTKEYS[action as keyof typeof FOCUSED_HOTKEYS]).toBe(keys);
    }
    expect(HOTKEY_ACTIONS).toEqual(
      expect.arrayContaining(['zoom-in', 'zoom-out', 'zoom-reset', 'voice-cancel']),
    );
    expect(hotkeyAccelerator('voice-cancel')).toBe('Escape');
    expect(HOTKEY_ROWS.find((row) => row.actions.includes('chat'))?.label).toMatch(
      /^Voice question/,
    );
    expect(HOTKEY_ROWS.find((row) => row.actions.includes('clear'))?.label).toBe('Clear answers');
  });

  it('give the script bar Ctrl+Alt+S, as a page action with a Settings row', () => {
    expect(DEFAULT_GLOBAL_HOTKEYS['script-bar']).toBe('CommandOrControl+Alt+S');
    expect(GLOBAL_HOTKEYS).toContain('script-bar');
    expect(HOTKEY_ACTIONS).toContain('script-bar');
    expect(HOTKEY_ROWS.find((row) => row.label === 'Script bar')).toMatchObject({
      scope: 'global',
      actions: ['script-bar'],
    });
  });

  it('list every global shortcut in exactly one Settings row', () => {
    const listed = HOTKEY_ROWS.flatMap((row) => row.actions);
    // v1.3.0 (ADR-0056): plus Transcript, checked (never held) so Settings can report a clash.
    expect([...listed].sort()).toEqual(
      // ADR-0082: Ctrl+Alt+Enter is one of the call shortcuts now.
      [...GLOBAL_HOTKEYS, 'ask-kite', 'transcript'].sort(),
    );
  });

  it('the chat bar has its key-caps from the map, and Settings lists the new shortcut', () => {
    expect(hotkeyAccelerator('screenshot-send')).toBe('CommandOrControl+Alt+Enter');
    expect(hotkeyAccelerator('chat-send')).toBe('Enter');
    expect(keycapParts(hotkeyAccelerator('screenshot-send'), false)).toEqual(['Ctrl', 'Alt', '↵']);
    expect(keycapParts(hotkeyAccelerator('chat-send'), false)).toEqual(['↵']);
    const row = HOTKEY_ROWS.find((one) => one.actions.includes('screenshot-send'));
    expect(row?.accelerator).toBe(SCREENSHOT_SEND_HOTKEY);
    expect(HOTKEY_ACTIONS).toContain('screenshot-send');
  });
});

describe('moving the overlay (ADR-0095)', () => {
  it('jumps between positions with Ctrl+Shift+Arrows, and nudges with Ctrl+Alt+Shift+Arrows', () => {
    expect(DEFAULT_GLOBAL_HOTKEYS['overlay-spot-left']).toBe('CommandOrControl+Shift+Left');
    expect(DEFAULT_GLOBAL_HOTKEYS['overlay-spot-right']).toBe('CommandOrControl+Shift+Right');
    expect(DEFAULT_GLOBAL_HOTKEYS['overlay-row-top']).toBe('CommandOrControl+Shift+Up');
    expect(DEFAULT_GLOBAL_HOTKEYS['overlay-row-bottom']).toBe('CommandOrControl+Shift+Down');
    expect(DEFAULT_GLOBAL_HOTKEYS['overlay-up']).toBe('CommandOrControl+Alt+Shift+Up');
    expect(Object.values(DEFAULT_GLOBAL_HOTKEYS)).not.toContain('CommandOrControl+Alt+Left');
  });

  it('never shares keys between two shortcuts', () => {
    const keys = Object.values(DEFAULT_GLOBAL_HOTKEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('lists the move row with its new keys', () => {
    const row = HOTKEY_ROWS.find((candidate) => candidate.actions.includes('overlay-spot-left'));
    expect(row?.keysOverride).toBe('CommandOrControl+Shift+Arrows');
  });
});

describe('the Mac keys (ADR-0110)', () => {
  /** The Mac's text-editing and window keys a call must never take. */
  const MAC_EDITING_KEYS = [
    'CommandOrControl+Left',
    'CommandOrControl+Right',
    'CommandOrControl+Backspace',
    'CommandOrControl+=',
    'CommandOrControl+-',
    'CommandOrControl+0',
    'CommandOrControl+Shift+Left',
    'CommandOrControl+Shift+Right',
    'CommandOrControl+Shift+Up',
    'CommandOrControl+Shift+Down',
    'CommandOrControl+Alt+H',
  ];

  it('never holds a Mac text-editing or window key', () => {
    const mac = Object.values(globalHotkeys(true));
    for (const key of MAC_EDITING_KEYS) expect(mac).not.toContain(key);
  });

  it('changes only those keys, and keeps every other one as on Windows', () => {
    for (const action of GLOBAL_HOTKEYS) {
      if (action in MAC_HOTKEY_CHANGES) continue;
      expect(MAC_GLOBAL_HOTKEYS[action]).toBe(DEFAULT_GLOBAL_HOTKEYS[action]);
    }
    expect(globalHotkeys(false)).toBe(DEFAULT_GLOBAL_HOTKEYS);
  });

  it('has no two Mac shortcuts on the same keys', () => {
    const keys = [
      ...Object.values(MAC_GLOBAL_HOTKEYS),
      ASK_KITE_HOTKEY,
      TRANSCRIPT_HOTKEY,
      VOICE_CANCEL_HOTKEY,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shows ⌃ ⌥ and ⌃ ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(hotkeyAccelerator('clear', true)).toBe('Control+Alt+Backspace');
    expect(hotkeyAccelerator('clear')).toBe('CommandOrControl+Backspace');
    expect(keycapParts(hotkeyAccelerator('prev', true), true)).toEqual(['⌃', '⌥', '←']);
    expect(keycapParts(hotkeyAccelerator('overlay-row-top', true), true)).toEqual(['⌃', '⌘', '↑']);
    expect(keycapParts(hotkeyAccelerator('answer', true), true)).toEqual(['⌘', '↵']);
    expect(hotkeyLabel('Control+Alt+Shift+Backspace', true)).toBe('⌃ ⌥ ⇧ ⌫');
    expect(hotkeyLabel('Control+Command+Left', true)).toBe('⌃ ⌘ ←');
    expect(hotkeyLabel('Control+Alt+Left', false)).toBe('Ctrl+Alt+←');
    expect(focusedHotkeys(true).next).toBe('Control+Alt+Right');
    expect(focusedHotkeys(false)).toEqual(FOCUSED_HOTKEYS);
  });

  it('lists the Mac keys in Settings on a Mac, and the same rows', () => {
    const mac = hotkeyRows(true);
    expect(mac.map((row) => row.label)).toEqual(HOTKEY_ROWS.map((row) => row.label));
    expect(mac.find((row) => row.actions.includes('prev'))?.keysOverride).toBe(
      'Control+Alt+Left / Right',
    );
    expect(mac.find((row) => row.actions.includes('overlay-row-top'))?.keysOverride).toBe(
      'Control+Command+Arrows',
    );
    expect(mac.find((row) => row.actions.includes('answer'))?.accelerator).toBe(
      'CommandOrControl+Enter',
    );
  });
});

describe('the key table, Windows and Mac (ADR-0110, reviewed 25 Nov 2026)', () => {
  /**
   * Every call shortcut, Windows then Mac. The Mac keys are the Windows keys with ⌘ for Ctrl, except the
   * deliberate differences of ADR-0110, where ⌘ would take a Mac text-editing, Finder or window key, plain ⌃
   * a Mission Control key, and ⌘ = / - / 0 the meeting app's (or Chrome's) zoom.
   */
  const TABLE: Readonly<Record<string, readonly [string, string]>> = {
    answer: ['CommandOrControl+Enter', 'CommandOrControl+Enter'],
    screenshot: ['CommandOrControl+Shift+Enter', 'CommandOrControl+Shift+Enter'],
    chat: ['CommandOrControl+Shift+Space', 'CommandOrControl+Shift+Space'],
    'screenshot-send': ['CommandOrControl+Alt+Enter', 'CommandOrControl+Alt+Enter'],
    'clear-transcript': ['CommandOrControl+Shift+Backspace', 'Control+Alt+Shift+Backspace'],
    clear: ['CommandOrControl+Backspace', 'Control+Alt+Backspace'],
    prev: ['CommandOrControl+Left', 'Control+Alt+Left'],
    next: ['CommandOrControl+Right', 'Control+Alt+Right'],
    'zoom-in': ['CommandOrControl+=', 'Control+Alt+='],
    'zoom-out': ['CommandOrControl+-', 'Control+Alt+-'],
    'zoom-reset': ['CommandOrControl+0', 'Control+Alt+0'],
    'overlay-toggle': ['CommandOrControl+Alt+H', 'Control+Alt+H'],
    'script-bar': ['CommandOrControl+Alt+S', 'CommandOrControl+Alt+S'],
    'click-through': ['CommandOrControl+Alt+X', 'CommandOrControl+Alt+X'],
    record: ['CommandOrControl+Alt+R', 'CommandOrControl+Alt+R'],
    'overlay-spot-left': ['CommandOrControl+Shift+Left', 'Control+Command+Left'],
    'overlay-spot-right': ['CommandOrControl+Shift+Right', 'Control+Command+Right'],
    'overlay-row-top': ['CommandOrControl+Shift+Up', 'Control+Command+Up'],
    'overlay-row-bottom': ['CommandOrControl+Shift+Down', 'Control+Command+Down'],
    'overlay-up': ['CommandOrControl+Alt+Shift+Up', 'CommandOrControl+Alt+Shift+Up'],
    'overlay-down': ['CommandOrControl+Alt+Shift+Down', 'CommandOrControl+Alt+Shift+Down'],
    'overlay-left': ['CommandOrControl+Alt+Shift+Left', 'CommandOrControl+Alt+Shift+Left'],
    'overlay-right': ['CommandOrControl+Alt+Shift+Right', 'CommandOrControl+Alt+Shift+Right'],
  };

  /**
   * An accelerator as the keys pressed, for comparing combinations: CommandOrControl is ⌘ on a Mac and Ctrl
   * on Windows; the names are sorted, so the order of the modifiers does not matter.
   *
   * @param accelerator An Electron accelerator.
   * @param mac         True for a Mac.
   * @returns The sorted key names, joined with "+".
   */
  const pressed = (accelerator: string, mac: boolean) =>
    accelerator
      .replace('CommandOrControl', mac ? 'Command' : 'Control')
      .split('+')
      .map((part) => part.toLowerCase())
      .sort()
      .join('+');

  it('pins every call shortcut on both systems; only ADR-0110 keys differ', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...GLOBAL_HOTKEYS].sort());
    for (const action of GLOBAL_HOTKEYS) {
      const [windows, mac] = TABLE[action]!;
      expect(DEFAULT_GLOBAL_HOTKEYS[action], action).toBe(windows);
      expect(MAC_GLOBAL_HOTKEYS[action], action).toBe(mac);
    }
    const differ = GLOBAL_HOTKEYS.filter((action) => TABLE[action]![0] !== TABLE[action]![1]);
    expect(differ.sort()).toEqual(Object.keys(MAC_HOTKEY_CHANGES).sort());
    expect(ASK_KITE_HOTKEY).toBe('CommandOrControl+Alt+K');
    expect(TRANSCRIPT_HOTKEY).toBe('CommandOrControl+Alt+T');
  });

  /**
   * macOS's own shortcuts (Apple's "Mac keyboard shortcuts": Spotlight, input sources, Mission Control,
   * screenshots, the Character Viewer) and the meeting apps' Mac shortcuts as their makers publish them (Zoom,
   * Google Meet in Chrome, Microsoft Teams; read 25 Nov 2026). A call's global shortcut would take them.
   */
  const MAC_RESERVED = [
    // Spotlight; input sources; the Character Viewer.
    'Command+Space',
    'Alt+Command+Space',
    'Control+Space',
    'Alt+Control+Space',
    'Command+Control+Space',
    // Mission Control, application windows, the spaces left and right.
    'Control+Up',
    'Control+Down',
    'Control+Left',
    'Control+Right',
    // Screenshots.
    'Command+Shift+3',
    'Command+Shift+4',
    'Command+Shift+5',
    'Command+Shift+6',
    // Zoom: mute, video, share, chat, view, record, full screen, meeting controls.
    'Command+Shift+A',
    'Command+Shift+V',
    'Command+Shift+S',
    'Command+Shift+H',
    'Command+Shift+W',
    'Command+Shift+R',
    'Command+Shift+F',
    'Alt+Command+Control+H',
    // Google Meet in Chrome: microphone, camera, raise hand, chat, people; Chrome's zoom.
    'Command+D',
    'Command+E',
    'Command+Control+H',
    'Command+Control+C',
    'Command+Control+P',
    'Command+=',
    'Command+-',
    'Command+0',
    // Microsoft Teams: mute, video, share, raise hand, decline.
    'Command+Shift+M',
    'Command+Shift+O',
    'Command+Shift+E',
    'Command+Shift+K',
    'Command+Shift+D',
  ].map((key) => pressed(key, true));

  it('takes no macOS system key and no Zoom, Meet or Teams key on a Mac', () => {
    const held = [...Object.values(MAC_GLOBAL_HOTKEYS), ASK_KITE_HOTKEY].map((key) =>
      pressed(key, true),
    );
    for (const key of held) expect(MAC_RESERVED, key).not.toContain(key);
  });

  /** The meeting apps' Windows shortcuts (Zoom, Google Meet in Chrome, Microsoft Teams; read 25 Nov 2026). */
  const WINDOWS_MEETING_KEYS = [
    'Alt+A',
    'Alt+V',
    'Alt+S',
    'Alt+H',
    'Alt+R',
    'Alt+F',
    'Control+D',
    'Control+E',
    'Alt+Control+H',
    'Alt+Control+C',
    'Alt+Control+P',
    'Control+Shift+M',
    'Control+Shift+O',
    'Control+Shift+E',
    'Control+Shift+K',
    'Control+Shift+A',
    'Control+Shift+S',
    'Control+Shift+D',
    'Control+Shift+H',
  ].map((key) => pressed(key, false));

  /**
   * A clash already known and left for the developer's decision (investigation of 25 Nov 2026, D-6): show or
   * hide the overlay (Ctrl+Alt+H) is Google Meet's raise hand on Windows. Changing it needs a Windows release.
   */
  const KNOWN_WINDOWS_CLASHES = [pressed('CommandOrControl+Alt+H', false)];

  it('takes no Zoom, Meet or Teams key on Windows, except the one known clash', () => {
    const held = [...Object.values(DEFAULT_GLOBAL_HOTKEYS), ASK_KITE_HOTKEY].map((key) =>
      pressed(key, false),
    );
    expect(held.filter((key) => WINDOWS_MEETING_KEYS.includes(key))).toEqual(KNOWN_WINDOWS_CLASHES);
  });

  it('knows which shortcuts the page also handles (they still work with Paramount AI in front)', () => {
    for (const action of [
      'answer',
      'clear',
      'prev',
      'zoom-in',
      'script-bar',
      'ask-kite',
    ] as const) {
      expect(worksInPage(action), action).toBe(true);
    }
    for (const action of [
      'overlay-toggle',
      'overlay-row-top',
      'click-through',
      'record',
    ] as const) {
      expect(worksInPage(action), action).toBe(false);
    }
    const toggle = HOTKEY_ROWS.find((row) => row.actions.includes('overlay-toggle'))!;
    const answer = HOTKEY_ROWS.find((row) => row.actions.includes('answer'))!;
    expect(desktopOnlyRow(toggle)).toBe(true);
    expect(desktopOnlyRow(answer)).toBe(false);
    expect(desktopOnlyRow({ actions: [] })).toBe(true);
    expect(PAGE_HANDLED_HOTKEYS.has('transcript')).toBe(true);
  });
});
