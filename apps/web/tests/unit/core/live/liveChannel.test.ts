/**
 * Tests for apps/web/src/core/live/liveChannel.ts with a fake, in-memory BroadcastChannel: one
 * channel per session (kite-live-<id>); a state published by the live page reaches the compact
 * view; a command sent by the compact view reaches the live page; malformed states and commands
 * are dropped (an empty or over-long chat question, an unknown type); close() stops delivery.
 * Desktop 1.5.0 (ADR-0068): the recording commands in their shapes.
 * All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  firstWords,
  channelName,
  isCommand,
  isState,
  openLiveChannel,
  type ChannelPort,
  type CompactState,
} from '@/core/live/liveChannel';

/**
 * A fake BroadcastChannel network: ports with the same name hear each other (not themselves).
 *
 * @returns open(name) for openLiveChannel(), and the names opened.
 */
function fakeNetwork() {
  const ports: { name: string; port: ChannelPort }[] = [];
  const open = (name: string): ChannelPort => {
    const port: ChannelPort = {
      onmessage: null,
      postMessage(message) {
        for (const other of ports) {
          if (other.name === name && other.port !== port) {
            other.port.onmessage?.({ data: structuredClone(message) } as MessageEvent);
          }
        }
      },
      close() {
        const index = ports.findIndex((entry) => entry.port === port);
        if (index >= 0) ports.splice(index, 1);
      },
    };
    ports.push({ name, port });
    return port;
  };
  return { open, names: () => ports.map((entry) => entry.name) };
}

/** An invented state. */
const STATE: CompactState = {
  audio: { you: true, them: true },
  chips: [{ id: 'l1:0', speaker: 'them', text: 'What does it' }],
  liveQuestion: 'What does it cost?',
  index: 0,
  total: 1,
  answer: {
    id: 'a1',
    question: 'What does it cost?',
    text: '52 dollars per seat.\n- Billed yearly',
    headline: '52 dollars per seat.',
    claims: [],
    askedAt: 1,
    rating: null,
    reported: false,
    auto: false,
    status: 'done',
    mode: 'answer',
    error: null,
    unavailable: false,
  },
  answering: false,
  capturing: false,
  notice: null,
  ended: false,
};

describe('openLiveChannel', () => {
  it('carries states to the compact view and commands to the live page, per session', () => {
    const network = fakeNetwork();
    const live = openLiveChannel('s1', network.open);
    const compact = openLiveChannel('s1', network.open);
    const otherSession = openLiveChannel('s2', network.open);
    expect(network.names()).toEqual(['kite-live-s1', 'kite-live-s1', 'kite-live-s2']);
    const states = vi.fn();
    const commands = vi.fn();
    const strayStates = vi.fn();
    compact.onState(states);
    live.onCommand(commands);
    otherSession.onState(strayStates);

    live.publish(STATE);
    compact.send({ type: 'chat', question: 'Seat price?' });
    compact.send({ type: 'answer' });
    expect(states).toHaveBeenCalledWith(STATE);
    expect(commands.mock.calls).toEqual([
      [{ type: 'chat', question: 'Seat price?' }],
      [{ type: 'answer' }],
    ]);
    expect(strayStates).not.toHaveBeenCalled();

    compact.close();
    live.publish(STATE);
    expect(states).toHaveBeenCalledTimes(1);
  });

  it('drops malformed messages', () => {
    const network = fakeNetwork();
    const live = openLiveChannel('s1', network.open);
    const raw = network.open(channelName('s1'));
    const commands = vi.fn();
    live.onCommand(commands);
    raw.postMessage({ kind: 'command', command: { type: 'format-disk' } });
    raw.postMessage({ kind: 'command', command: { type: 'chat', question: '   ' } });
    raw.postMessage({ kind: 'command', command: { type: 'chat', question: 'x'.repeat(2_001) } });
    raw.postMessage('hello');
    raw.postMessage(null);
    expect(commands).not.toHaveBeenCalled();
  });
});

describe('isCommand and isState', () => {
  it('accepts answer preferences only with known values', () => {
    const style = { format: 'bullets', length: 'short', tone: 'technical' };
    expect(isCommand({ type: 'style', style })).toBe(true);
    expect(isCommand({ type: 'style', style: { ...style, tone: 'shouting' } })).toBe(false);
    expect(isCommand({ type: 'style' })).toBe(false);
  });

  it('ADR-0094: accepts a model switch only to an allowed tier', () => {
    expect(isCommand({ type: 'model', model: 'fast' })).toBe(true);
    expect(isCommand({ type: 'model', model: 'smart' })).toBe(true);
    // ADR-0095: Groq is a third choice; Voice mode and its tip are commands too.
    expect(isCommand({ type: 'model', model: 'groq' })).toBe(true);
    expect(isCommand({ type: 'model', model: 'gpt' })).toBe(false);
    expect(isCommand({ type: 'voice-mode', on: true })).toBe(true);
    expect(isCommand({ type: 'voice-mode', on: 'yes' })).toBe(false);
    expect(isCommand({ type: 'voice-tip-seen' })).toBe(true);
    // Never a model name: the server maps tiers to names.
    expect(isCommand({ type: 'model', model: 'claude-opus-5-5' })).toBe(false);
    expect(isCommand({ type: 'model' })).toBe(false);
  });

  it('ADR-0093: accepts the rename offer commands only with a name', () => {
    expect(isCommand({ type: 'rename-them', name: 'Sarah' })).toBe(true);
    expect(isCommand({ type: 'rename-them', name: '' })).toBe(false);
    expect(isCommand({ type: 'rename-them' })).toBe(false);
    expect(isCommand({ type: 'rename-them', name: 'x'.repeat(201) })).toBe(false);
    expect(isCommand({ type: 'dismiss-name' })).toBe(true);
  });

  it('accept only the known shapes', () => {
    for (const type of ['answer', 'screenshot', 'clear', 'prev', 'next', 'end', 'hello'])
      expect(isCommand({ type })).toBe(true);
    expect(isCommand({ type: 'rate', id: 'a1', rating: 'up' })).toBe(true);
    expect(isCommand({ type: 'rate', id: 'a1', rating: null })).toBe(true);
    expect(isCommand({ type: 'rate', id: 'a1', rating: 'great' })).toBe(false);
    expect(isCommand({ type: 'report', id: 'a1', note: 'Wrong price' })).toBe(true);
    expect(isCommand({ type: 'report', id: 'a1' })).toBe(false);
    expect(isCommand({ type: 'open-window' })).toBe(false);
    expect(isCommand({ type: 'chat', question: 'Price?' })).toBe(true);
    expect(isCommand({ type: 'chat' })).toBe(false);
    expect(isState(STATE)).toBe(true);
    expect(isState({ ...STATE, ended: 'yes' })).toBe(false);
    expect(isState({ ...STATE, chips: 'words' })).toBe(false);
  });
});

describe('isCommand: overlay commands', () => {
  it('accepts the call window, the script bar and dictation only in their shapes', () => {
    expect(isCommand({ type: 'call-window' })).toBe(true);
    expect(isCommand({ type: 'script-bar', on: true })).toBe(true);
    expect(isCommand({ type: 'script-bar' })).toBe(false);
    expect(isCommand({ type: 'dictate', on: false })).toBe(true);
    expect(isCommand({ type: 'dictate', on: 'yes' })).toBe(false);
  });

  it('rejects the commands v1.0.4 removed (the expanded overlay and its answer list)', () => {
    expect(isCommand({ type: 'latest' })).toBe(false);
    expect(isCommand({ type: 'show', id: 'a1' })).toBe(false);
    expect(isCommand({ type: 'answer-this', question: 'Price?', start: 1, end: 2 })).toBe(false);
  });
});

describe('the channel in v1.1.0 (ADR-0041)', () => {
  it('carries the level bars as their own small message', () => {
    const network = fakeNetwork();
    const live = openLiveChannel('s1', network.open);
    const compact = openLiveChannel('s1', network.open);
    const seen: unknown[] = [];
    compact.onLevels((levels) => seen.push(levels));
    live.publishLevels({ you: 0.5, them: 0.25 });
    expect(seen).toEqual([{ you: 0.5, them: 0.25 }]);
  });

  it('accepts the new commands in their shapes, and refuses others', () => {
    for (const command of [
      { type: 'stop' },
      { type: 'clear-transcript' },
      { type: 'still-here' },
      { type: 'resume' },
      { type: 'headphones-seen' },
      { type: 'answer-this', groupId: 'g1' },
      { type: 'language', code: 'en' },
      { type: 'auto-answer', on: true },
      { type: 'mic', deviceId: 'headset' },
    ]) {
      expect(isCommand(command), JSON.stringify(command)).toBe(true);
    }
    for (const command of [
      { type: 'answer-this' },
      { type: 'answer-this', groupId: 5 },
      { type: 'language' },
      { type: 'auto-answer', on: 'yes' },
      { type: 'mic', deviceId: 3 },
    ]) {
      expect(isCommand(command), JSON.stringify(command)).toBe(false);
    }
  });
});

describe('the recording commands (desktop 1.5.0, ADR-0068)', () => {
  it('accepts them in their shapes, and refuses others', () => {
    for (const command of [
      { type: 'record-start', displayId: null },
      { type: 'record-start', displayId: '2528732444' },
      { type: 'record-stop' },
      { type: 'record-kind', kind: 'audio' },
      { type: 'record-kind', kind: 'screen' },
      { type: 'record-notice-seen' },
      { type: 'record-prompt' },
    ]) {
      expect(isCommand(command), JSON.stringify(command)).toBe(true);
    }
    for (const command of [
      { type: 'record-start' },
      { type: 'record-start', displayId: 5 },
      { type: 'record-start', displayId: 'x'.repeat(65) },
      { type: 'record-kind', kind: 'video' },
      { type: 'record-kind' },
    ]) {
      expect(isCommand(command), JSON.stringify(command)).toBe(false);
    }
  });
});

describe('1.5.1 (ADR-0069): state messages at most every 200 ms', () => {
  it('sends the first state at once, the latest of a burst once, and the end at once', () => {
    vi.useFakeTimers();
    try {
      const network = fakeNetwork();
      const page = openLiveChannel('s1', network.open, 200);
      const overlay = openLiveChannel('s1', network.open, 200);
      const seen: number[] = [];
      overlay.onState((state) => seen.push(state.index));
      page.publish({ ...STATE, index: 1 });
      page.publish({ ...STATE, index: 2 });
      page.publish({ ...STATE, index: 3 });
      expect(seen).toEqual([1]);
      vi.advanceTimersByTime(200);
      expect(seen).toEqual([1, 3]);
      page.publish({ ...STATE, index: 4, ended: true });
      expect(seen).toEqual([1, 3, 4]);
      // A held state still goes out when the link closes.
      page.publish({ ...STATE, index: 5 });
      page.close();
      expect(seen).toEqual([1, 3, 4, 5]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Batch C (P1-2): an answer's first words reach the overlay at once", () => {
  it('sends the first words of an answer without waiting, later pieces at most every 200 ms', () => {
    vi.useFakeTimers();
    try {
      const network = fakeNetwork();
      const page = openLiveChannel('s1', network.open, 200);
      const overlay = openLiveChannel('s1', network.open, 200);
      const texts: string[] = [];
      overlay.onState((state) => texts.push(state.answer?.text ?? '-'));
      const answer = (text: string, id = 'a2') => ({
        ...STATE,
        answer: { ...STATE.answer!, id, text, headline: text, status: 'streaming' as const },
      });
      page.publish(answer(''));
      // 50 ms later the first words arrive: sent at once, not 150 ms later.
      vi.advanceTimersByTime(50);
      page.publish(answer('Hello'));
      expect(texts).toEqual(['', 'Hello']);
      // The next piece waits for the 200 ms.
      page.publish(answer('Hello there'));
      expect(texts).toEqual(['', 'Hello']);
      vi.advanceTimersByTime(200);
      expect(texts).toEqual(['', 'Hello', 'Hello there']);
      // A new answer's first words go at once too.
      page.publish(answer('', 'a3'));
      vi.advanceTimersByTime(10);
      page.publish(answer('Next', 'a3'));
      expect(texts.at(-1)).toBe('Next');
    } finally {
      vi.useRealTimers();
    }
  });

  it('firstWords() is true only for words the last state sent did not have', () => {
    const withText = { ...STATE, answer: { ...STATE.answer!, text: 'Hi' } };
    expect(firstWords(withText, null)).toBe(true);
    expect(firstWords(withText, { id: 'a1', hasText: false })).toBe(true);
    expect(firstWords(withText, { id: 'a1', hasText: true })).toBe(false);
    expect(firstWords({ ...STATE, answer: { ...STATE.answer!, text: ' ' } }, null)).toBe(false);
    expect(firstWords({ ...STATE, answer: null }, null)).toBe(false);
  });
});
