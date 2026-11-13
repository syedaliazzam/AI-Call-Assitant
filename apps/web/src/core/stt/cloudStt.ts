/**
 * File: apps/web/src/core/stt/cloudStt.ts
 * Purpose: Cloud transcription for one call (ADR-0076): both channels stream from the device straight to
 *          Deepgram (Flux for "Them", Nova-3 for "You", per the server's settings), each over its own
 *          WebSocket, with the on-device engine as a per-channel fallback.
 *          - Audio: one 16 kHz AudioContext; each channel's 80 ms worklet chunks go to the audio worker
 *            (AEC3 + coupling gate on "You", one capture clock), then here, then to that channel's socket.
 *            The last 10 s of each channel are kept (ringBuffer.ts).
 *          - Sockets open at Connect (attach), with a token from /api/stt/token; never at a key press.
 *          - Failover (failover.ts): a channel whose socket closes, stalls or falls behind, or that cannot
 *            get a token, or any channel while offline, moves to the on-device engine (loaded and idle since
 *            the page opened); the audio Deepgram had not finished is replayed into it from the 10 s store.
 *            Deepgram is retried in the background and takes the channel back after 30 s healthy, at a
 *            pause.
 *          - Key press (catchUp): waits until the channel is processed up to the press, at most the cap.
 *          It implements attach/detach/drain, so core/audio/capture.ts and endCall.ts use it like the
 *          on-device engine. Text and audio are never logged; the trace gets codes and times only.
 * Used by: src/features/live/LivePage.tsx; tests/unit/core/stt/cloudStt.test.ts
 * Depends on: src/core/stt (deepgram.ts, failover.ts, ringBuffer.ts, sttToken.ts, audioProtocol.ts,
 *             audio.worker.ts, models.ts aecDownloads, sttEngine.ts types), src/core/audio/resampler.worklet.ts
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1–C9; ADR-0076
 */
import type { SttTokenResponse } from '@kite/shared';
import { TARGET_SAMPLE_RATE } from '../audio/resample';
import {
  CLOUD_CHUNK_SAMPLES,
  CLOUD_WORKLET_NAME,
  workletModuleUrl,
} from '../audio/resampler.worklet';
import { toLinear16 } from './audioCleaner';
import type { FromAudioWorker, ToAudioWorker } from './audioProtocol';
import {
  buildListenUrl,
  DeepgramChannel,
  kindOf,
  type CatchUp,
  type CloudEvent,
  type SocketLike,
} from './deepgram';
import {
  ChannelFailover,
  MAX_BUFFERED_MS,
  type ChannelEngine,
  type FailoverReason,
} from './failover';
import { aecDownloads } from './models';
import type { ChannelId } from './protocol';
import { RingBuffer } from './ringBuffer';
import type { SttEngine } from './sttEngine';
import { fetchSttToken, SttTokenError } from './sttToken';

/** Longest wait for a socket to open, ms (measured 0.22–0.93 s from Pakistan). */
export const OPEN_TIMEOUT_MS = 5_000;

/** A token is reused for both channels' handshakes for this long, ms (it lives 60 s). */
export const TOKEN_REUSE_MS = 30_000;

/** How long End waits for each socket's last words, ms. */
export const FINISH_TIMEOUT_MS = 1_000;

/** How often the failover rules are checked, ms. */
export const TICK_MS = 1_000;

/** How often the capture clock goes into the trace (drift), ms. */
export const CLOCK_TRACE_MS = 10_000;

/** A press waits for a channel only if it had sound within this long before the press, ms. */
export const RECENT_SOUND_MS = 1_500;

/** A trace field: numbers, short codes and flags only (never words). */
export type TraceValue = number | string | boolean | null;

/** What the call's page learns from cloud transcription. */
export interface CloudSttHandlers {
  /** A transcript event of a channel on Deepgram (on-device lines come through that engine's own callbacks). */
  onEvent: (channel: ChannelId, event: CloudEvent) => void;
  /** A channel changed engine ('start': its first socket opened). */
  onEngine: (
    channel: ChannelId,
    engine: ChannelEngine,
    reason: FailoverReason | 'start' | 'recovered',
  ) => void;
  /** Audio of a channel was lost (Unix ms span): the transcript shows a gap. */
  onGap: (channel: ChannelId, fromUnix: number, toUnix: number) => void;
  /** The echo canceller's state ('on', 'off' or 'failed'). */
  onEcho?: (state: 'on' | 'off' | 'failed') => void;
  /** A trace event (codes and times only). */
  onTrace?: (kind: string, fields: Record<string, TraceValue>) => void;
}

/** The browser objects and server calls cloud transcription uses (tests replace them). */
export interface CloudSttDeps {
  /** Asks /api/stt/token for a token. */
  fetchToken: () => Promise<SttTokenResponse>;
  /** Creates a socket (default: the browser's WebSocket). */
  createSocket?: (url: string, protocols: string[]) => SocketLike;
  /** Creates the audio worker. */
  createAudioWorker: () => Pick<Worker, 'postMessage' | 'terminate'> & {
    onmessage: ((event: MessageEvent<FromAudioWorker>) => void) | null;
  };
  /** Creates the 16 kHz AudioContext. */
  createAudioContext: () => AudioContext;
  /** Creates a channel's worklet node in that context. */
  createWorkletNode: (context: AudioContext) => AudioWorkletNode;
  /** The page's origin (for the echo canceller's files). */
  origin: string;
  /** Unix ms. */
  now: () => number;
  /** Whether the device is online. */
  online: () => boolean;
  /** Listens for the browser's offline event; returns a function that stops listening. */
  watchOffline: (onOffline: () => void) => () => void;
}

/**
 * The real browser objects.
 *
 * @returns Default dependencies.
 * Called from: createCloudStt() (default argument)
 */
export function defaultCloudSttDeps(): CloudSttDeps {
  return {
    fetchToken: () => fetchSttToken(),
    // Classic worker: the echo canceller's loader needs importScripts.
    createAudioWorker: () => new Worker(new URL('./audio.worker.ts', import.meta.url)),
    createAudioContext: () => {
      try {
        return new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      } catch {
        return new AudioContext();
      }
    },
    createWorkletNode: (context) =>
      new AudioWorkletNode(context, CLOUD_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      }),
    // Read safely: the defaults are built even where a test passes its own (no window there).
    origin: globalThis.location?.origin ?? '',
    now: () => Date.now(),
    online: () => globalThis.navigator?.onLine ?? true,
    watchOffline: (onOffline) => {
      if (typeof window === 'undefined') return () => undefined;
      window.addEventListener('offline', onOffline);
      return () => window.removeEventListener('offline', onOffline);
    },
  };
}

/** Options for createCloudStt(). */
export interface CloudSttOptions {
  /** The on-device engine (loaded and idle; replaced after a restart, so read each time). */
  local: () => Pick<SttEngine, 'accept' | 'detach' | 'drain' | 'setClock'> | null;
  /** 'en' for English sessions; 'multi' sends both channels to Nova-3 multilingual. */
  language: 'en' | 'multi';
  /** The session's keyterms (the same list on both channels). Never logged. */
  keyterms: readonly string[];
  /** Whether the on-device engine has no line in progress on a channel (a pause, for the switch back). */
  localIdle: (channel: ChannelId) => boolean;
  /** Callbacks. */
  handlers: CloudSttHandlers;
  /** Browser objects (tests only). */
  deps?: Partial<CloudSttDeps>;
}

/** Cloud transcription for one call. */
export interface CloudStt {
  /**
   * Starts (or swaps the stream of) a channel. The first time it also starts opening the channel's socket in
   * the background (never waited for, never rejects for Deepgram): audio until it opens is sent first.
   */
  attach(channel: ChannelId, stream: MediaStream): Promise<void>;
  /** Stops a channel (its socket ends gracefully). */
  detach(channel: ChannelId): void;
  /** Resolves once the sockets have sent their last words and the on-device engine is idle. */
  drain(timeoutMs?: number): Promise<void>;
  /**
   * Waits until a channel is processed up to a moment (a key press), at most capMs.
   *
   * @param channel Which channel.
   * @param atUnix  The moment (Unix ms).
   * @param capMs   Longest wait.
   */
  catchUp(channel: ChannelId, atUnix: number, capMs: number): Promise<CatchUp>;
  /** Which engine a channel uses now. */
  engineOf(channel: ChannelId): ChannelEngine;
  /** A channel's level showed speech (from the capture's meters). */
  sound(channel: ChannelId): void;
  /** Stops everything. Cannot be used afterwards. */
  stop(): void;
}

/** One channel's state. */
interface ChannelState {
  /** The stream's audio graph, or null. */
  graph: {
    /** The stream's source node. */
    source: MediaStreamAudioSourceNode;
    /** The 80 ms worklet. */
    node: AudioWorkletNode;
  } | null;
  /** Whether the capture wants this channel now. */
  attached: boolean;
  /** The socket: the active one on Deepgram, or the probe while on the on-device engine. */
  socket: DeepgramChannel | null;
  /** True while a socket is being opened (no second one is started). */
  opening: boolean;
  /** The failover rules. */
  failover: ChannelFailover;
  /** The last 10 s of cleaned audio. */
  ring: RingBuffer;
  /** When this channel last had sound (Unix ms), or null. */
  lastSoundAt: number | null;
  /** Start (Unix ms) of the Deepgram line being spoken now, or null between lines. */
  openSince: number | null;
  /** The worst socket backlog in the current second, ms of audio. */
  bufferedMax: number;
  /** Whether the optional URL parameters were refused once (then left out). */
  noOptional: boolean;
  /**
   * Where this attach's audio starts (audio clock, s), or null before its first chunk. A socket that opens
   * later is sent everything from here first, so nothing said while it opened is lost.
   */
  attachedFrom: number | null;
}

/**
 * Creates cloud transcription for a call. Nothing opens until attach().
 *
 * @param options See CloudSttOptions.
 * @returns The running object.
 * Called from: LivePage.tsx (Connect, for accounts with cloud transcription)
 */
export function createCloudStt(options: CloudSttOptions): CloudStt {
  const deps: CloudSttDeps = { ...defaultCloudSttDeps(), ...options.deps } as CloudSttDeps;
  const { handlers } = options;
  const trace = (kind: string, fields: Record<string, TraceValue>) =>
    handlers.onTrace?.(kind, fields);
  const channels: Record<ChannelId, ChannelState> = {
    you: newState(),
    them: newState(),
  };
  let stopped = false;
  let context: AudioContext | null = null;
  let workletReady: Promise<void> | null = null;
  let worker: ReturnType<CloudSttDeps['createAudioWorker']> | null = null;
  /** The capture clock: Unix ms − audio ms (from the latest chunk), or null before any audio. */
  let clockOffset: number | null = null;
  let lastClockTraceAt = 0;
  /** When the on-device engine was last given the capture clock (Unix ms). */
  let lastLocalClockAt = 0;
  let echoState: string | null = null;
  /** The token in use and when it was fetched. */
  let token: { value: Promise<SttTokenResponse>; at: number } | null = null;
  /** Sockets ending gracefully (End waits for them). */
  const finishing = new Set<Promise<void>>();

  /**
   * A fresh channel state.
   *
   * @returns The state.
   */
  function newState(): ChannelState {
    return {
      graph: null,
      attached: false,
      socket: null,
      opening: false,
      failover: new ChannelFailover(),
      ring: new RingBuffer(),
      lastSoundAt: null,
      openSince: null,
      bufferedMax: 0,
      noOptional: false,
      attachedFrom: null,
    };
  }

  /**
   * A token, reused for TOKEN_REUSE_MS (both channels' handshakes at Connect share one).
   *
   * @returns The token reply.
   */
  const getToken = (): Promise<SttTokenResponse> => {
    const now = deps.now();
    if (!token || now - token.at > TOKEN_REUSE_MS) {
      const startedAt = now;
      const value = deps.fetchToken();
      token = { value, at: now };
      value.then(
        () => trace('token', { ok: true, ms: deps.now() - startedAt }),
        (error: unknown) => {
          token = null;
          trace('token', {
            ok: false,
            ms: deps.now() - startedAt,
            code: error instanceof SttTokenError ? error.code : 'network',
          });
        },
      );
    }
    return token.value;
  };

  /**
   * Unix ms → audio-clock seconds on the call's capture clock.
   *
   * @param unix Unix ms.
   * @returns Audio seconds (NaN before any audio).
   */
  const toAudio = (unix: number): number =>
    clockOffset === null ? Number.NaN : (unix - clockOffset) / 1000;

  /**
   * Opens a socket for a channel (with the optional parameters, then once more without them if the first
   * handshake failed).
   *
   * @param channel Which channel.
   * @returns The open socket.
   * @throws SttTokenError (no token) or Error (no socket opened).
   */
  async function openSocket(channel: ChannelId): Promise<DeepgramChannel> {
    const state = channels[channel];
    const reply = await getToken();
    // Non-English sessions: Nova-3 multilingual on both channels (Flux is English only).
    const model =
      channel === 'them' && options.language === 'en' ? reply.models.them : reply.models.you;
    const kind = kindOf(model);
    const attempts = state.noOptional ? [false] : [true, false];
    for (const optional of attempts) {
      const startedAt = deps.now();
      const url = buildListenUrl({
        host: reply.host,
        model,
        language: kind === 'flux' ? 'en' : options.language,
        keyterms: options.keyterms,
        optional,
      });
      const socket: DeepgramChannel = new DeepgramChannel({
        channel,
        url,
        kind,
        token: reply.token,
        clockOffsetMs: () => clockOffset ?? 0,
        now: deps.now,
        ...(deps.createSocket ? { createSocket: deps.createSocket } : {}),
        onEvent: (event) => onSocketEvent(channel, socket, event),
        onMessage: () => {
          if (state.socket === socket && state.failover.engine === 'deepgram') {
            state.failover.message(deps.now());
          }
        },
        onClose: (closed) => onSocketClose(channel, socket, closed),
      });
      try {
        await socket.open(OPEN_TIMEOUT_MS);
        trace('socket-open', { channel, ms: deps.now() - startedAt, optional, kind });
        if (!optional && attempts.length > 1) state.noOptional = true;
        return socket;
      } catch {
        trace('socket-open-failed', { channel, ms: deps.now() - startedAt, optional, kind });
      }
    }
    throw new Error('No socket opened');
  }

  /**
   * A transcript event from a socket: passed on when it is the channel's active socket on Deepgram.
   *
   * @param channel Which channel.
   * @param socket  The socket it came from.
   * @param event   The event.
   */
  function onSocketEvent(channel: ChannelId, socket: DeepgramChannel, event: CloudEvent): void {
    const state = channels[channel];
    if (stopped || state.socket !== socket || state.failover.engine !== 'deepgram') return;
    if (event.type === 'partial') state.openSince = event.text === '' ? null : event.tStart;
    else if (event.type === 'final') state.openSince = null;
    handlers.onEvent(channel, event);
  }

  /**
   * A socket closed: a failure moves the channel to the on-device engine (or schedules the next retry).
   *
   * @param channel Which channel.
   * @param socket  The socket.
   * @param closed  How it closed.
   */
  function onSocketClose(
    channel: ChannelId,
    socket: DeepgramChannel,
    closed: { code: number; wasOpen: boolean; expected: boolean },
  ): void {
    trace('socket-close', {
      channel,
      code: closed.code,
      wasOpen: closed.wasOpen,
      expected: closed.expected,
    });
    const state = channels[channel];
    if (stopped || closed.expected || state.socket !== socket) return;
    state.socket = null;
    if (state.failover.engine === 'deepgram') toLocal(channel, 'closed');
    else state.failover.failed(deps.now());
  }

  /**
   * Moves a channel to the on-device engine: the cloud grey line is dropped, and the audio Deepgram had
   * not finished is replayed from the 10 s store (a gap is reported when the store does not reach back).
   *
   * @param channel Which channel.
   * @param reason  Why.
   */
  function toLocal(channel: ChannelId, reason: FailoverReason): void {
    const state = channels[channel];
    if (state.failover.engine === 'local') return;
    const now = deps.now();
    const socket = state.socket;
    const processed = socket?.processedToUnix() ?? null;
    // From the start of the line being spoken (its words are decoded again), else from what Deepgram had
    // done, else everything kept.
    const fromUnix = state.openSince ?? processed;
    if (state.openSince !== null) {
      handlers.onEvent(channel, { type: 'partial', text: '', tStart: now, tEnd: now });
    }
    state.openSince = null;
    socket?.close();
    state.socket = null;
    state.failover.failed(now);
    trace('failover', { channel, to: 'local', reason });
    handlers.onEngine(channel, 'local', reason);
    const local = options.local();
    if (!local || clockOffset === null) return;
    local.setClock(clockOffset);
    lastLocalClockAt = now;
    // Never before this attach (a resumed call does not replay what was said before the pause).
    const oldest = Math.max(state.ring.oldestStart() ?? 0, state.attachedFrom ?? 0);
    const fromAudio =
      fromUnix === null ? oldest : Math.max(toAudio(fromUnix), state.attachedFrom ?? 0);
    if (fromUnix !== null && oldest > toAudio(fromUnix) + 0.2) {
      handlers.onGap(channel, fromUnix, Math.round(oldest * 1000 + clockOffset));
    }
    const replay = state.ring.since(fromAudio);
    for (const chunk of replay) local.accept(channel, chunk.samples, chunk.endTime, true);
    trace('replay', { channel, chunks: replay.length });
  }

  /**
   * Gives a channel back to Deepgram (its probe socket has been healthy long enough, at a pause).
   *
   * @param channel Which channel.
   */
  function toCloud(channel: ChannelId): void {
    const state = channels[channel];
    if (!state.socket) return;
    options.local()?.detach(channel);
    state.socket.muted = false;
    state.failover.returned(deps.now());
    trace('failover', { channel, to: 'deepgram', reason: 'recovered' });
    handlers.onEngine(channel, 'deepgram', 'recovered');
  }

  /**
   * Starts a background retry for a channel on the on-device engine: a muted probe socket.
   *
   * @param channel Which channel.
   */
  function probe(channel: ChannelId): void {
    const state = channels[channel];
    if (state.opening || state.socket) return;
    state.opening = true;
    openSocket(channel)
      .then((socket) => {
        state.opening = false;
        if (stopped || !state.attached) {
          socket.close();
          return;
        }
        socket.muted = true;
        state.socket = socket;
        state.failover.opened(deps.now());
      })
      .catch(() => {
        state.opening = false;
        state.failover.failed(deps.now());
      });
  }

  /** The once-a-second check: stalls, offline, backlog, retries, and switching back. */
  function tick(): void {
    if (stopped) return;
    const now = deps.now();
    if (clockOffset !== null && now - lastClockTraceAt >= CLOCK_TRACE_MS) {
      lastClockTraceAt = now;
      trace('clock', { offsetMs: Math.round(clockOffset) });
    }
    const online = deps.online();
    for (const channel of ['them', 'you'] as const) {
      const state = channels[channel];
      if (!state.attached) continue;
      if (state.bufferedMax > 0)
        trace('buffered', { channel, maxMs: Math.round(state.bufferedMax) });
      state.bufferedMax = 0;
      if (state.failover.engine === 'deepgram') {
        if (!online) toLocal(channel, 'offline');
        else if (state.failover.stalled(now)) toLocal(channel, 'stalled');
        continue;
      }
      // On the on-device engine: keep its clock fresh, retry Deepgram, switch back at a pause.
      if (clockOffset !== null && now - lastLocalClockAt >= CLOCK_TRACE_MS) {
        lastLocalClockAt = now;
        options.local()?.setClock(clockOffset);
      }
      if (!state.socket && online && state.failover.retryDue(now)) probe(channel);
      const pause = state.socket?.idle() === true && options.localIdle(channel);
      if (state.socket?.isOpen() && state.failover.canReturn(now, pause)) toCloud(channel);
    }
  }

  const timer = setInterval(tick, TICK_MS);
  const stopWatching = deps.watchOffline(() => {
    for (const channel of ['them', 'you'] as const) {
      if (channels[channel].attached && channels[channel].failover.engine === 'deepgram') {
        toLocal(channel, 'offline');
      }
    }
  });

  /**
   * One cleaned chunk from the audio worker: kept, then sent to the channel's socket (active or probe)
   * and, on the on-device engine, decoded there.
   *
   * @param message The chunk.
   */
  function onChunk(message: Extract<FromAudioWorker, { type: 'chunk' }>): void {
    clockOffset = message.offsetMs;
    const state = channels[message.channel];
    if (!state.attached || stopped) return;
    state.attachedFrom ??= message.endTime - message.samples.length / TARGET_SAMPLE_RATE;
    state.ring.push({ samples: message.samples, endTime: message.endTime });
    const socket = state.socket;
    if (socket) {
      socket.send(message.pcm, message.endTime);
      const buffered = socket.bufferedMs();
      state.bufferedMax = Math.max(state.bufferedMax, buffered);
      if (state.failover.engine === 'deepgram' && buffered > MAX_BUFFERED_MS) {
        toLocal(message.channel, 'buffered');
        return;
      }
    }
    if (state.failover.engine === 'local') {
      options.local()?.accept(message.channel, message.samples, message.endTime);
    }
  }

  /**
   * Creates the AudioContext, the worklet module and the audio worker, once.
   *
   * @returns The running context.
   */
  async function ensureAudio(): Promise<AudioContext> {
    if (!context) {
      context = deps.createAudioContext();
      const moduleUrl = workletModuleUrl(CLOUD_CHUNK_SAMPLES, CLOUD_WORKLET_NAME);
      workletReady = context.audioWorklet.addModule(moduleUrl).finally(() => {
        URL.revokeObjectURL(moduleUrl);
      });
      worker = deps.createAudioWorker();
      worker.onmessage = (event: MessageEvent<FromAudioWorker>) => {
        if (stopped) return;
        const message = event.data;
        if (message.type === 'chunk') onChunk(message);
        else if (message.type === 'echo' && message.state !== echoState) {
          echoState = message.state;
          handlers.onEcho?.(message.state);
        }
      };
      const init: ToAudioWorker = { type: 'init', aec: aecDownloads(deps.origin) };
      worker.postMessage(init);
    }
    await workletReady;
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  /**
   * Disconnects a channel's audio graph.
   *
   * @param channel Which channel.
   */
  function disconnect(channel: ChannelId): void {
    const graph = channels[channel].graph;
    if (!graph) return;
    graph.source.disconnect();
    graph.node.disconnect();
    graph.node.port.close();
    channels[channel].graph = null;
    const message: ToAudioWorker = { type: 'detach', channel };
    worker?.postMessage(message);
  }

  return {
    async attach(channel, stream) {
      if (stopped) throw new Error('Cloud transcription was stopped');
      const audio = await ensureAudio();
      disconnect(channel);
      const source = audio.createMediaStreamSource(stream);
      const node = deps.createWorkletNode(audio);
      // The worklet posts straight to the audio worker: audio never passes through the main thread
      // before it is cleaned.
      const pipe = new MessageChannel();
      node.port.postMessage({ type: 'connect', port: pipe.port1 }, [pipe.port1]);
      const attachMessage: ToAudioWorker = { type: 'attach', channel, port: pipe.port2 };
      worker?.postMessage(attachMessage, [pipe.port2]);
      source.connect(node);
      const state = channels[channel];
      state.graph = { source, node };
      // Already running (a new microphone, a new share): only the stream changed; the socket, or the
      // on-device fallback, carries on.
      if (state.attached) return;
      state.attached = true;
      state.attachedFrom = null;
      state.failover = new ChannelFailover();
      state.opening = true;
      // Connect never waits for Deepgram: the socket opens in the background, and the audio of the
      // meantime is kept (ring buffer) and sent first once it is open.
      void openSocket(channel).then(
        (socket) => {
          state.opening = false;
          if (stopped || !state.attached) {
            socket.close();
            return;
          }
          if (state.attachedFrom !== null) {
            for (const kept of state.ring.since(state.attachedFrom)) {
              socket.send(toLinear16(kept.samples), kept.endTime);
            }
          }
          state.socket = socket;
          state.failover.opened(deps.now());
          handlers.onEngine(channel, 'deepgram', 'start');
        },
        (error: unknown) => {
          state.opening = false;
          if (!stopped && state.attached) {
            toLocal(channel, error instanceof SttTokenError ? 'token' : 'open-failed');
          }
        },
      );
    },

    detach(channel) {
      disconnect(channel);
      const state = channels[channel];
      if (!state.attached) return;
      state.attached = false;
      state.openSince = null;
      state.attachedFrom = null;
      state.ring.clear();
      const socket = state.socket;
      state.socket = null;
      if (socket) {
        const done = socket.finish(FINISH_TIMEOUT_MS);
        finishing.add(done);
        void done.then(() => finishing.delete(done));
      }
      // The on-device engine's line in progress on this channel (fallback) becomes final.
      if (state.failover.engine === 'local') options.local()?.detach(channel);
    },

    async drain(timeoutMs = FINISH_TIMEOUT_MS) {
      await Promise.race([
        Promise.all([...finishing]),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]);
      await options.local()?.drain(timeoutMs);
    },

    async catchUp(channel, atUnix, capMs) {
      const state = channels[channel];
      if (state.failover.engine === 'local') {
        // The on-device worker handles messages in order: once it answers, everything sent is decoded.
        const startedAt = deps.now();
        await options.local()?.drain(capMs);
        const waitedMs = deps.now() - startedAt;
        return { waitedMs, timedOut: waitedMs >= capMs };
      }
      const socket = state.socket;
      if (!socket) return { waitedMs: 0, timedOut: false };
      // Nothing was said lately and no line is open: there is nothing to wait for.
      const quiet = state.lastSoundAt === null || state.lastSoundAt < atUnix - RECENT_SOUND_MS;
      if (quiet && socket.idle()) return { waitedMs: 0, timedOut: false };
      return socket.catchUp(atUnix, capMs);
    },

    engineOf(channel) {
      return channels[channel].failover.engine;
    },

    sound(channel) {
      const now = deps.now();
      channels[channel].lastSoundAt = now;
      channels[channel].failover.sound(now);
    },

    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      stopWatching();
      for (const channel of ['them', 'you'] as const) {
        disconnect(channel);
        channels[channel].socket?.close();
        channels[channel].socket = null;
        channels[channel].attached = false;
        channels[channel].ring.clear();
      }
      const stop: ToAudioWorker = { type: 'stop' };
      worker?.postMessage(stop);
      // A moment for the worker to close its ports, then it ends.
      const ending = worker;
      setTimeout(() => ending?.terminate(), 300);
      void context?.close().catch(() => undefined);
    },
  };
}
