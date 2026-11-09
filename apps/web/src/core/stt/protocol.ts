/**
 * File: apps/web/src/core/stt/protocol.ts
 * Purpose: The messages exchanged between the page (sttEngine.ts) and the speech-to-text Web
 *          Worker (stt.worker.ts), and the statistics they carry. Text fields hold transcript
 *          text and are never logged.
 * Used by: src/core/stt/sttEngine.ts, src/core/stt/stt.worker.ts, src/core/stt/channel.ts,
 *          src/core/stt/health.ts, src/features/dev/SttTest.tsx
 * Depends on: src/core/stt/models.ts (ids and download files), src/core/stt/download.ts (types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §7.1 (core/stt); ADR-0020
 */
import type { DownloadErrorKind, DownloadProgress } from './download';
import type { DownloadFile, SttModelId } from './models';

/** The two call channels. "You" = microphone, "Them" = the other side. Never mixed. */
export type ChannelId = 'you' | 'them';

/** Both channel ids, in display order. */
export const CHANNELS: readonly ChannelId[] = ['you', 'them'];

/**
 * What ended an utterance:
 * - 'model': the recognizer's own endpoint rule (about 1 s of decoded silence after speech);
 * - 'pause': the worker's safety net (no new words for 1.2 s of audio while text is showing);
 * - 'flush': the channel was detached or the engine stopped while text was showing.
 */
export type EndpointReason = 'model' | 'pause' | 'flush';

/**
 * How sure the speech model was of a final line (v1.4, ADR-0062), from the log probability sherpa-onnx
 * gives each word piece it wrote. Used to spot speech the English model cannot write (another
 * language) and noise it turned into a word. Numbers only.
 */
export interface LineConfidence {
  /** Number of word pieces (tokens) in the line. */
  tokens: number;
  /** Mean log probability of those pieces (0 = certain; more negative = less sure). */
  meanLogProb: number;
  /** Share of pieces with a log probability below LOW_TOKEN_LOG_PROB (0…1). */
  lowShare: number;
}

/** A word piece whose log probability is below this counts as unsure (about 37% likely or less). */
export const LOW_TOKEN_LOG_PROB = -1;

/**
 * How many candidate texts beam search keeps (sherpa-onnx maxActivePaths). 4 is sherpa-onnx's
 * default and what live sessions use; 8 is offered on /dev/stt-test only, to measure whether a
 * wider beam lets hotwords reach names (Day 3 Stage 4 measurement) and what it costs in CPU.
 */
export type BeamWidth = 4 | 8;

/** The beam width live sessions use. */
export const DEFAULT_BEAM_WIDTH: BeamWidth = 4;

/** How long loading took, and from where. */
export interface LoadStats {
  /** Which model was loaded. */
  model: SttModelId;
  /** Bytes of all files (runtime + model). */
  bytes: number;
  /** True when every file came from Cache Storage (no network download). */
  fromCache: boolean;
  /** False when Cache Storage was unavailable: files are downloaded again on every load. */
  cacheAvailable: boolean;
  /** Fetching and verifying all files, in ms. */
  downloadMs: number;
  /** Compiling the WebAssembly and starting the runtime, in ms. */
  runtimeInitMs: number;
  /** Writing model files, building bpe.vocab and creating the recognizer, in ms. */
  modelInitMs: number;
  /** Start of loading → recognizer ready, in ms. */
  totalMs: number;
}

/** Running statistics for one channel (cumulative since it was attached). */
export interface ChannelStats {
  /** Audio received, in ms. */
  audioMs: number;
  /** Time spent decoding it (including end-of-utterance work), in ms. */
  decodeMs: number;
  /** decodeMs ÷ audioMs. */
  rtf: number;
  /** Chunks (~100 ms each) decoded. */
  chunks: number;
  /** Average processing time per chunk, in ms. */
  chunkMsAvg: number;
  /** Slowest chunk, in ms. */
  chunkMsMax: number;
  /** Audio the energy gate did not decode because the channel was silent, in ms. */
  skippedMs: number;
  /** Lag from detected speech onset to first partial text, per utterance (latest 50), in ms. */
  lagsMs: number[];
  /**
   * Per utterance (latest 50): how much later than the speech onset the energy gate let audio
   * through, in ms (0 = no added delay). The gate's share of the lag above.
   */
  gateDelaysMs: number[];
  /** How many utterances each rule ended. */
  endpoints: Record<EndpointReason, number>;
  /** Sample rate the audio arrived at before resampling (its AudioContext's rate). */
  inputSampleRate: number;
}

/** Statistics for the whole engine, sent about once a second. */
export interface EngineStats {
  /** Per attached channel. */
  channels: Partial<Record<ChannelId, ChannelStats>>;
  /**
   * Combined real-time factor: decode time of all channels ÷ the audio time of the longest-running
   * channel. The worker is single-threaded, so this is also the share of one CPU core it uses.
   */
  combinedRtf: number;
  /** Total decode time of all channels, in ms (cumulative; health.ts uses the change per second). */
  totalDecodeMs: number;
  /** Audio time of the longest-running channel, in ms (cumulative). */
  totalAudioMs: number;
  /** Size of the worker's WebAssembly memory, in bytes (the bulk of its memory use). */
  wasmMemoryBytes: number;
}

/** Page → worker messages. */
export type ToWorker =
  | {
      /** Download (or read from the cache), verify, and start the recognizer. */
      type: 'load';
      /** Which model. */
      model: SttModelId;
      /** Runtime files, from our own origin (see models.ts). */
      runtime: {
        /** Emscripten loader script (defines the global `Module`). */
        loader: DownloadFile;
        /** The compiled sherpa-onnx WebAssembly code. */
        wasm: DownloadFile;
        /** sherpa-onnx's JavaScript API (createOnlineRecognizer). */
        api: DownloadFile;
      };
      /** Model files (local or remote). */
      files: {
        /** Encoder. */
        encoder: DownloadFile;
        /** Decoder. */
        decoder: DownloadFile;
        /** Joiner. */
        joiner: DownloadFile;
        /** Token list. */
        tokens: DownloadFile;
        /** Tokenizer model (converted to bpe.vocab in the worker). */
        bpeModel: DownloadFile;
      };
      /** Hotwords buffer from formatHotwords() ('' for none). Session names; never logged. */
      hotwords: string;
      /** Candidate texts kept by beam search (4 everywhere except /dev/stt-test). */
      beamWidth: BeamWidth;
    }
  | {
      /** Start decoding a channel from a worklet's MessagePort (audio skips the main thread). */
      type: 'attach';
      /** Which channel. */
      channel: ChannelId;
      /** Port the resampler worklet posts `{ samples, endTime }` chunks to. */
      port: MessagePort;
      /** Sample rate of the AudioContext feeding the worklet. */
      inputSampleRate: number;
      /**
       * v1.0.1 (ADR-0034): send each final line's audio too, for the desktop app's accurate engine
       * (only when the user turned it on; otherwise no audio leaves the worker).
       */
      keepAudio?: boolean;
    }
  | {
      /** Feed one chunk directly (tests and recordings; live audio uses 'attach'). */
      type: 'accept';
      /** Which channel (created if not attached yet). */
      channel: ChannelId;
      /** 16 kHz mono samples. */
      samples: Float32Array;
      /** Capture time of the chunk's last sample, on the sender's audio clock, in seconds. */
      endTime: number;
    }
  | {
      /** Drop a channel's current utterance without a final line, and start fresh. */
      type: 'reset';
      /** Which channel. */
      channel: ChannelId;
    }
  | {
      /** Stop decoding a channel (its current text is posted as a final line first). */
      type: 'detach';
      /** Which channel. */
      channel: ChannelId;
    }
  | {
      /** Replace the hotwords (re-creates the recognizer; about 2 s; streams restart). */
      type: 'set-hotwords';
      /** Hotwords buffer from formatHotwords() ('' for none). Never logged. */
      hotwords: string;
    }
  | {
      /**
       * Asks the worker to answer with a matching 'pong'. The worker handles messages in order,
       * so the pong arrives after every final line that earlier messages (such as a detach)
       * produced: the page uses it to wait for the last flushed lines when a call ends (Day 4).
       */
      type: 'ping';
      /** Number echoed back in the pong. */
      id: number;
    }
  | {
      /** Cancel any download, flush and release everything. */
      type: 'stop';
    };

/** Error codes the worker reports. */
export type EngineErrorCode = `download-${DownloadErrorKind}` | 'runtime' | 'vocab' | 'decode';

/** Worker → page messages. */
export type FromWorker =
  | {
      /** Download progress across all files. */
      type: 'progress';
      /** The progress. */
      progress: DownloadProgress;
    }
  | {
      /** The recognizer is ready. */
      type: 'ready';
      /** How loading went. */
      load: LoadStats;
    }
  | {
      /** New hotwords are in use (after 'set-hotwords'). */
      type: 'hotwords-set';
      /** How long re-creating the recognizer took, in ms. */
      ms: number;
    }
  | {
      /** Current, still-changing text of a channel's utterance ('' = cleared). */
      type: 'partial';
      /** Which channel. */
      channel: ChannelId;
      /** Transcript text (never logged). */
      text: string;
      /** When the utterance started (Unix ms, capture time); null when the text was cleared. */
      tStart: number | null;
    }
  | {
      /** A finished utterance. */
      type: 'final';
      /** Which channel. */
      channel: ChannelId;
      /** Transcript text (never logged). */
      text: string;
      /** Which rule ended it. */
      reason: EndpointReason;
      /**
       * v1.0.1 (ADR-0034): the utterance's audio as decoded (mono 16 kHz), only when the channel
       * was attached with keepAudio and the utterance is at most ACCURATE_MAX_SECONDS long. Never
       * stored or logged; the page passes it to the accurate engine and drops it.
       */
      audio?: Float32Array;
      /** When it started (Unix ms, capture time of the detected speech onset or first text). */
      tStart: number;
      /** When its last word changed (Unix ms, capture time). */
      tEnd: number;
      /**
       * End of speech (Unix ms, capture time): the end of the last loud 10 ms frame, but never
       * after tEnd. Latencies are measured from here.
       */
      speechEnd: number;
      /**
       * v1.4 (ADR-0062): how sure the model was of the line's words, from sherpa-onnx's per-token log
       * probabilities. Absent when the runtime gives none. Numbers only, never text.
       */
      confidence?: LineConfidence;
    }
  | {
      /** Updated statistics (about once a second while loaded). */
      type: 'stats';
      /** The statistics. */
      stats: EngineStats;
    }
  | {
      /** Answer to a 'ping': every message sent before it has been handled. */
      type: 'pong';
      /** The ping's number. */
      id: number;
    }
  | {
      /** Loading or decoding failed. */
      type: 'error';
      /** What kind of failure. */
      code: EngineErrorCode;
      /** Explanation (file names and sizes only; no transcript text). */
      message: string;
    };
