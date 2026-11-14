/**
 * Tests for apps/web/src/core/stt/deepgram.ts (ADR-0076): the listen URLs (Flux and Nova-3 parameters of
 * investigation C3, privacy flags, keyterms, the optional parameters dropped on request), the Flux and
 * Nova-3 message assembly on the capture clock (one clock: Deepgram's stream seconds become capture
 * times), and the socket wrapper (the token in the subprotocol, the stream start, catch-up for a press,
 * Finalize for Nova-3, the graceful close).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildListenUrl,
  DeepgramChannel,
  FLUX_FIRST_WORDS_LEAD_S,
  FluxAssembler,
  kindOf,
  NovaAssembler,
  type CloudEvent,
  type SocketLike,
} from '@/core/stt/deepgram';

/**
 * Stream seconds → Unix ms with the stream starting at 1,000,000 ms.
 *
 * @param seconds Stream seconds.
 * @returns Unix ms.
 */
const clock = (seconds: number) => Math.round(1_000_000 + seconds * 1000);

describe('buildListenUrl', () => {
  it('builds the Flux URL on /v2/listen with its turn thresholds', () => {
    const url = new URL(
      buildListenUrl({
        host: 'api.eu.deepgram.com',
        model: 'flux-general-en',
        language: 'en',
        keyterms: ['Northwind', 'BM25'],
        optional: true,
      }),
    );
    expect(url.protocol).toBe('wss:');
    expect(url.host).toBe('api.eu.deepgram.com');
    expect(url.pathname).toBe('/v2/listen');
    const params = url.searchParams;
    expect(params.get('model')).toBe('flux-general-en');
    expect(params.get('encoding')).toBe('linear16');
    expect(params.get('sample_rate')).toBe('16000');
    expect(params.get('eot_threshold')).toBe('0.7');
    expect(params.get('eager_eot_threshold')).toBe('0.5');
    expect(params.get('eot_timeout_ms')).toBe('5000');
    expect(params.get('mip_opt_out')).toBe('true');
    expect(params.get('redact_usage')).toBe('true');
    expect(params.getAll('keyterm')).toEqual(['Northwind', 'BM25']);
    // Nova-3 settings do not belong on Flux.
    expect(params.has('interim_results')).toBe(false);
  });

  it('builds the Nova-3 URL on /v1/listen with interim results, endpointing and VAD events', () => {
    const params = new URL(
      buildListenUrl({
        host: 'api.eu.deepgram.com',
        model: 'nova-3',
        language: 'en',
        keyterms: [],
        optional: true,
      }),
    ).searchParams;
    expect(params.get('language')).toBe('en');
    expect(params.get('channels')).toBe('1');
    expect(params.get('interim_results')).toBe('true');
    expect(params.get('smart_format')).toBe('true');
    expect(params.get('punctuate')).toBe('true');
    expect(params.get('endpointing')).toBe('300');
    expect(params.get('utterance_end_ms')).toBe('1000');
    expect(params.get('vad_events')).toBe('true');
    expect(params.get('mip_opt_out')).toBe('true');
  });

  it('uses Nova-3 multilingual for other languages, and leaves out the optional parameters on request', () => {
    const url = new URL(
      buildListenUrl({
        host: 'h.example.com',
        model: 'nova-3',
        language: 'multi',
        keyterms: ['Acme'],
        optional: false,
      }),
    );
    expect(url.searchParams.get('language')).toBe('multi');
    expect(url.searchParams.has('keyterm')).toBe(false);
    expect(url.searchParams.has('redact_usage')).toBe(false);
    // Opting out of model improvement is never optional.
    expect(url.searchParams.get('mip_opt_out')).toBe('true');
  });

  it('never puts a token in the URL', () => {
    const url = buildListenUrl({
      host: 'h.example.com',
      model: 'nova-3',
      language: 'en',
      keyterms: [],
      optional: true,
    });
    expect(url).not.toMatch(/token/i);
  });

  it('tells Flux models from Nova models', () => {
    expect(kindOf('flux-general-en')).toBe('flux');
    expect(kindOf('nova-3')).toBe('nova');
  });
});

describe('FluxAssembler (one clock)', () => {
  it('turns a turn into grey words, then a final line ended by the model, on the capture clock', () => {
    const flux = new FluxAssembler(clock);
    const events: CloudEvent[] = [];
    const take = (message: object) => events.push(...flux.handle(message));
    take({
      type: 'TurnInfo',
      event: 'StartOfTurn',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 1.2,
      transcript: '',
    });
    take({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 1.44,
      transcript: 'How would',
    });
    take({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 1.68,
      transcript: 'How would you scale it?',
    });
    // No new words: the line's end stays where its words last changed.
    take({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 1.92,
      transcript: 'How would you scale it?',
    });
    take({
      type: 'TurnInfo',
      event: 'EndOfTurn',
      turn_index: 0,
      audio_window_start: 1.0,
      audio_window_end: 2.2,
      transcript: 'How would you scale it?',
      end_of_turn_confidence: 0.82,
    });
    const partials = events.filter((event) => event.type === 'partial');
    // Batch D (P0-A): StartOfTurn at 1.2 s minus the 0.4 s lead is 0.8 s, before the window's start (1.0 s),
    // so the line starts at the window's start here.
    expect(partials).toEqual([
      {
        type: 'partial',
        text: 'How would',
        tStart: 1_001_000,
        tEnd: 1_001_440,
        audioFrom: 1_001_000,
      },
      {
        type: 'partial',
        text: 'How would you scale it?',
        tStart: 1_001_000,
        tEnd: 1_001_680,
        audioFrom: 1_001_000,
      },
    ]);
    expect(events.find((event) => event.type === 'final')).toEqual({
      type: 'final',
      text: 'How would you scale it?',
      tStart: 1_001_000,
      tEnd: 1_001_680,
      endOfTurn: true,
      startSource: 'start-of-turn',
    });
    expect(events.at(-1)).toEqual({ type: 'turn', event: 'end', confidence: 0.82, at: 1_002_200 });
    expect(flux.processedTo).toBe(2.2);
    expect(flux.idle()).toBe(true);
  });

  it('reports eager and resumed turn events, and is not idle mid-turn', () => {
    const flux = new FluxAssembler(clock);
    flux.handle({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 3,
      audio_window_start: 0,
      audio_window_end: 0.5,
      transcript: 'Tell me',
    });
    expect(flux.idle()).toBe(false);
    const eager = flux.handle({
      type: 'TurnInfo',
      event: 'EagerEndOfTurn',
      turn_index: 3,
      audio_window_start: 0,
      audio_window_end: 0.9,
      transcript: 'Tell me',
      end_of_turn_confidence: 0.55,
    });
    expect(eager).toContainEqual({ type: 'turn', event: 'eager', confidence: 0.55, at: 1_000_900 });
    const resumed = flux.handle({
      type: 'TurnInfo',
      event: 'TurnResumed',
      turn_index: 3,
      audio_window_start: 0,
      audio_window_end: 1.1,
      transcript: 'Tell me about',
    });
    expect(resumed[0]).toMatchObject({ type: 'turn', event: 'resumed' });
    expect(resumed[1]).toMatchObject({ type: 'partial', text: 'Tell me about' });
  });

  it('ignores other messages', () => {
    expect(new FluxAssembler(clock).handle({ type: 'Connected' })).toEqual([]);
  });
});

describe('Batch D (P0-A): a Flux line starts when the speaker started, not at the previous turn end', () => {
  /**
   * One Flux turn whose audio window opens at `windowStart` (where the previous turn ended) and whose first
   * words arrive with the window ending at `firstWordsAt`; the turn ends at `end`.
   *
   * @param flux          The assembler.
   * @param index         The turn index.
   * @param windowStart   audio_window_start, s.
   * @param firstWordsAt  audio_window_end of the first message with words, s.
   * @param end           Where the words last changed, s.
   * @param words         Optional per-word times for the first message.
   * @returns The final event.
   */
  function turn(
    flux: FluxAssembler,
    index: number,
    windowStart: number,
    firstWordsAt: number,
    end: number,
    words?: { word: string; start: number | string; end: number | string }[],
  ): CloudEvent | undefined {
    const events: CloudEvent[] = [];
    const message = (event: string, windowEnd: number, transcript: string, extra = {}) =>
      events.push(
        ...flux.handle({
          type: 'TurnInfo',
          event,
          turn_index: index,
          audio_window_start: windowStart,
          audio_window_end: windowEnd,
          transcript,
          ...extra,
        }),
      );
    // Silence while the other side talks: Updates with no words.
    message('Update', windowStart + 0.24, '');
    message('Update', firstWordsAt - 0.24, '');
    message('Update', firstWordsAt, 'Next', words ? { words } : {});
    message('Update', end, 'Next question please');
    message('EndOfTurn', end + 0.4, 'Next question please');
    return events.find((event) => event.type === 'final');
  }

  it('without word times: the first words minus the lead; the end stays where the words last changed', () => {
    const flux = new FluxAssembler(clock);
    const final = turn(flux, 1, 26.2, 35.6, 39.6);
    expect(final).toEqual({
      type: 'final',
      text: 'Next question please',
      tStart: clock(35.6 - FLUX_FIRST_WORDS_LEAD_S),
      tEnd: clock(39.6),
      endOfTurn: true,
      startSource: 'first-words',
    });
  });

  it('a StartOfTurn before the words is the earlier signal', () => {
    const flux = new FluxAssembler(clock);
    flux.handle({
      type: 'TurnInfo',
      event: 'StartOfTurn',
      turn_index: 2,
      audio_window_start: 10,
      audio_window_end: 20.0,
      transcript: '',
    });
    const events = flux.handle({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 2,
      audio_window_start: 10,
      audio_window_end: 20.48,
      transcript: 'So',
    });
    expect(events[0]).toMatchObject({
      type: 'partial',
      tStart: clock(20 - FLUX_FIRST_WORDS_LEAD_S),
    });
  });

  it('uses the first word’s own start when Flux sends word times (numbers or numeric strings)', () => {
    const flux = new FluxAssembler(clock);
    const final = turn(flux, 1, 26.2, '35.6' as unknown as number, 39.6, [
      { word: 'Next', start: '35.05', end: '35.4' },
    ]);
    expect(final).toMatchObject({
      tStart: clock(35.05),
      startSource: 'words',
      // The lead estimate (35.2 s) was 150 ms later than the word: recorded for the trace.
      wordLeadMs: 150,
    });
  });

  it('ignores word times outside the turn’s window (another time base)', () => {
    const flux = new FluxAssembler(clock);
    const final = turn(flux, 1, 26.2, 35.6, 39.6, [{ word: 'Next', start: 0.1, end: 0.4 }]);
    expect(final).toMatchObject({ startSource: 'first-words' });
  });

  it('never starts before the window', () => {
    const flux = new FluxAssembler(clock);
    const final = turn(flux, 0, 5.0, 5.1, 6.0);
    expect(final).toMatchObject({ tStart: clock(5.0) });
  });
});

describe('NovaAssembler (one clock)', () => {
  it('shows interim words, keeps final pieces, and ends the line at speech_final with word times', () => {
    const nova = new NovaAssembler(clock);
    const words = (start: number, end: number) => [{ start, end }];
    expect(
      nova.handle({
        type: 'Results',
        start: 0,
        duration: 1,
        is_final: false,
        channel: { alternatives: [{ transcript: 'I built', words: words(0.2, 0.7) }] },
      }),
    ).toEqual([{ type: 'partial', text: 'I built', tStart: 1_000_200, tEnd: 1_000_700 }]);
    nova.handle({
      type: 'Results',
      start: 0,
      duration: 1.2,
      is_final: true,
      channel: { alternatives: [{ transcript: 'I built a cache.', words: words(0.2, 1.1) }] },
    });
    const ended = nova.handle({
      type: 'Results',
      start: 1.2,
      duration: 0.8,
      is_final: true,
      speech_final: true,
      channel: { alternatives: [{ transcript: 'It worked.', words: words(1.3, 1.8) }] },
    });
    expect(ended).toEqual([
      {
        type: 'final',
        text: 'I built a cache. It worked.',
        tStart: 1_000_200,
        tEnd: 1_001_800,
        endOfTurn: false,
      },
    ]);
    expect(nova.processedTo).toBe(2);
    expect(nova.idle()).toBe(true);
  });

  it('ends the line at UtteranceEnd, and reports speech starting', () => {
    const nova = new NovaAssembler(clock);
    nova.handle({
      type: 'Results',
      start: 0,
      duration: 1,
      is_final: true,
      channel: { alternatives: [{ transcript: 'Sure.', words: [{ start: 0.1, end: 0.4 }] }] },
    });
    expect(nova.handle({ type: 'UtteranceEnd', last_word_end: 0.4 })).toEqual([
      { type: 'final', text: 'Sure.', tStart: 1_000_100, tEnd: 1_000_400, endOfTurn: false },
    ]);
    expect(nova.handle({ type: 'SpeechStarted', timestamp: 3.5 })).toEqual([
      { type: 'speech-started', at: 1_003_500 },
    ]);
  });
});

/** A fake WebSocket. */
class FakeSocket implements SocketLike {
  readyState = 0;
  bufferedAmount = 0;
  sent: (string | ArrayBuffer)[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close(code = 1000) {
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

/**
 * A channel on a fake socket.
 *
 * @param kind  'flux' or 'nova'.
 * @param extra Overrides.
 * @returns The channel, its socket and the events and closes it reported.
 */
function makeChannel(kind: 'flux' | 'nova', extra: { now?: () => number } = {}) {
  let socket!: FakeSocket;
  const events: CloudEvent[] = [];
  const closes: unknown[] = [];
  const channel = new DeepgramChannel({
    channel: 'them',
    url: 'wss://h.example.com/v2/listen?model=x',
    kind,
    token: 'short-token',
    // Unix ms − audio ms: audio second 100 is Unix 5,100,000.
    clockOffsetMs: () => 5_000_000,
    onEvent: (event) => events.push(event),
    onClose: (closed) => closes.push(closed),
    createSocket: (url, protocols) => (socket = new FakeSocket(url, protocols)),
    ...extra,
  });
  return { channel, socket, events, closes };
}

/**
 * 80 ms of 16-bit audio.
 *
 * @returns The buffer.
 */
const chunk = () => new ArrayBuffer(2_560);

afterEach(() => {
  vi.useRealTimers();
});

describe('DeepgramChannel', () => {
  it('sends the token as the bearer subprotocol, and maps stream times from the first chunk sent', async () => {
    const { channel, socket, events } = makeChannel('flux');
    expect(socket.protocols).toEqual(['bearer', 'short-token']);
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    // The first chunk ends at audio second 100.08, so the stream starts at 100.0 s = Unix 5,100,000.
    channel.send(chunk(), 100.08);
    channel.send(chunk(), 100.16);
    expect(socket.sent).toHaveLength(2);
    socket.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0.5,
      audio_window_end: 1,
      transcript: 'Hello there',
    });
    // Batch D (P0-A): the first words came with the window ending at 1.0 s: the line starts 0.4 s before.
    expect(events[0]).toEqual({
      type: 'partial',
      text: 'Hello there',
      tStart: 5_100_600,
      tEnd: 5_101_000,
      audioFrom: 5_100_500,
    });
    expect(channel.processedToUnix()).toBe(5_101_000);
  });

  it('fails open() when the socket closes first', async () => {
    const { channel, socket } = makeChannel('flux');
    const opened = channel.open(1_000);
    socket.close(1006);
    await expect(opened).rejects.toThrow();
  });

  it('Flux catch-up: waits until audio_window_end reaches the press, without sending anything', async () => {
    const now = vi.fn(() => 0);
    const { channel, socket } = makeChannel('flux', { now });
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    channel.send(chunk(), 100.08);
    socket.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0,
      audio_window_end: 1.0,
      transcript: 'What is',
    });
    // The press is at audio second 102 (Unix 5,102,000): not processed yet.
    const waiting = channel.catchUp(5_102_000, 300);
    now.mockReturnValue(120);
    socket.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0,
      audio_window_end: 1.95,
      transcript: 'What is your plan?',
    });
    await expect(waiting).resolves.toEqual({ waitedMs: 120, timedOut: false });
    expect(socket.sent).toHaveLength(1);
  });

  it('Nova-3 catch-up: sends Finalize and resolves when the flushed result arrives', async () => {
    const { channel, socket } = makeChannel('nova');
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    channel.send(chunk(), 100.08);
    const waiting = channel.catchUp(5_101_500, 300);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'Finalize' }));
    socket.receive({
      type: 'Results',
      start: 0.5,
      duration: 1.0,
      is_final: true,
      from_finalize: true,
      channel: { alternatives: [{ transcript: 'Done.', words: [{ start: 0.6, end: 1.4 }] }] },
    });
    await expect(waiting).resolves.toMatchObject({ timedOut: false });
  });

  it('catch-up gives up at the cap', async () => {
    vi.useFakeTimers();
    const { channel, socket } = makeChannel('flux');
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    channel.send(chunk(), 100.08);
    const waiting = channel.catchUp(5_200_000, 300);
    await vi.advanceTimersByTimeAsync(300);
    await expect(waiting).resolves.toMatchObject({ timedOut: true });
  });

  it('ends gracefully with CloseStream, and reports the close as expected', async () => {
    const { channel, socket, closes } = makeChannel('nova');
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    const finished = channel.finish(1_000);
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'CloseStream' }));
    socket.close(1000);
    await finished;
    expect(closes).toEqual([{ code: 1000, wasOpen: true, expected: true }]);
  });

  it('reports a dropped socket as unexpected, and passes no events while muted', async () => {
    const { channel, socket, events, closes } = makeChannel('flux');
    const opened = channel.open(1_000);
    socket.open();
    await opened;
    channel.muted = true;
    channel.send(chunk(), 100.08);
    socket.receive({
      type: 'TurnInfo',
      event: 'Update',
      turn_index: 0,
      audio_window_start: 0,
      audio_window_end: 1,
      transcript: 'Hi',
    });
    expect(events).toEqual([]);
    socket.close(1006);
    expect(closes).toEqual([{ code: 1006, wasOpen: true, expected: false }]);
  });
});

describe('Batch C (P1-3): keyterms mid-call with Flux Configure', () => {
  it('sends a Configure message with the new keyterms on an open Flux socket', () => {
    const { channel, socket } = makeChannel('flux');
    expect(channel.configure(['Kafka'])).toBe(false);
    socket.open();
    expect(channel.configure(['Kafka', 'Northwind'])).toBe(true);
    expect(socket.sent.at(-1)).toBe(
      JSON.stringify({ type: 'Configure', keyterms: ['Kafka', 'Northwind'] }),
    );
  });

  it('leaves Nova-3 sockets alone (their next connection uses the new list)', () => {
    const { channel, socket } = makeChannel('nova');
    socket.open();
    expect(channel.configure(['Kafka'])).toBe(false);
    expect(socket.sent).toHaveLength(0);
  });

  it('reports ConfigureSuccess and ConfigureFailure, and turns them into no transcript event', () => {
    const replies: [boolean, string | null][] = [];
    let socket!: FakeSocket;
    const events: CloudEvent[] = [];
    new DeepgramChannel({
      channel: 'them',
      url: 'wss://h.example.com/v2/listen?model=x',
      kind: 'flux',
      token: 't',
      clockOffsetMs: () => 0,
      onEvent: (event) => events.push(event),
      onClose: () => undefined,
      onConfigured: (ok, code) => replies.push([ok, code]),
      createSocket: (url, protocols) => (socket = new FakeSocket(url, protocols)),
    });
    socket.open();
    socket.receive({ type: 'ConfigureSuccess', keyterms: ['Kafka'] });
    socket.receive({ type: 'ConfigureFailure', code: 'CONFIGURE_INVALID' });
    expect(replies).toEqual([
      [true, null],
      [false, 'CONFIGURE_INVALID'],
    ]);
    expect(events).toEqual([]);
  });
});
