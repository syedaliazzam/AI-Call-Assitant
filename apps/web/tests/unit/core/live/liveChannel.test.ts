/**
 * Tests for apps/web/src/core/live/liveChannel.ts with a fake, in-memory BroadcastChannel: one
 * channel per session (kite-live-<id>); a state published by the live page reaches the compact
 * view; a command sent by the compact view reaches the live page; malformed states and commands
 * are dropped (an empty or over-long chat question, an unknown type); close() stops delivery.
 * All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import {
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
  lines: [{ id: 'l1', speaker: 'them', text: 'What does it cost', final: true }],
  index: 0,
  total: 1,
  answer: {
    id: 'a1',
    question: 'What does it cost?',
    headline: '52 dollars per seat.',
    bullets: ['Billed yearly'],
    tip: '',
    note: '',
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
