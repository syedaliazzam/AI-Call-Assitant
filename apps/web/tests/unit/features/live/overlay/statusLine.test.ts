/**
 * Tests for apps/web/src/features/live/overlay/statusLine.ts (ADR-0082): the overlay's one status bar shows
 * the most important message with its button, in order (listening paused, "Still in a call?", a voice
 * question listening, a channel that hears nothing with its device list, the Answer key held elsewhere,
 * Private off in a screen recording, the other call notices, the voice question's notice, the answers'
 * notice, the headphones hint), and nothing (the live words) when there is none or the call ended.
 * ADR-0085: Private off during a call without a recording is an amber line with Turn on, after the
 * call's own notices.
 */
import { describe, expect, it } from 'vitest';
import type { CompactState } from '@/core/live/liveChannel';
import {
  HEADPHONES_TEXT,
  LISTENING_TEXT,
  PRIVATE_OFF_CALL_TEXT,
  SILENT_TEXT,
  statusMessage,
  VOICE_MODE_TEXT,
  VOICE_PAUSED_TEXT,
} from '@/features/live/overlay/statusLine';

/** A call's overlay state with nothing to say. */
const QUIET: CompactState = {
  audio: { you: true, them: true },
  chips: [],
  answer: null,
  index: -1,
  total: 0,
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
};

describe('statusMessage', () => {
  it('says nothing for a quiet call, before the live page answers, and after the call ended', () => {
    expect(statusMessage(QUIET, false)).toBeNull();
    expect(statusMessage(null, false)).toBeNull();
    expect(statusMessage({ ...QUIET, ended: true, notice: 'x' }, true)).toBeNull();
  });

  it('shows "Can\'t hear the other side" with Choose audio source, and the microphone\'s own', () => {
    const them = statusMessage(
      {
        ...QUIET,
        callNotice: {
          kind: 'them-silent',
          text: "We can't hear the other side — check the audio source.",
          detail: 'Share the meeting tab.',
          action: { list: 'audio', label: 'Choose audio source' },
        },
      },
      false,
    );
    expect(them).toMatchObject({
      key: 'them-silent',
      text: SILENT_TEXT.them,
      tone: 'alert',
      detail: 'Share the meeting tab.',
      action: { kind: 'list', list: 'audio', label: 'Choose audio source' },
    });
    const you = statusMessage(
      {
        ...QUIET,
        callNotice: {
          kind: 'mic-silent',
          text: "We can't hear your microphone — check the 🎤 picker.",
          detail: '',
          action: { list: 'mic', label: 'Choose microphone' },
        },
      },
      false,
    );
    expect(you).toMatchObject({ text: SILENT_TEXT.you, action: { kind: 'list', list: 'mic' } });
  });

  it('shows the headphones hint with OK, and the voice question listening with Cancel', () => {
    expect(statusMessage({ ...QUIET, headphonesHint: true }, false)).toMatchObject({
      text: HEADPHONES_TEXT,
      action: { kind: 'command', command: { type: 'headphones-seen' }, label: 'OK' },
    });
    expect(statusMessage({ ...QUIET, dictating: true }, false)).toMatchObject({
      key: 'listening',
      text: LISTENING_TEXT,
      action: { kind: 'command', command: { type: 'voice-cancel' }, label: 'Cancel' },
    });
  });

  it('puts the most important message first', () => {
    const everything: CompactState = {
      ...QUIET,
      hygiene: 'paused',
      dictating: true,
      callNotice: {
        kind: 'them-silent',
        text: 'x',
        detail: '',
        action: { list: 'audio', label: 'Choose audio source' },
      },
      answerKeyTaken: 'Ctrl+Enter',
      dictationNotice: 'Nothing heard',
      notice: 'Nothing to answer yet',
      headphonesHint: true,
    };
    const order: string[] = [];
    let state: CompactState = everything;
    let privateOff = true;
    for (let step = 0; step < 12; step += 1) {
      const message = statusMessage(state, privateOff);
      if (!message) break;
      order.push(message.key);
      // Take that message away and look again.
      if (message.key === 'paused' || message.key === 'still-here')
        state = { ...state, hygiene: 'ok' };
      else if (message.key === 'listening') state = { ...state, dictating: false };
      else if (message.key === 'them-silent' || message.key === 'call-notice') {
        const { callNotice: _gone, ...rest } = state;
        state = rest;
      } else if (message.key === 'answer-key') {
        const { answerKeyTaken: _gone, ...rest } = state;
        state = rest;
      } else if (message.key === 'private-off') privateOff = false;
      else if (message.key === 'voice-notice') state = { ...state, dictationNotice: null };
      else if (message.key === 'notice') state = { ...state, notice: null };
      else if (message.key === 'headphones') state = { ...state, headphonesHint: false };
    }
    expect(order).toEqual([
      'paused',
      'listening',
      'them-silent',
      'answer-key',
      'private-off',
      'voice-notice',
      'notice',
      'headphones',
    ]);
  });

  it('shows a call notice without a button quietly (catching up, cloud transcription)', () => {
    expect(
      statusMessage(
        {
          ...QUIET,
          callNotice: { kind: 'catching-up', text: 'Catching up', detail: 'Close busy apps.' },
        },
        false,
      ),
    ).toEqual({
      key: 'call-notice',
      text: 'Catching up',
      tone: 'muted',
      detail: 'Close busy apps.',
    });
  });

  it('ADR-0085: Private off during a call: an amber line with Turn on, after the call notices', () => {
    expect(statusMessage(QUIET, false, true)).toEqual({
      key: 'private-off-call',
      text: PRIVATE_OFF_CALL_TEXT,
      tone: 'warning',
      action: { kind: 'private', label: 'Turn on' },
    });
    // The recording warning comes first; a call notice too.
    expect(statusMessage({ ...QUIET, recording: undefined }, true, true)?.key).toBe('private-off');
    expect(
      statusMessage(
        {
          ...QUIET,
          callNotice: { kind: 'catching-up', text: 'Catching up', detail: 'Close busy apps.' },
        },
        false,
        true,
      )?.key,
    ).toBe('call-notice');
    // Not after the call ended; not with Private on.
    expect(statusMessage({ ...QUIET, ended: true }, false, true)).toBeNull();
    expect(statusMessage(QUIET, false, false)).toBeNull();
  });
});

describe('the rename offer (ADR-0093)', () => {
  it('offers "Rename Them to Sarah?" with Rename and Not now, after every warning', () => {
    const offer = statusMessage({ ...QUIET, themName: 'Them', nameOffer: 'Sarah' }, false);
    expect(offer).toMatchObject({
      key: 'rename-them',
      text: 'Rename Them to Sarah?',
      tone: 'offer',
      action: { kind: 'command', command: { type: 'rename-them', name: 'Sarah' }, label: 'Rename' },
      dismiss: { command: { type: 'dismiss-name' }, label: 'Not now' },
    });
    // Says the interview fallback when that is the label now.
    expect(
      statusMessage({ ...QUIET, themName: 'Interviewer', nameOffer: 'Sarah' }, false)?.text,
    ).toBe('Rename Interviewer to Sarah?');
    // A warning still comes first.
    expect(statusMessage({ ...QUIET, nameOffer: 'Sarah' }, true)?.key).toBe('private-off');
    expect(statusMessage({ ...QUIET, nameOffer: 'Sarah', ended: true }, false)).toBeNull();
  });
});

describe('Voice mode on the status line (ADR-0095)', () => {
  it('says the user is talking to Paramount AI, with Turn off', () => {
    const message = statusMessage({ ...QUIET, voiceMode: 'listening' }, false);
    expect(message?.key).toBe('voice-mode');
    expect(message?.text).toBe(VOICE_MODE_TEXT);
    expect(VOICE_MODE_TEXT).toBe(
      "Talking to Paramount AI — your words aren't sent to the interviewer transcript",
    );
    expect(message?.action).toEqual({
      kind: 'command',
      command: { type: 'voice-mode', on: false },
      label: 'Turn off',
    });
  });

  it('says when it is paused while they speak', () => {
    const message = statusMessage({ ...QUIET, voiceMode: 'paused' }, false);
    expect(message?.text).toBe(VOICE_PAUSED_TEXT);
    expect(message?.tone).toBe('muted');
  });

  it('says nothing when off, and gives way to a silent microphone', () => {
    expect(statusMessage({ ...QUIET, voiceMode: 'off' }, false)).toBeNull();
    const silent = statusMessage(
      {
        ...QUIET,
        voiceMode: 'listening',
        callNotice: { kind: 'mic-silent', text: 'x' } as CompactState['callNotice'],
      },
      false,
    );
    expect(silent?.key).toBe('mic-silent');
  });
});

describe('ADR-0101: where the voice shortcut works', () => {
  it('adds the browser hint to "Listening…", and nothing on the desktop app', () => {
    const base = { ...QUIET, dictating: true };
    expect(statusMessage(base, false)?.text).toBe(LISTENING_TEXT);
    const hint =
      'Voice shortcut works everywhere in the desktop app; in the browser, keep this tab in front.';
    expect(statusMessage({ ...base, voiceShortcutHint: hint }, false)?.text).toBe(
      `${LISTENING_TEXT} ${hint}`,
    );
  });
});
