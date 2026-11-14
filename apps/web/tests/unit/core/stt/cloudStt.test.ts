/**
 * Tests for apps/web/src/core/stt/cloudStt.ts (ADR-0076, investigation C1/C9): sockets open at attach with
 * one token for both channels; chunks go to the channel's socket; a dropped socket, a stall, a failed token
 * or going offline moves that channel alone to the on-device engine, with the audio Deepgram had not finished
 * replayed from the 10 s store on the call's one clock; a background probe takes the channel back after 30 s
 * healthy at a pause; a press waits for "processed up to" (or the on-device engine's drain); and a handshake
 * refused with the optional parameters is retried without them.
 */
import type { SttTokenResponse } from '@kite/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FromAudioWorker } from '@/core/stt/audioProtocol';
import { createCloudStt, type CloudSttDeps, type CloudSttHandlers } from '@/core/stt/cloudStt';
import type { CloudEvent, SocketLike } from '@/core/stt/deepgram';
import { HEALTHY_MS } from '@/core/stt/failover';
import type { ChannelId } from '@/core/stt/protocol';
import { SttTokenError } from '@/core/stt/sttToken';

/** A fake WebSocket that the test opens, feeds and closes. */
class FakeSocket implements SocketLike {
  readyState = 0;
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  /** Opens it. */
  open() {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  /**
   * Receives a message.
   *
   * @param message The parsed message to deliver.
   */
  receive(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

/** The token reply. */
const TOKEN: SttTokenResponse = {
  token: 'short-token',
  expiresIn: 60,
  host: 'api.eu.deepgram.com',
  models: { them: 'flux-general-en', you: 'nova-3' },
};

/**
 * Everything one test needs.
 *
 * @param options.token    The token fetcher (default: a good reply).
 * @param options.autoOpen False to open sockets by hand.
 * @returns The object under test and its fakes.
 */
function setup(options: { token?: () => Promise<SttTokenResponse>; autoOpen?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  let clock = 1_700_000_000_000;
  let worker!: {
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent<FromAudioWorker>) => void) | null;
  };
  let offline: (() => void) | null = null;
  const local = {
    accept: vi.fn(),
    detach: vi.fn(),
    drain: vi.fn(async () => undefined),
    setClock: vi.fn(),
  };
  const events: [ChannelId, CloudEvent][] = [];
  const engines: [ChannelId, string, string][] = [];
  const gaps: [ChannelId, number, number][] = [];
  // Batch D: the trace events (codes, counts and times only).
  const traces: [string, Record<string, unknown>][] = [];
  const handlers: CloudSttHandlers = {
    onTrace: (kind, fields) => traces.push([kind, fields]),
    onEvent: (channel, event) => events.push([channel, event]),
    onEngine: (channel, engine, reason) => engines.push([channel, engine, reason]),
    onGap: (channel, from, to) => gaps.push([channel, from, to]),
  };
  let idle = true;
  const fetchToken = vi.fn(options.token ?? (async () => TOKEN));
  const deps: Partial<CloudSttDeps> = {
    fetchToken,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      // Open on the next microtask, as a real handshake would (later), unless the test drives it.
      if (options.autoOpen !== false) queueMicrotask(() => socket.open());
      return socket;
    },
    createAudioWorker: () => {
      worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null };
      return worker as unknown as ReturnType<CloudSttDeps['createAudioWorker']>;
    },
    createAudioContext: () =>
      ({
        state: 'running',
        audioWorklet: { addModule: async () => undefined },
        createMediaStreamSource: () => ({ connect: () => undefined, disconnect: () => undefined }),
        resume: async () => undefined,
        close: async () => undefined,
      }) as unknown as AudioContext,
    createWorkletNode: () =>
      ({
        port: { postMessage: () => undefined, close: () => undefined },
        disconnect: () => undefined,
      }) as unknown as AudioWorkletNode,
    origin: 'https://kite.test',
    now: () => clock,
    online: () => true,
    watchOffline: (callback) => {
      offline = callback;
      return () => undefined;
    },
  };
  const cloud = createCloudStt({
    local: () => local,
    language: 'en',
    keyterms: ['Northwind'],
    localIdle: () => idle,
    handlers,
    deps,
  });
  /**
   * One 80 ms chunk of a channel arriving from the audio worker.
   *
   * @param channel Which channel.
   * @param endTime Its end on the audio clock, s.
   * @returns Nothing.
   */
  const chunk = (channel: ChannelId, endTime: number) =>
    worker.onmessage?.({
      data: {
        type: 'chunk',
        channel,
        pcm: new ArrayBuffer(2_560),
        samples: new Float32Array(1_280),
        endTime,
        // Unix ms − audio ms.
        offsetMs: 1_700_000_000_000 - 100_000,
      },
    } as MessageEvent<FromAudioWorker>);
  return {
    cloud,
    sockets,
    local,
    events,
    engines,
    gaps,
    traces,
    fetchToken,
    chunk,
    advance: (ms: number) => {
      clock += ms;
    },
    goOffline: () => offline?.(),
    setIdle: (value: boolean) => {
      idle = value;
    },
  };
}

/**
 * Lets the background socket opening (token, handshake) finish.
 *
 * @returns Resolves after a few turns of the microtask queue.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** A stream stand-in (the fake AudioContext never reads it). */
const stream = {} as MediaStream;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cloud transcription', () => {
  it('opens one socket per channel with one token, Flux for Them and Nova-3 for You, and sends chunks', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await t.cloud.attach('you', stream);
    await flush();
    expect(t.fetchToken).toHaveBeenCalledTimes(1);
    expect(t.sockets.map((socket) => new URL(socket.url).pathname)).toEqual([
      '/v2/listen',
      '/v1/listen',
    ]);
    expect(new URL(t.sockets[0]!.url).searchParams.getAll('keyterm')).toEqual(['Northwind']);
    expect(t.engines).toEqual([
      ['them', 'deepgram', 'start'],
      ['you', 'deepgram', 'start'],
    ]);
    t.chunk('them', 100.08);
    t.chunk('you', 100.08);
    expect(t.sockets[0]!.sent).toHaveLength(1);
    expect(t.sockets[1]!.sent).toHaveLength(1);
    expect(t.local.accept).not.toHaveBeenCalled();
    // Events carry capture times: stream start 100.0 s = Unix 1,700,000,000,000.
    t.sockets[0]!.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0.2,
      audio_window_end: 0.5,
      transcript: 'Hi',
    });
    // Batch D (P0-A): 0.5 s minus the 0.4 s lead is before the window (0.2 s): the line starts at 0.2 s.
    expect(t.events).toEqual([
      [
        'them',
        {
          type: 'partial',
          text: 'Hi',
          tStart: 1_700_000_000_200,
          tEnd: 1_700_000_000_500,
          audioFrom: 1_700_000_000_200,
        },
      ],
    ]);
    // Batch D: the trace says each socket opened with the optional parameters and how many keyterms.
    expect(t.traces.filter(([kind]) => kind === 'socket-open').map(([, fields]) => fields)).toEqual(
      [
        expect.objectContaining({ channel: 'them', optional: true, kind: 'flux', terms: 1 }),
        expect.objectContaining({ channel: 'you', optional: true, kind: 'nova', terms: 1 }),
      ],
    );
    // Batch D (P0-A): a Flux final line records where its start came from (no words in the trace).
    t.sockets[0]!.receive({
      type: 'TurnInfo',
      event: 'EndOfTurn',
      turn_index: 0,
      audio_window_start: 0.2,
      audio_window_end: 0.9,
      transcript: 'Hi there',
    });
    expect(t.traces.find(([kind]) => kind === 'flux-start')).toEqual([
      'flux-start',
      { channel: 'them', source: 'first-words' },
    ]);
    t.cloud.stop();
  });

  it('Connect does not wait for Deepgram: audio until the socket opens is sent first, on its clock', async () => {
    const t = setup({ autoOpen: false });
    await t.cloud.attach('them', stream);
    t.chunk('them', 100.08);
    t.chunk('them', 100.16);
    await vi.waitFor(() => expect(t.sockets).toHaveLength(1));
    t.sockets[0]!.open();
    await flush();
    expect(t.sockets[0]!.sent).toHaveLength(2);
    expect(t.engines).toEqual([['them', 'deepgram', 'start']]);
    // The stream starts with the first chunk kept (audio 100.0 s = Unix 1,700,000,000,000).
    t.sockets[0]!.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0.04,
      audio_window_end: 0.16,
      transcript: 'Hi',
    });
    expect(t.events[0]?.[1]).toMatchObject({ tStart: 1_700_000_000_040 });
    t.cloud.stop();
  });

  it('a dropped socket moves that channel alone to the on-device engine, replaying from the open line', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await t.cloud.attach('you', stream);
    await flush();
    for (let i = 1; i <= 25; i += 1) t.chunk('them', 100 + i * 0.08);
    // Deepgram had a grey line from 1.0 s into the stream: audio 101.0 s (the stream started at 100.08 − 0.08).
    t.sockets[0]!.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 1.5,
      transcript: 'What is',
    });
    t.sockets[0]!.close(1006);
    expect(t.engines.at(-1)).toEqual(['them', 'local', 'closed']);
    expect(t.cloud.engineOf('them')).toBe('local');
    expect(t.cloud.engineOf('you')).toBe('deepgram');
    // The cloud grey line is dropped; the on-device engine gets the clock, then the audio from it on.
    expect(t.events.at(-1)?.[1]).toMatchObject({ type: 'partial', text: '' });
    expect(t.local.setClock).toHaveBeenCalledWith(1_700_000_000_000 - 100_000);
    const replayed = t.local.accept.mock.calls;
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.every((call) => call[0] === 'them' && call[3] === true)).toBe(true);
    // From the chunk holding the line's start (audio 101.0 s) on, nothing earlier.
    const firstEnd = Math.min(...replayed.map((call) => call[2] as number));
    expect(firstEnd).toBeGreaterThan(101.0);
    expect(firstEnd).toBeLessThanOrEqual(101.08);
    // New chunks go to the on-device engine now.
    t.chunk('them', 102.08);
    expect(t.local.accept.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'them',
      expect.any(Float32Array),
    ]);
    expect(t.gaps).toEqual([]);
    t.cloud.stop();
  });

  it('a failed token starts both channels on the on-device engine (Connect still works)', async () => {
    const t = setup({
      token: async () => {
        throw new SttTokenError('upstream_error', 'refused');
      },
    });
    await t.cloud.attach('them', stream);
    await t.cloud.attach('you', stream);
    await flush();
    expect(t.engines).toEqual([
      ['them', 'local', 'token'],
      ['you', 'local', 'token'],
    ]);
    t.chunk('you', 100.08);
    expect(t.local.accept).toHaveBeenCalledWith('you', expect.any(Float32Array), 100.08);
    t.cloud.stop();
  });

  it('a stall (speech, no message for 3 s) and going offline both fail over', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await t.cloud.attach('you', stream);
    await flush();
    t.cloud.sound('them');
    t.advance(3_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.engines).toContainEqual(['them', 'local', 'stalled']);
    t.goOffline();
    expect(t.engines).toContainEqual(['you', 'local', 'offline']);
    t.cloud.stop();
  });

  it('retries in the background and switches back after 30 s healthy, only at a pause', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await flush();
    t.chunk('them', 100.08);
    t.sockets[0]!.close(1006);
    expect(t.cloud.engineOf('them')).toBe('local');
    // The first retry is due after 1 s.
    t.advance(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sockets).toHaveLength(2);
    // Still on the on-device engine while the probe proves itself; its chunks go to both.
    t.chunk('them', 100.16);
    expect(t.sockets[1]!.sent).toHaveLength(1);
    expect(t.local.accept.mock.calls.at(-1)?.[2]).toBe(100.16);
    // Its words are not shown meanwhile.
    t.sockets[1]!.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0,
      audio_window_end: 0.5,
      transcript: 'muted words',
    });
    expect(
      t.events.some(([, event]) => event.type === 'partial' && event.text === 'muted words'),
    ).toBe(false);
    t.sockets[1]!.receive({
      type: 'TurnInfo',
      event: 'EndOfTurn',
      turn_index: 0,
      audio_window_start: 0,
      audio_window_end: 0.9,
      transcript: 'muted words',
    });
    // Healthy long enough, but the on-device engine is mid-line: not yet.
    t.setIdle(false);
    t.advance(HEALTHY_MS);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.cloud.engineOf('them')).toBe('local');
    t.setIdle(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.cloud.engineOf('them')).toBe('deepgram');
    expect(t.engines.at(-1)).toEqual(['them', 'deepgram', 'recovered']);
    expect(t.local.detach).toHaveBeenCalledWith('them');
    t.cloud.stop();
  });

  it('a press waits for "processed up to" on Deepgram, but not when the channel was quiet', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await flush();
    t.chunk('them', 100.08);
    // Quiet and between turns: nothing to wait for.
    await expect(t.cloud.catchUp('them', 1_700_000_002_000, 300)).resolves.toEqual({
      waitedMs: 0,
      timedOut: false,
    });
    t.cloud.sound('them');
    const waiting = t.cloud.catchUp('them', 1_700_000_002_000, 300);
    t.sockets[0]!.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 1,
      audio_window_end: 1.95,
      transcript: 'And why?',
    });
    await expect(waiting).resolves.toMatchObject({ timedOut: false });
    t.cloud.stop();
  });

  it('a press on the on-device fallback waits for its worker to finish what it was given', async () => {
    const t = setup({
      token: async () => {
        throw new SttTokenError('network', 'offline');
      },
    });
    await t.cloud.attach('them', stream);
    await flush();
    await t.cloud.catchUp('them', 1_700_000_002_000, 300);
    expect(t.local.drain).toHaveBeenCalledWith(300);
    t.cloud.stop();
  });

  it('a handshake refused with the optional parameters is tried again without them', async () => {
    const t = setup({ autoOpen: false });
    const attaching = t.cloud.attach('them', stream);
    await vi.waitFor(() => expect(t.sockets).toHaveLength(1));
    t.sockets[0]!.close(1006);
    await vi.waitFor(() => expect(t.sockets).toHaveLength(2));
    t.sockets[1]!.open();
    await attaching;
    await flush();
    expect(new URL(t.sockets[0]!.url).searchParams.has('keyterm')).toBe(true);
    expect(new URL(t.sockets[1]!.url).searchParams.has('keyterm')).toBe(false);
    expect(new URL(t.sockets[1]!.url).searchParams.get('mip_opt_out')).toBe('true');
    expect(t.cloud.engineOf('them')).toBe('deepgram');
    t.cloud.stop();
  });

  it('End: detach ends each socket with CloseStream, and drain waits for them and the fallback', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await flush();
    t.chunk('them', 100.08);
    t.cloud.detach('them');
    expect(t.sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ type: 'CloseStream' }));
    t.sockets[0]!.close(1000);
    await t.cloud.drain(1_000);
    expect(t.local.drain).toHaveBeenCalled();
    // An expected close is not a failover.
    expect(t.engines).toEqual([['them', 'deepgram', 'start']]);
    t.cloud.stop();
  });
});

describe('Batch C (P1-3): keyterms changed during the call', () => {
  it('sends Configure on the Flux socket at once, and opens later sockets with the new list', async () => {
    const t = setup();
    await t.cloud.attach('them', stream);
    await t.cloud.attach('you', stream);
    await flush();
    const them = t.sockets[0]!;
    const you = t.sockets[1]!;
    t.cloud.setKeyterms(['Northwind', 'Kafka']);
    expect(them.sent.at(-1)).toBe(
      JSON.stringify({ type: 'Configure', keyterms: ['Northwind', 'Kafka'] }),
    );
    // Nova-3 ("You") is not reconnected: nothing is sent to it.
    expect(you.sent.filter((data) => typeof data === 'string')).toEqual([]);
    // The same list again sends nothing more.
    const count = them.sent.length;
    t.cloud.setKeyterms(['Northwind', 'Kafka']);
    expect(them.sent).toHaveLength(count);
    // A reconnect (after a lost socket) opens with the new list.
    you.close(1006);
    t.advance(1_500);
    vi.advanceTimersByTime(1_500);
    await flush();
    const reopened = t.sockets.at(-1)!;
    expect(reopened).not.toBe(you);
    expect(new URL(reopened.url).searchParams.getAll('keyterm')).toEqual(['Northwind', 'Kafka']);
  });
});
