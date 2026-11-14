/**
 * File: apps/web/src/core/stt/deepgram.ts
 * Purpose: The Deepgram adapter of cloud transcription (ADR-0076): one WebSocket per channel, straight
 *          from the device to Deepgram (never through Kite's server). Builds the listen URL (Flux on
 *          /v2/listen, Nova-3 on /v1/listen, the parameters of investigation C3), turns Deepgram's messages
 *          into transcript events on the call's capture clock (FluxAssembler, NovaAssembler; Batch D P0-A: a
 *          Flux line starts at its first spoken words, not at the previous turn's end), and wraps the
 *          socket: open with the 60-second token, send 80 ms PCM chunks, "processed up to" for a key press
 *          (Flux's audio_window_end; Nova-3's Finalize), and a graceful close. Text is never logged.
 * Used by: src/core/stt/cloudStt.ts; tests/unit/core/stt/deepgram.test.ts
 * Depends on: src/core/stt/protocol.ts (ChannelId)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C2, C3, C8; ADR-0076;
 *               docs/investigations/2026-11-14-test-call-issues.md R1 (ADR-0079)
 */
import type { ChannelId } from './protocol';

/** Audio format sent to Deepgram: 16 kHz, 16-bit mono PCM. */
export const SAMPLE_RATE = 16_000;

/** Bytes of audio per second (16 kHz × 2 bytes). */
export const BYTES_PER_SECOND = SAMPLE_RATE * 2;

/** Flux: end-of-turn confidence that ends a turn (investigation C3). */
export const EOT_THRESHOLD = 0.7;

/** Flux: confidence for the early "eager" end-of-turn signal. */
export const EAGER_EOT_THRESHOLD = 0.5;

/** Flux: a turn ends after this much silence whatever the confidence, ms. */
export const EOT_TIMEOUT_MS = 5_000;

/** Nova-3: silence that ends an utterance (speech_final), ms. */
export const ENDPOINTING_MS = 300;

/** Nova-3: no words for this long sends UtteranceEnd, ms. */
export const UTTERANCE_END_MS = 1_000;

/** How far behind the press a channel may still be and count as caught up, ms (investigation C8). */
export const CAUGHT_UP_SLACK_MS = 100;

/**
 * Batch D (P0-A, investigation 2026-11-14 R1): when Flux's words carry no times of their own, a turn is
 * taken to start this long before the first message that showed speech (StartOfTurn, or the first words),
 * in seconds. Flux sends an update about every 0.24 s of audio and a first word lasts about 0.3 s, so the
 * first words were spoken roughly 0.3–0.6 s before that message's audio_window_end. Not yet measured on a
 * real stream: the 'flux-start' trace event records the source used and, when words do carry times, how
 * far this estimate was from them (wordLeadMs), so the next traced call can confirm or correct it.
 */
export const FLUX_FIRST_WORDS_LEAD_S = 0.4;

/**
 * Batch D (P0-A): a first word's own start time is used only when it lies within this many seconds before
 * the turn's audio window (or anywhere inside it); anything else is treated as a different time base.
 */
export const FLUX_WORD_TIME_SLACK_S = 1;

/** Batch D (P0-A): what a Flux line's start time came from (for the trace). */
export type FluxStartSource = 'words' | 'start-of-turn' | 'first-words';

/** Which Deepgram API a model uses. */
export type DeepgramKind = 'flux' | 'nova';

/** What a channel's socket is opened with. */
export interface ListenSettings {
  /** The host that minted the token, for example 'api.eu.deepgram.com'. */
  host: string;
  /** The model, for example 'flux-general-en' or 'nova-3'. */
  model: string;
  /** 'en' for English sessions; 'multi' (Nova-3 only) for any other language. */
  language: 'en' | 'multi';
  /** Session keyterms (the same list on both channels; at most 100, Batch D). Never logged. */
  keyterms: readonly string[];
  /**
   * False drops the parameters that are not essential (keyterms, redact_usage) after a handshake that
   * failed with them, so an unknown parameter cannot stop cloud transcription altogether.
   */
  optional: boolean;
}

/**
 * Which API a model belongs to: Flux models are on /v2/listen and send turn events.
 *
 * @param model The model name.
 * @returns 'flux' for Flux models, otherwise 'nova'.
 * Called from: buildListenUrl(); cloudStt.ts; tests
 */
export function kindOf(model: string): DeepgramKind {
  return model.startsWith('flux') ? 'flux' : 'nova';
}

/**
 * The WebSocket URL for one channel (investigation C3).
 *
 * @param settings See ListenSettings.
 * @returns The wss:// URL.
 * Called from: cloudStt.ts; tests
 */
export function buildListenUrl(settings: ListenSettings): string {
  const kind = kindOf(settings.model);
  const params = new URLSearchParams();
  params.set('model', settings.model);
  params.set('encoding', 'linear16');
  params.set('sample_rate', String(SAMPLE_RATE));
  if (kind === 'flux') {
    params.set('eot_threshold', String(EOT_THRESHOLD));
    params.set('eager_eot_threshold', String(EAGER_EOT_THRESHOLD));
    params.set('eot_timeout_ms', String(EOT_TIMEOUT_MS));
  } else {
    params.set('language', settings.language);
    params.set('channels', '1');
    params.set('interim_results', 'true');
    params.set('smart_format', 'true');
    params.set('punctuate', 'true');
    params.set('endpointing', String(ENDPOINTING_MS));
    params.set('utterance_end_ms', String(UTTERANCE_END_MS));
    params.set('vad_events', 'true');
  }
  // Privacy (investigation C10): out of Deepgram's model improvement programme.
  params.set('mip_opt_out', 'true');
  if (settings.optional) {
    // Keyterms are not kept in Deepgram's usage records.
    params.set('redact_usage', 'true');
    for (const term of settings.keyterms) params.append('keyterm', term);
  }
  const path = kind === 'flux' ? '/v2/listen' : '/v1/listen';
  return `wss://${settings.host}${path}?${params.toString()}`;
}

/** A transcript event from a channel, with times as Unix ms on the capture clock. */
export type CloudEvent =
  | {
      /** The words of the line being spoken now ('' clears it). */
      type: 'partial';
      /** The words (never logged). */
      text: string;
      /** When the line started. */
      tStart: number;
      /** When its words last changed. */
      tEnd: number;
      /**
       * Batch D (P0-A), Flux only: where the line's audio begins at the earliest (the turn's audio window
       * start, Unix ms). tStart is an estimate of the first word; a failover replays from here so the
       * on-device engine cannot miss a first word the estimate put too late.
       */
      audioFrom?: number;
    }
  | {
      /** A finished line. */
      type: 'final';
      /** The words (never logged). */
      text: string;
      /** When it started. */
      tStart: number;
      /** When its last word ended (as far as the model says). */
      tEnd: number;
      /** True when the model's own end of turn ended it (Flux EndOfTurn): the speaker finished. */
      endOfTurn: boolean;
      /** Batch D (P0-A), Flux only: what tStart came from (for the trace). */
      startSource?: FluxStartSource;
      /**
       * Batch D (P0-A), Flux only, when the words carried their own times: how much earlier (ms) the first
       * word started than the lead-based estimate would have put it (positive: the estimate was late).
       * Measures FLUX_FIRST_WORDS_LEAD_S on real calls.
       */
      wordLeadMs?: number;
    }
  | {
      /** A Flux turn event. */
      type: 'turn';
      /** StartOfTurn, EagerEndOfTurn, EndOfTurn or TurnResumed. */
      event: 'start' | 'eager' | 'end' | 'resumed';
      /** The end-of-turn confidence Flux gave, or null. */
      confidence: number | null;
      /** Where in the audio it happened (Unix ms, capture clock). */
      at: number;
    }
  | {
      /** Nova-3 heard speech start (vad_events). */
      type: 'speech-started';
      /** When (Unix ms, capture clock). */
      at: number;
    };

/** Turns stream seconds (from the first audio byte sent) into Unix ms on the capture clock. */
export type StreamClock = (streamSeconds: number) => number;

/** A Deepgram message as parsed JSON (only the fields read are typed). */
export interface DeepgramMessage {
  /** Message type ('TurnInfo', 'Results', 'UtteranceEnd', 'SpeechStarted', 'Error', …). */
  type?: string;
  /** Flux: which turn event. */
  event?: string;
  /** Flux: the turn's number. */
  turn_index?: number;
  /**
   * Flux: start of the audio this message covers, s. Deepgram's schema types it as a string holding a
   * number; read through seconds() so either form works.
   */
  audio_window_start?: number | string;
  /** Flux: how far the audio has been processed, s (number or numeric string, as above). */
  audio_window_end?: number | string;
  /** Flux: the turn's words so far. */
  transcript?: string;
  /**
   * Flux: the turn's words. Deepgram documents optional start/end times per word (stream seconds); when
   * present, the first word's start is the line's start (Batch D, P0-A). Never logged.
   */
  words?: { word?: string; start?: number | string; end?: number | string }[];
  /** Flux: end-of-turn confidence (a number, or a numeric string as the schema types it). */
  end_of_turn_confidence?: number | string;
  /** Nova-3: start of this result's audio, s. */
  start?: number;
  /** Nova-3: length of this result's audio, s. */
  duration?: number;
  /** Nova-3: these words will not change. */
  is_final?: boolean;
  /** Nova-3: the speaker paused (endpointing). */
  speech_final?: boolean;
  /** Nova-3: this result answers a Finalize. */
  from_finalize?: boolean;
  /** Nova-3: the words. */
  channel?: {
    /** Alternatives, best first. */
    alternatives?: {
      /** The words as one text. */
      transcript?: string;
      /** Each word with its times. */
      words?: { start?: number; end?: number }[];
    }[];
  };
  /** Nova-3 UtteranceEnd: the last word's end, s. */
  last_word_end?: number;
  /** Nova-3 SpeechStarted: when, s. */
  timestamp?: number;
  /** Flux ConfigureFailure / Error: a short code (for example UNPARSABLE_CLIENT_MESSAGE). */
  code?: string;
}

/**
 * A Deepgram time field as seconds: a number, or a string holding one (the Flux schema types several
 * numeric fields as strings).
 *
 * @param value The field.
 * @returns The seconds, or null when absent or not a number.
 * Called from: FluxAssembler.handle()
 */
function seconds(value: number | string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** One open Flux turn. */
interface FluxTurn {
  /** Flux's turn_index. */
  index: number;
  /** Start of Flux's audio window for this turn (stream s): where the previous turn ended, not speech. */
  windowStart: number;
  /** When the speaker started (stream s), once known (the first words decide it); null before. */
  start: number | null;
  /** What `start` came from. */
  source: FluxStartSource | null;
  /** The audio_window_end of the StartOfTurn message, when one came before any words (stream s). */
  startOfTurnAt: number | null;
  /** The words so far. Never logged. */
  text: string;
  /** Where the words last changed (stream s). */
  lastChange: number;
}

/** Flux's messages turned into events (one per channel; pure apart from the clock it is given). */
export class FluxAssembler {
  /** The open turn, or null between turns. */
  private turn: FluxTurn | null = null;
  /** How far the audio has been processed, stream seconds, or null. */
  processedTo: number | null = null;
  /** Batch D (P0-A): how far the lead-based estimate was from the word times (ms), for the open turn. */
  private wordLeadMs: number | null = null;

  /** @param toUnix Stream seconds → Unix ms. */
  constructor(private readonly toUnix: StreamClock) {}

  /**
   * Whether no turn is open (a pause: safe to switch engines).
   *
   * @returns True between turns.
   */
  idle(): boolean {
    return this.turn === null || this.turn.text === '';
  }

  /**
   * Batch D (P0-A, investigation 2026-11-14 R1): fixes when the speaker started, at the first message that
   * shows speech. Flux opens a turn's audio window where the previous turn ended, so the window's start is
   * the silence while the other person (often the user) talked, not this speaker's first word. Using it put
   * every "Them" line before the user's reply to the previous one, which then merged the two "Them" turns,
   * hid the reply from the question rules and sorted answers above earlier lines.
   *
   * Order of preference: the first word's own start time (when Flux sends one, within the window); else
   * the StartOfTurn message (or, without one, the first message with words) minus FLUX_FIRST_WORDS_LEAD_S,
   * never before the window's start.
   *
   * @param turn      The open turn (changed in place).
   * @param message   The message that brought the first words.
   * @param windowEnd Its audio_window_end, stream s.
   */
  private fixStart(turn: FluxTurn, message: DeepgramMessage, windowEnd: number): void {
    const signal = turn.startOfTurnAt ?? windowEnd;
    const estimate = Math.max(turn.windowStart, signal - FLUX_FIRST_WORDS_LEAD_S);
    const wordStart = seconds(message.words?.[0]?.start);
    if (
      wordStart !== null &&
      wordStart >= turn.windowStart - FLUX_WORD_TIME_SLACK_S &&
      wordStart <= windowEnd
    ) {
      turn.start = wordStart;
      turn.source = 'words';
      this.wordLeadMs = Math.round((estimate - wordStart) * 1000);
      return;
    }
    turn.start = estimate;
    turn.source = turn.startOfTurnAt !== null ? 'start-of-turn' : 'first-words';
    this.wordLeadMs = null;
  }

  /**
   * Takes one message.
   *
   * @param message The parsed message.
   * @returns The events it produces, in order.
   * Called from: DeepgramChannel; tests
   */
  handle(message: DeepgramMessage): CloudEvent[] {
    if (message.type !== 'TurnInfo') return [];
    const windowEnd = seconds(message.audio_window_end) ?? this.processedTo ?? 0;
    const windowStart = seconds(message.audio_window_start) ?? windowEnd;
    this.processedTo = Math.max(this.processedTo ?? 0, windowEnd);
    const index = message.turn_index ?? 0;
    const text = (message.transcript ?? '').trim();
    const confidence =
      typeof message.end_of_turn_confidence === 'number'
        ? message.end_of_turn_confidence
        : seconds(message.end_of_turn_confidence);
    const events: CloudEvent[] = [];
    if (!this.turn || this.turn.index !== index) {
      this.turn = {
        index,
        windowStart,
        start: null,
        source: null,
        startOfTurnAt: null,
        text: '',
        lastChange: windowEnd,
      };
      this.wordLeadMs = null;
    }
    const turn = this.turn;
    if (turn.start === null) {
      if (text !== '') this.fixStart(turn, message, windowEnd);
      else if (message.event === 'StartOfTurn') turn.startOfTurnAt ??= windowEnd;
    }
    // Before any words the turn has no start of its own yet; an empty partial is only a clear.
    const startUnix = () => this.toUnix(turn.start ?? windowEnd);
    const at = this.toUnix(windowEnd);
    switch (message.event) {
      case 'StartOfTurn':
        events.push({ type: 'turn', event: 'start', confidence, at });
        break;
      case 'EagerEndOfTurn':
        events.push({ type: 'turn', event: 'eager', confidence, at });
        break;
      case 'TurnResumed':
        events.push({ type: 'turn', event: 'resumed', confidence, at });
        break;
      default:
        break;
    }
    if (message.event === 'EndOfTurn') {
      const finalText = text || turn.text;
      if (text !== '' && text !== turn.text) turn.lastChange = windowEnd;
      if (finalText !== '') {
        events.push({
          type: 'final',
          text: finalText,
          tStart: startUnix(),
          // Words that last changed before the (estimated) start still end no earlier than it.
          tEnd: Math.max(startUnix(), this.toUnix(turn.lastChange)),
          endOfTurn: true,
          ...(turn.source ? { startSource: turn.source } : {}),
          ...(this.wordLeadMs !== null ? { wordLeadMs: this.wordLeadMs } : {}),
        });
      }
      events.push({ type: 'turn', event: 'end', confidence, at });
      this.turn = null;
      this.wordLeadMs = null;
      return events;
    }
    if (text !== turn.text) {
      turn.text = text;
      turn.lastChange = windowEnd;
      events.push(
        text === ''
          ? { type: 'partial', text: '', tStart: startUnix(), tEnd: at }
          : {
              type: 'partial',
              text,
              tStart: startUnix(),
              tEnd: Math.max(startUnix(), this.toUnix(turn.lastChange)),
              audioFrom: this.toUnix(turn.windowStart),
            },
      );
    }
    return events;
  }
}

/** A piece of words with its stream times. */
interface Piece {
  /** The words. */
  text: string;
  /** Start, stream seconds. */
  start: number;
  /** End, stream seconds. */
  end: number;
}

/** Nova-3's messages turned into events (one per channel; pure apart from the clock it is given). */
export class NovaAssembler {
  /** Words that will not change, in this utterance. */
  private committed: Piece[] = [];
  /** Words still changing, or null. */
  private interim: Piece | null = null;
  /** The text last shown as a partial. */
  private shown = '';
  /** How far the audio has been processed, stream seconds, or null. */
  processedTo: number | null = null;

  /** @param toUnix Stream seconds → Unix ms. */
  constructor(private readonly toUnix: StreamClock) {}

  /**
   * Whether no utterance is open (a pause: safe to switch engines).
   *
   * @returns True when nothing is being said.
   */
  idle(): boolean {
    return this.committed.length === 0 && this.interim === null;
  }

  /**
   * Takes one message.
   *
   * @param message The parsed message.
   * @returns The events it produces, in order.
   * Called from: DeepgramChannel; tests
   */
  handle(message: DeepgramMessage): CloudEvent[] {
    if (message.type === 'SpeechStarted') {
      return [{ type: 'speech-started', at: this.toUnix(message.timestamp ?? 0) }];
    }
    if (message.type === 'UtteranceEnd') return this.finish();
    if (message.type !== 'Results') return [];
    const start = message.start ?? 0;
    this.processedTo = Math.max(this.processedTo ?? 0, start + (message.duration ?? 0));
    const alternative = message.channel?.alternatives?.[0];
    const text = (alternative?.transcript ?? '').trim();
    const words = alternative?.words ?? [];
    const piece: Piece | null =
      text === ''
        ? null
        : {
            text,
            start: words[0]?.start ?? start,
            end: words.at(-1)?.end ?? start + (message.duration ?? 0),
          };
    if (!message.is_final) {
      this.interim = piece;
      return this.partial();
    }
    this.interim = null;
    if (piece) this.committed.push(piece);
    if (message.speech_final) return this.finish();
    return this.partial();
  }

  /**
   * The current words as a partial event, when they changed.
   *
   * @returns The event, or none.
   */
  private partial(): CloudEvent[] {
    const pieces = [...this.committed, ...(this.interim ? [this.interim] : [])];
    const text = pieces.map((piece) => piece.text).join(' ');
    if (text === this.shown) return [];
    this.shown = text;
    if (pieces.length === 0) {
      const at = this.toUnix(this.processedTo ?? 0);
      return [{ type: 'partial', text: '', tStart: at, tEnd: at }];
    }
    return [
      {
        type: 'partial',
        text,
        tStart: this.toUnix(pieces[0]!.start),
        tEnd: this.toUnix(pieces.at(-1)!.end),
      },
    ];
  }

  /**
   * Ends the utterance: its words become a final line.
   *
   * @returns The final event (none when nothing was said).
   */
  private finish(): CloudEvent[] {
    const pieces = [...this.committed, ...(this.interim ? [this.interim] : [])];
    this.committed = [];
    this.interim = null;
    this.shown = '';
    if (pieces.length === 0) return [];
    return [
      {
        type: 'final',
        text: pieces.map((piece) => piece.text).join(' '),
        tStart: this.toUnix(pieces[0]!.start),
        tEnd: this.toUnix(pieces.at(-1)!.end),
        // Nova-3's endpointing often fires inside a multi-sentence turn (investigation C3): not a turn end.
        endOfTurn: false,
      },
    ];
  }
}

/** The parts of a WebSocket the adapter uses (tests pass a fake). */
export interface SocketLike {
  /** 0 connecting, 1 open, 2 closing, 3 closed. */
  readonly readyState: number;
  /** Bytes queued but not yet sent. */
  readonly bufferedAmount: number;
  /** Sends text or binary data. */
  send(data: string | ArrayBuffer): void;
  /** Closes the socket. */
  close(code?: number, reason?: string): void;
  /** Open handler. */
  onopen: ((event: Event) => void) | null;
  /** Message handler. */
  onmessage: ((event: MessageEvent) => void) | null;
  /** Close handler. */
  onclose: ((event: CloseEvent) => void) | null;
  /** Error handler. */
  onerror: ((event: Event) => void) | null;
}

/** How a socket ended. */
export interface ChannelClosed {
  /** The close code (1000 normal, 1006 lost, Deepgram's 1008/1011/4xxx). */
  code: number;
  /** Whether it had opened. */
  wasOpen: boolean;
  /** True when this page closed it (End, a switch, a pause): not a failure. */
  expected: boolean;
}

/** Options for a DeepgramChannel. */
export interface DeepgramChannelOptions {
  /** Which channel. */
  channel: ChannelId;
  /** The listen URL (buildListenUrl()). */
  url: string;
  /** The Deepgram API of the model. */
  kind: DeepgramKind;
  /** The 60-second token (never logged). */
  token: string;
  /** The capture clock's current offset (Unix ms − audio ms). */
  clockOffsetMs: () => number;
  /** Transcript events (not called while muted). */
  onEvent: (event: CloudEvent) => void;
  /** Any message at all arrived (health). */
  onMessage?: () => void;
  /** The socket ended. */
  onClose: (closed: ChannelClosed) => void;
  /**
   * Batch C (P1-3): Flux answered a Configure message (ConfigureSuccess or ConfigureFailure).
   *
   * @param ok   True when it was applied.
   * @param code Deepgram's code when it was not.
   */
  onConfigured?: (ok: boolean, code: string | null) => void;
  /** Creates the socket (tests pass a fake). Default: new WebSocket(url, ['bearer', token]). */
  createSocket?: (url: string, protocols: string[]) => SocketLike;
  /** Unix ms (tests pass a fake). */
  now?: () => number;
}

/** A catch-up's outcome (investigation C8 step 3). */
export interface CatchUp {
  /** How long it waited, ms. */
  waitedMs: number;
  /** True when it gave up at the cap. */
  timedOut: boolean;
}

/** One channel's socket to Deepgram. */
export class DeepgramChannel {
  /** Which channel. */
  readonly channel: ChannelId;
  /** Flux or Nova-3. */
  readonly kind: DeepgramKind;
  /** While true, transcript events are not passed on (a probe after a failover). */
  muted = false;
  /** When the last message arrived (Unix ms), or null. */
  lastMessageAt: number | null = null;
  /** The socket. */
  private readonly socket: SocketLike;
  /** The options. */
  private readonly options: DeepgramChannelOptions;
  /** Flux's or Nova-3's message assembler. */
  private readonly assembler: FluxAssembler | NovaAssembler;
  /** Audio-clock time (s) of the first byte sent, or null before any audio. */
  private streamStart: number | null = null;
  /** Whether the socket opened. */
  private opened = false;
  /** Whether this page closed it. */
  private closing = false;
  /** Waiters for "processed up to", checked on every message. */
  private waiters: (() => void)[] = [];
  /** Resolves the open() promise. */
  private settleOpen: ((error?: Error) => void) | null = null;
  /** Resolves finish() once the socket closed. */
  private closedWaiters: (() => void)[] = [];
  /** Whether the socket has ended. */
  private ended = false;

  /** @param options See DeepgramChannelOptions. */
  constructor(options: DeepgramChannelOptions) {
    this.options = options;
    this.channel = options.channel;
    this.kind = options.kind;
    const toUnix: StreamClock = (seconds) =>
      Math.round(((this.streamStart ?? 0) + seconds) * 1000 + options.clockOffsetMs());
    this.assembler =
      options.kind === 'flux' ? new FluxAssembler(toUnix) : new NovaAssembler(toUnix);
    const create =
      options.createSocket ??
      ((url: string, protocols: string[]) => new WebSocket(url, protocols) as SocketLike);
    // The token rides in the subprotocol header (measured accepted on /v1 and /v2): never in the URL.
    this.socket = create(options.url, ['bearer', options.token]);
    this.socket.onopen = () => {
      this.opened = true;
      this.settleOpen?.();
      this.settleOpen = null;
    };
    this.socket.onmessage = (event: MessageEvent) => this.receive(event.data);
    this.socket.onerror = () => {
      // The close that follows says what happened; an error before opening fails open().
    };
    this.socket.onclose = (event: CloseEvent) => {
      this.ended = true;
      this.settleOpen?.(new Error(`closed before opening (${event.code})`));
      this.settleOpen = null;
      for (const resolve of this.waiters.splice(0)) resolve();
      for (const resolve of this.closedWaiters.splice(0)) resolve();
      options.onClose({ code: event.code, wasOpen: this.opened, expected: this.closing });
    };
  }

  /**
   * Waits for the socket to open.
   *
   * @param timeoutMs Longest wait, ms.
   * @returns Resolves when open.
   * @throws Error when it closed first or took longer than timeoutMs (it is then closed).
   * Called from: cloudStt.ts
   */
  open(timeoutMs: number): Promise<void> {
    if (this.opened) return Promise.resolve();
    if (this.ended) return Promise.reject(new Error('closed'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settleOpen = null;
        this.close();
        reject(new Error('open timed out'));
      }, timeoutMs);
      this.settleOpen = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
    });
  }

  /**
   * Whether the socket is open and usable.
   *
   * @returns True while open.
   */
  isOpen(): boolean {
    return this.opened && !this.ended && this.socket.readyState === 1;
  }

  /**
   * Sends one chunk. The first chunk sets the stream's start on the capture clock, so Deepgram's times
   * (seconds from the first byte) turn into capture times.
   *
   * @param pcm     16-bit PCM.
   * @param endTime Capture time of the chunk's last sample, audio clock seconds.
   * Called from: cloudStt.ts (each chunk of this channel)
   */
  send(pcm: ArrayBuffer, endTime: number): void {
    if (!this.isOpen()) return;
    this.streamStart ??= endTime - pcm.byteLength / BYTES_PER_SECOND;
    this.socket.send(pcm);
  }

  /**
   * Audio queued in the browser but not yet sent, in ms of audio.
   *
   * @returns The backlog, ms.
   */
  bufferedMs(): number {
    return (this.socket.bufferedAmount / BYTES_PER_SECOND) * 1000;
  }

  /**
   * How far Deepgram has processed this channel's audio, as a capture time.
   *
   * @returns Unix ms, or null before any result.
   */
  processedToUnix(): number | null {
    const to = this.assembler.processedTo;
    if (to === null || this.streamStart === null) return null;
    return Math.round((this.streamStart + to) * 1000 + this.options.clockOffsetMs());
  }

  /**
   * Whether nothing is being said on this stream now (no open turn or utterance).
   *
   * @returns True at a pause.
   */
  idle(): boolean {
    return this.assembler.idle();
  }

  /**
   * Waits until Deepgram has processed this channel up to a moment (investigation C8): Flux by its
   * audio_window_end; Nova-3 after a Finalize. Never longer than capMs.
   *
   * @param atUnix The moment (Unix ms, capture clock), normally the key press.
   * @param capMs  Longest wait, ms.
   * @returns How long it waited and whether it gave up.
   * Called from: cloudStt.ts catchUp()
   */
  catchUp(atUnix: number, capMs: number): Promise<CatchUp> {
    const now = this.options.now ?? Date.now;
    const startedAt = now();
    const caughtUp = () => {
      const processed = this.processedToUnix();
      return processed !== null && processed >= atUnix - CAUGHT_UP_SLACK_MS;
    };
    if (!this.isOpen() || caughtUp()) return Promise.resolve({ waitedMs: 0, timedOut: false });
    // Nova-3 flushes what it holds; Flux has no flush (ForceEndTurn would end the turn), so it is waited for.
    if (this.kind === 'nova') this.socket.send(JSON.stringify({ type: 'Finalize' }));
    return new Promise<CatchUp>((resolve) => {
      let done = false;
      const finish = (timedOut: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.waiters = this.waiters.filter((waiter) => waiter !== check);
        resolve({ waitedMs: Math.max(0, Math.round(now() - startedAt)), timedOut });
      };
      const check = () => {
        if (caughtUp() || this.ended) finish(false);
      };
      const timer = setTimeout(() => finish(true), capMs);
      this.waiters.push(check);
    });
  }

  /**
   * Batch C (P1-3; investigation C7): replaces the stream's keyterms without reconnecting, with Flux's
   * Configure message (the list replaces the old one; Flux answers ConfigureSuccess or ConfigureFailure,
   * and a failure keeps the old list). Nova-3 sockets are left alone: their next connection uses the new
   * list.
   *
   * @param keyterms The new list (at most 100 plain terms; never logged).
   * @returns True when the message was sent.
   * Called from: cloudStt.ts setKeyterms()
   */
  configure(keyterms: readonly string[]): boolean {
    if (this.kind !== 'flux' || !this.isOpen()) return false;
    try {
      this.socket.send(JSON.stringify({ type: 'Configure', keyterms: [...keyterms] }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ends the stream gracefully: Deepgram sends its last words, then closes.
   *
   * @param timeoutMs Longest wait for the close, ms.
   * @returns Resolves when closed (or after timeoutMs; the socket is then closed here).
   * Called from: cloudStt.ts (End, detach)
   */
  finish(timeoutMs: number): Promise<void> {
    if (this.ended) return Promise.resolve();
    this.closing = true;
    if (this.isOpen()) {
      try {
        this.socket.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // Already closing: the close below ends it.
      }
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.close();
        resolve();
      }, timeoutMs);
      this.closedWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** Closes at once (a switch to the on-device engine, or a failed probe). */
  close(): void {
    this.closing = true;
    if (this.ended) return;
    try {
      this.socket.close(1000);
    } catch {
      // Closing a socket that never opened can throw in some browsers; it is gone either way.
    }
  }

  /**
   * Handles one message from Deepgram.
   *
   * @param data The message (text JSON).
   */
  private receive(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: DeepgramMessage;
    try {
      message = JSON.parse(data) as DeepgramMessage;
    } catch {
      return;
    }
    this.lastMessageAt = (this.options.now ?? Date.now)();
    this.options.onMessage?.();
    // Batch C (P1-3): the reply to a Configure message (no transcript in it).
    if (message.type === 'ConfigureSuccess' || message.type === 'ConfigureFailure') {
      this.options.onConfigured?.(message.type === 'ConfigureSuccess', message.code ?? null);
      return;
    }
    const events = this.assembler.handle(message);
    if (!this.muted) for (const event of events) this.options.onEvent(event);
    for (const check of [...this.waiters]) check();
  }
}
