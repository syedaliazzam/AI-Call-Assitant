/**
 * Tests for the ADR-0082 call changes outside the overlay's components:
 * - apps/web/src/platform/keymap.ts: Ctrl+Backspace is Clear answers, Ctrl+Shift+Backspace Clear transcript,
 *   Ctrl+= / Ctrl+- / Ctrl+0 the zoom keys (not while typing), and a plain Escape cancels a voice question;
 * - apps/web/src/core/voice/dictation.ts: a voice question always listens with a target whose words are kept
 *   out of the transcript (never a "You" line, never a reply);
 * - apps/web/src/core/audio/channelSilence.ts: the other side is never called silent while its words keep
 *   arriving, even with its meter under the silent level (the 14 Nov speakers-on call), and words never
 *   raise the microphone warning;
 * - apps/web/src/core/storage/appearancePrefs.ts: the zoom keys step the ⋮ menu's Zoom within its range;
 * - apps/web/src/features/live/useLiveAnswers.ts: Clear answers hides every answer asked until then;
 * - apps/web/src/features/live/overlay/RecordControls.tsx: the Rec pill starts at once only with consent
 *   ticked at Connect, and only when off;
 * - apps/web/src/core/live/liveChannel.ts: the overlay's voice commands are accepted, malformed ones not.
 */
import { describe, expect, it, vi } from 'vitest';
import { hotkeyFor, isVoiceCancelKey, type KeyPress } from '@/platform/keymap';
import { shouldDivert, voiceQuestionTarget } from '@/core/voice/dictation';
import { ChannelSilence, THEM_SILENT_FOR_MS } from '@/core/audio/channelSilence';
import { isCommand } from '@/core/live/liveChannel';

vi.mock('@/platform', () => ({
  getPlatform: () => ({
    getShareProtection: async () => ({ supported: true, on: true }),
    setShareProtection: async (on: boolean) => ({ supported: true, on }),
  }),
}));
const { answersAfterClear } = await import('@/features/live/useLiveAnswers');
const { pressRecPill } = await import('@/features/live/overlay/RecordControls');
const { getZoom, setZoom, stepZoom, ZOOM_RANGE } = await import('@/core/storage/appearancePrefs');

/**
 * A key press with Ctrl held (Windows).
 *
 * @param key    The key.
 * @param fields Other modifiers or the target.
 * @returns The key press.
 */
function ctrl(key: string, fields: Partial<KeyPress> = {}): KeyPress {
  return {
    key,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: null,
    ...fields,
  };
}

describe('the call keys (ADR-0082)', () => {
  it('Ctrl+Backspace clears the answers; Ctrl+Shift+Backspace the transcript', () => {
    expect(hotkeyFor(ctrl('Backspace'), false)).toBe('clear');
    expect(hotkeyFor(ctrl('Backspace', { shiftKey: true }), false)).toBe('clear-transcript');
  });

  it('Ctrl+= (or +), Ctrl+- and Ctrl+0 zoom, but never while typing', () => {
    expect(hotkeyFor(ctrl('='), false)).toBe('zoom-in');
    expect(hotkeyFor(ctrl('+', { shiftKey: true }), false)).toBe('zoom-in');
    expect(hotkeyFor(ctrl('-'), false)).toBe('zoom-out');
    expect(hotkeyFor(ctrl('0'), false)).toBe('zoom-reset');
    const box = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(hotkeyFor(ctrl('=', { target: box }), false)).toBeNull();
  });

  it('Ctrl+Shift+Space is the voice question and Ctrl+Alt+Enter the screenshot one', () => {
    expect(hotkeyFor(ctrl(' ', { shiftKey: true }), false)).toBe('chat');
    expect(hotkeyFor(ctrl('Enter', { altKey: true }), false)).toBe('screenshot-send');
  });

  it('only a plain Escape cancels a voice question', () => {
    expect(isVoiceCancelKey(ctrl('Escape', { ctrlKey: false }))).toBe(true);
    expect(isVoiceCancelKey(ctrl('Escape'))).toBe(false);
    expect(isVoiceCancelKey(ctrl('Escape', { ctrlKey: false, shiftKey: true }))).toBe(false);
  });
});

describe('the voice question is never a transcript line (ADR-0082)', () => {
  it('listens with a diverted target whatever the chat switch says', () => {
    for (const target of ['auto', 'call', 'kite'] as const) {
      expect(shouldDivert(true, voiceQuestionTarget(target))).toBe(true);
    }
    expect(voiceQuestionTarget('call')).toBe('auto');
    expect(voiceQuestionTarget('kite')).toBe('kite');
  });
});

describe('no false "can\'t hear the other side" (ADR-0082)', () => {
  it('never calls the other side silent while its words keep arriving, whatever its meter says', () => {
    const silence = new ChannelSilence(0);
    for (let at = 0; at <= THEM_SILENT_FOR_MS * 2; at += 1_000) {
      // The user talks now and then (their meter has sound), the other side's meter stays quiet (speakers on).
      silence.levels({ you: at % 20_000 < 3_000 ? 0.6 : 0, them: 0.05 }, at);
      // Their lines still arrive every few seconds.
      if (at % 5_000 === 0) silence.heard('them', at);
      expect(silence.silent(at)).not.toBe('them');
    }
  });

  it('still warns when their words and their sound both stop', () => {
    const silence = new ChannelSilence(0);
    silence.heard('them', 0);
    let warned = false;
    for (let at = 0; at <= THEM_SILENT_FOR_MS + 10_000; at += 1_000) {
      silence.levels({ you: at % 20_000 < 3_000 ? 0.6 : 0, them: 0 }, at);
      if (silence.silent(at) === 'them') warned = true;
    }
    expect(warned).toBe(true);
  });

  it('their words never make the microphone look silent', () => {
    const silence = new ChannelSilence(0);
    for (let at = 0; at <= 30_000; at += 1_000) {
      silence.levels({ you: 0, them: 0 }, at);
      silence.heard('them', at);
      expect(silence.silent(at)).toBeNull();
    }
  });
});

describe('the zoom keys (ADR-0082)', () => {
  it('step the Zoom setting within its range, and Ctrl+0 resets it', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
    setZoom(1);
    expect(stepZoom('zoom-in')).toBe(1.1);
    expect(getZoom()).toBe(1.1);
    for (let i = 0; i < 10; i += 1) stepZoom('zoom-in');
    expect(getZoom()).toBe(ZOOM_RANGE.max);
    expect(stepZoom('zoom-reset')).toBe(ZOOM_RANGE.default);
    for (let i = 0; i < 10; i += 1) stepZoom('zoom-out');
    expect(getZoom()).toBe(ZOOM_RANGE.min);
    vi.unstubAllGlobals();
  });
});

describe('Clear answers (Ctrl+Backspace, ADR-0082)', () => {
  it('hides every answer asked until the press; later ones show', () => {
    const list = [{ askedAt: 100 }, { askedAt: 200 }, { askedAt: 300 }];
    expect(answersAfterClear(list, 0)).toEqual(list);
    expect(answersAfterClear(list, 300)).toEqual([]);
    expect(answersAfterClear(list, 150)).toEqual([{ askedAt: 200 }, { askedAt: 300 }]);
  });
});

describe('the Rec pill with consent ticked at Connect (ADR-0082)', () => {
  it('starts at once only when consented and off; otherwise asks', () => {
    const commands: unknown[] = [];
    let asked = 0;
    const ask = () => (asked += 1);
    const send = (command: unknown) => commands.push(command);
    pressRecPill({ state: 'off', consented: true, kind: 'screen', displayId: '2' }, send, ask);
    pressRecPill({ state: 'off', consented: true, kind: 'audio', displayId: '2' }, send, ask);
    expect(commands).toEqual([
      { type: 'record-start', displayId: '2' },
      { type: 'record-start', displayId: null },
    ]);
    pressRecPill({ state: 'off', consented: false, kind: 'screen', displayId: null }, send, ask);
    pressRecPill({ state: 'off', kind: 'screen', displayId: null }, send, ask);
    pressRecPill({ state: 'on', consented: true, kind: 'screen', displayId: null }, send, ask);
    expect(asked).toBe(3);
    expect(commands).toHaveLength(2);
  });
});

describe("the overlay's voice commands (ADR-0082)", () => {
  it('are accepted when well formed', () => {
    expect(isCommand({ type: 'voice', screenshot: false })).toBe(true);
    expect(isCommand({ type: 'voice', screenshot: true })).toBe(true);
    expect(isCommand({ type: 'voice-cancel' })).toBe(true);
    expect(isCommand({ type: 'voice' })).toBe(false);
    expect(isCommand({ type: 'voice', screenshot: 'yes' })).toBe(false);
  });
});
