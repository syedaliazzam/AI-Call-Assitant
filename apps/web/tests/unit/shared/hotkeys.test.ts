/**
 * Tests packages/shared/src/hotkeys.ts (v1.0.2, ADR-0035): no two Kite shortcuts share keys — the
 * call shortcuts, the focused ones and Ask Kite together — so adding the script bar (Ctrl+Alt+S)
 * cannot shadow another Kite shortcut; every global shortcut has a Settings row, and the script
 * bar is a page action the shell forwards (like Answer), not an overlay action. ADR-0110 (amended 27 Nov 2026,
 * Mac 1.8.1): the Mac keys are the Windows keys with Control (⌃), never ⌘; the whole table pinned on both systems;
 * show or hide is Ctrl+Alt+Y (ADR-0127), free in Zoom, Meet and Teams on both; the known clashes are pinned (macOS
 * defaults with the notes Settings shows; the Windows meeting keys found 27 Nov 2026); which keys the page handles.
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
  MAC_SYSTEM_CLASHES,
  macKeys,
  macSystemNotes,
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
      'overlay-toggle': 'CommandOrControl+Alt+Y',
    });
    for (const [action, keys] of Object.entries(FOCUSED_HOTKEYS)) {
      expect(DEFAULT_GLOBAL_HOTKEYS[action as keyof typeof FOCUSED_HOTKEYS]).toBe(keys);
    }
    expect(HOTKEY_ACTIONS).toEqual(
      expect.arrayContaining(['zoom-in', 'zoom-out', 'zoom-reset', 'voice-cancel']),
    );
    expect(hotkeyAccelerator('voice-cancel')).toBe('Escape');
    // ADR-0123: Ctrl+Shift+Space answers the user's own last spoken question (it listened for one before).
    expect(HOTKEY_ROWS.find((row) => row.actions.includes('chat'))?.label).toBe(
      'Answer your own last spoken question (on a call too)',
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

describe('the Mac keys (ADR-0110 amended 27 Nov 2026, Mac 1.8.1)', () => {
  it('are the Windows keys with Control (⌃) for Ctrl, and never use ⌘', () => {
    for (const action of GLOBAL_HOTKEYS) {
      expect(MAC_GLOBAL_HOTKEYS[action], action).toBe(macKeys(DEFAULT_GLOBAL_HOTKEYS[action]));
      expect(MAC_GLOBAL_HOTKEYS[action], action).not.toMatch(/Command/);
    }
    expect(globalHotkeys(false)).toBe(DEFAULT_GLOBAL_HOTKEYS);
    expect(globalHotkeys(true)).toBe(MAC_GLOBAL_HOTKEYS);
    expect(hotkeyAccelerator('ask-kite', true)).toBe('Control+Alt+K');
    expect(hotkeyAccelerator('transcript', true)).toBe('Control+Alt+T');
    expect(hotkeyAccelerator('voice-cancel', true)).toBe('Escape');
  });

  it('has no two Mac shortcuts on the same keys', () => {
    const keys = [
      ...Object.values(MAC_GLOBAL_HOTKEYS),
      hotkeyAccelerator('ask-kite', true),
      hotkeyAccelerator('transcript', true),
      VOICE_CANCEL_HOTKEY,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('shows ⌃ and ⌥ on a Mac and Ctrl elsewhere', () => {
    expect(keycapParts(hotkeyAccelerator('answer', true), true)).toEqual(['⌃', '↵']);
    expect(keycapParts(hotkeyAccelerator('prev', true), true)).toEqual(['⌃', '←']);
    expect(keycapParts(hotkeyAccelerator('overlay-toggle', true), true)).toEqual(['⌃', '⌥', 'Y']);
    expect(hotkeyLabel(hotkeyAccelerator('clear-transcript', true), true)).toBe('⌃ ⇧ ⌫');
    expect(hotkeyLabel(hotkeyAccelerator('ask-kite', true), true)).toBe('⌃ ⌥ K');
    expect(hotkeyLabel(hotkeyAccelerator('clear'), false)).toBe('Ctrl+⌫');
    expect(focusedHotkeys(true).next).toBe('Control+Right');
    expect(focusedHotkeys(false)).toEqual(FOCUSED_HOTKEYS);
  });

  it('lists the Mac keys in Settings on a Mac, with the same rows', () => {
    const mac = hotkeyRows(true);
    expect(mac.map((row) => row.label)).toEqual(HOTKEY_ROWS.map((row) => row.label));
    const row = (action: string) => mac.find((one) => one.actions.includes(action as never))!;
    expect(row('prev').keysOverride).toBe('Control+Left / Right');
    expect(row('zoom-in').keysOverride).toBe('Control+= / - / 0');
    expect(row('overlay-row-top').keysOverride).toBe('Control+Shift+Arrows');
    expect(row('overlay-up').keysOverride).toBe('Control+Alt+Shift+Arrows');
    expect(row('answer').accelerator).toBe('Control+Enter');
    expect(row('screenshot-send').accelerator).toBe('Control+Alt+Enter');
    expect(row('ask-kite').accelerator).toBe('Control+Alt+K');
    expect(row('transcript').accelerator).toBe('Control+Alt+T');
    // No row on a Mac shows ⌘ (the 'classic' row is for desktop apps before 1.3.0, which never existed on a Mac).
    for (const one of mac.filter((candidate) => candidate.shells !== 'classic')) {
      expect(one.keysOverride ?? one.accelerator).not.toMatch(/Command/);
    }
  });
});

describe('the key table, Windows and Mac (ADR-0110 amended 27 Nov 2026, ADR-0127)', () => {
  /**
   * Every call shortcut: Windows, then Mac (Mac 1.8.1 and the web app on a Mac). The Mac 1.8.0 keys they replace are
   * in ADR-0110's amendment of 27 Nov 2026.
   */
  const TABLE: Readonly<Record<string, readonly [string, string]>> = {
    answer: ['CommandOrControl+Enter', 'Control+Enter'],
    screenshot: ['CommandOrControl+Shift+Enter', 'Control+Shift+Enter'],
    chat: ['CommandOrControl+Shift+Space', 'Control+Shift+Space'],
    'screenshot-send': ['CommandOrControl+Alt+Enter', 'Control+Alt+Enter'],
    'clear-transcript': ['CommandOrControl+Shift+Backspace', 'Control+Shift+Backspace'],
    clear: ['CommandOrControl+Backspace', 'Control+Backspace'],
    prev: ['CommandOrControl+Left', 'Control+Left'],
    next: ['CommandOrControl+Right', 'Control+Right'],
    'zoom-in': ['CommandOrControl+=', 'Control+='],
    'zoom-out': ['CommandOrControl+-', 'Control+-'],
    'zoom-reset': ['CommandOrControl+0', 'Control+0'],
    'overlay-toggle': ['CommandOrControl+Alt+Y', 'Control+Alt+Y'],
    'script-bar': ['CommandOrControl+Alt+S', 'Control+Alt+S'],
    'click-through': ['CommandOrControl+Alt+X', 'Control+Alt+X'],
    record: ['CommandOrControl+Alt+R', 'Control+Alt+R'],
    'overlay-spot-left': ['CommandOrControl+Shift+Left', 'Control+Shift+Left'],
    'overlay-spot-right': ['CommandOrControl+Shift+Right', 'Control+Shift+Right'],
    'overlay-row-top': ['CommandOrControl+Shift+Up', 'Control+Shift+Up'],
    'overlay-row-bottom': ['CommandOrControl+Shift+Down', 'Control+Shift+Down'],
    'overlay-up': ['CommandOrControl+Alt+Shift+Up', 'Control+Alt+Shift+Up'],
    'overlay-down': ['CommandOrControl+Alt+Shift+Down', 'Control+Alt+Shift+Down'],
    'overlay-left': ['CommandOrControl+Alt+Shift+Left', 'Control+Alt+Shift+Left'],
    'overlay-right': ['CommandOrControl+Alt+Shift+Right', 'Control+Alt+Shift+Right'],
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

  it('pins every call shortcut on both systems', () => {
    expect(Object.keys(TABLE).sort()).toEqual([...GLOBAL_HOTKEYS].sort());
    for (const action of GLOBAL_HOTKEYS) {
      const [windows, mac] = TABLE[action]!;
      expect(DEFAULT_GLOBAL_HOTKEYS[action], action).toBe(windows);
      expect(MAC_GLOBAL_HOTKEYS[action], action).toBe(mac);
    }
    expect(ASK_KITE_HOTKEY).toBe('CommandOrControl+Alt+K');
    expect(TRANSCRIPT_HOTKEY).toBe('CommandOrControl+Alt+T');
  });

  /**
   * macOS's own shortcuts (Apple's "Mac keyboard shortcuts" and Mission Control, input sources, Finder, Focus keys)
   * and the meeting apps' Mac shortcuts as their makers publish them (Zoom Workplace, Google Meet in Chrome,
   * Microsoft Teams; read 27 Nov 2026).
   */
  const MAC_RESERVED: Readonly<Record<string, string>> = {
    'Command+Space': 'Spotlight',
    'Control+Space': 'previous input source',
    'Alt+Control+Space': 'next input source',
    'Command+Control+Space': 'Character Viewer',
    'Control+Up': 'Mission Control',
    'Control+Down': 'application windows',
    'Control+Left': 'Mission Control: move a space left',
    'Control+Right': 'Mission Control: move a space right',
    'Command+Control+F': 'full screen',
    'Command+Control+Q': 'lock screen',
    'Control+Tab': 'next tab / Focus',
    'Command+Shift+3': 'screenshot',
    'Command+Shift+4': 'screenshot',
    'Command+Shift+5': 'screenshot',
    'Control+\\': 'Zoom: always show meeting controls',
    'Control+P': 'Zoom: previous gallery page',
    'Control+N': 'Zoom: next gallery page',
    'Control+Shift+R': 'Zoom: remote control',
    'Control+Shift+G': 'Zoom: stop remote control',
    'Alt+Command+Control+H': 'Zoom: floating meeting controls',
    'Alt+Control+Shift+V': 'Zoom: share log',
    'Alt+Y': 'Zoom: raise hand',
    'Command+Shift+A': 'Zoom: mute',
    'Command+Shift+V': 'Zoom: video',
    'Command+D': 'Meet: microphone',
    'Command+E': 'Meet: camera',
    'Command+Control+H': 'Meet: raise hand',
    'Command+Control+C': 'Meet: chat',
    'Command+Control+P': 'Meet: people',
    'Command+Control+K': 'Meet: more tiles',
    'Command+Control+X': 'Meet: reactions / Teams',
    'Alt+Space': 'Teams: hold to unmute',
    'Control+0': 'Teams: reset zoom',
    'Control+L': 'Teams: chat options',
    'Command+Shift+M': 'Teams: mute',
    'Command+Shift+K': 'Teams: raise hand',
  };

  /**
   * The Mac keys that take one of those, each with the Settings note that says so (MAC_SYSTEM_CLASHES): Mission
   * Control's ⌃← / ⌃→ (previous / next answer) and Teams' ⌃0 (zoom reset).
   */
  const KNOWN_MAC_CLASHES: Readonly<Record<string, string>> = {
    prev: 'Control+Left',
    next: 'Control+Right',
    'zoom-reset': 'Control+0',
  };

  it('on a Mac takes only the known macOS and Teams keys, and Settings notes each one', () => {
    const reserved = new Set(Object.keys(MAC_RESERVED).map((key) => pressed(key, true)));
    const taken = Object.entries(MAC_GLOBAL_HOTKEYS)
      .concat([['ask-kite', hotkeyAccelerator('ask-kite', true)]])
      .filter(([, keys]) => reserved.has(pressed(keys, true)));
    expect(Object.fromEntries(taken)).toEqual(KNOWN_MAC_CLASHES);
    for (const action of Object.keys(KNOWN_MAC_CLASHES)) {
      expect(macSystemNotes({ actions: [action as never] }).length, action).toBeGreaterThan(0);
    }
    // Every ⌃ ⌥ shortcut carries the VoiceOver note.
    const voiceOver = MAC_SYSTEM_CLASHES.find((clash) => clash.note.includes('VoiceOver'))!;
    for (const [action, keys] of Object.entries(MAC_GLOBAL_HOTKEYS)) {
      if (keys.startsWith('Control+Alt+')) expect(voiceOver.actions, action).toContain(action);
    }
  });

  /**
   * The meeting apps' Windows shortcuts as their makers publish them (Zoom Workplace, Google Meet in Chrome,
   * Microsoft Teams; read 27 Nov 2026).
   */
  const WINDOWS_MEETING_KEYS: Readonly<Record<string, string>> = {
    'Alt+A': 'Zoom: mute',
    'Alt+V': 'Zoom: video',
    'Alt+S': 'Zoom: share',
    'Alt+H': 'Zoom: chat',
    'Alt+R': 'Zoom: record',
    'Alt+Control+Shift+H': 'Zoom: floating meeting controls',
    'Alt+Control+I': 'Zoom: add to chat / Meet: room info',
    'Control+=': 'Zoom and Teams: zoom in',
    'Control+-': 'Zoom and Teams: zoom out',
    'Control+0': 'Teams: reset zoom',
    'Control+D': 'Meet: microphone',
    'Control+E': 'Meet: camera',
    'Alt+Control+H': 'Meet: raise hand',
    'Alt+Control+C': 'Meet: chat / Teams: chats',
    'Alt+Control+P': 'Meet: people',
    'Alt+Control+T': 'Meet: present / Teams: toast',
    'Alt+Control+K': 'Meet: more tiles / Teams: mark read',
    'Alt+Control+J': 'Meet: fewer tiles',
    'Alt+Control+M': 'Meet: minimise video / Teams: mentions',
    'Alt+Control+S': 'Meet: announce speaker (screen reader)',
    'Alt+Control+X': 'Meet: announce reactions / Teams: strikethrough',
    'Alt+Control+R': 'Teams: react',
    'Alt+Control+Enter': 'Teams (chat)',
    'Control+Space': 'Teams: hold to unmute',
    'Control+Shift+Space': 'Teams: sharing toolbar',
    'Control+Shift+M': 'Teams: mute',
    'Control+Shift+O': 'Teams: video',
    'Control+Shift+E': 'Teams: share',
    'Control+Shift+K': 'Teams: raise hand',
    'Control+Shift+H': 'Teams: end call',
  };

  /**
   * Clashes on Windows that are already known (found 27 Nov 2026; keys unchanged since ADR-0082 / ADR-0095, the
   * developer's call). ADR-0127 removed the one with Google Meet's raise hand (Ctrl+Alt+H → Ctrl+Alt+Y).
   */
  const KNOWN_WINDOWS_CLASHES = [
    'CommandOrControl+Shift+Space',
    'CommandOrControl+Alt+Enter',
    'CommandOrControl+=',
    'CommandOrControl+-',
    'CommandOrControl+0',
    'CommandOrControl+Alt+S',
    'CommandOrControl+Alt+X',
    'CommandOrControl+Alt+R',
    'CommandOrControl+Alt+K',
  ]
    .map((key) => pressed(key, false))
    .sort();

  it('on Windows takes only the known meeting keys; show or hide (Ctrl+Alt+Y) takes none', () => {
    const meeting = new Set(Object.keys(WINDOWS_MEETING_KEYS).map((key) => pressed(key, false)));
    const held = [...Object.values(DEFAULT_GLOBAL_HOTKEYS), ASK_KITE_HOTKEY].map((key) =>
      pressed(key, false),
    );
    expect(held.filter((key) => meeting.has(key)).sort()).toEqual(KNOWN_WINDOWS_CLASHES);
    expect(meeting.has(pressed(DEFAULT_GLOBAL_HOTKEYS['overlay-toggle'], false))).toBe(false);
    expect(meeting.has(pressed(macKeys(DEFAULT_GLOBAL_HOTKEYS['overlay-toggle']), true))).toBe(
      false,
    );
    expect(
      new Set(Object.keys(MAC_RESERVED).map((key) => pressed(key, true))).has(
        pressed(MAC_GLOBAL_HOTKEYS['overlay-toggle'], true),
      ),
    ).toBe(false);
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
