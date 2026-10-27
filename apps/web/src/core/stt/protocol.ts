/**
 * File: apps/web/src/core/stt/protocol.ts
 * Purpose: The messages exchanged between the page (sttEngine.ts), the streaming speech-to-text
 *          Web Worker (stt.worker.ts) and the second-pass worker (secondPass.worker.ts), and the
 *          statistics they carry. Text fields hold transcript text and are never logged; audio
 *          fields hold call audio, which stays in memory on this device.
 * Used by: src/core/stt/sttEngine.ts, src/core/stt/stt.worker.ts, src/core/stt/channel.ts,
 *          src/core/stt/secondPass.worker.ts, src/core/stt/secondPass.ts,
 *          src/core/stt/health.ts, src/features/dev/SttTest.tsx
 * Depends on: src/core/stt/models.ts (ids and download files), src/core/stt/download.ts (types)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1, §7.1 (core/stt); ADR-0020
 */
import type { DownloadErrorKind, DownloadProgress } from './download';
import type { DownloadFile, SecondPassModelId, SttModelId } from './models';

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

/** How long loading took, and from where. */
export interface LoadStats {
  /** Which model was loaded (streaming, or second-pass for the second worker). */
  model: SttModelId | SecondPassModelId;
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
  /** Added by sttEngine.ts (not the worker): the second-pass worker's latest statistics. */
  secondPass?: SecondPassStats;
  /**
   * Added by sttEngine.ts: decode time of BOTH workers (streaming + second-pass VAD and decode)
   * ÷ the audio time of the longest-running channel. With the second pass off it equals
   * combinedRtf.
   */
  allWorkersRtf?: number;
}

/** Page → worker messages. */
export type ToWorker =
  | {
      /** Download (or read from the cache), verify, and start the recognizer. */
      type: 'load';
      /** Which model. */
      model: SttModelId;
      /** Runtime files, from our own origin (see models.ts). */
      runtime: { loader: DownloadFile; wasm: DownloadFile; api: DownloadFile };
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
      /**
       * Port to the second-pass worker, when the second pass is on. Each finished utterance's
       * audio is posted to it (as a SecondPassJob); without it, no audio is kept.
       */
      secondPassPort?: MessagePort;
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
      /** Cancel any download, flush and release everything. */
      type: 'stop';
    };

/** Error codes the worker reports. */
export type EngineErrorCode =
  | `download-${DownloadErrorKind}`
  | 'runtime'
  | 'vocab'
  | 'decode'
  /** The second-pass worker failed (the first pass keeps working). */
  | 'second-pass';

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
      /** When it started (Unix ms, capture time of the detected speech onset or first text). */
      tStart: number;
      /** When its last word changed (Unix ms, capture time). */
      tEnd: number;
      /** Id of this utterance ('you-3'): the second pass refers to it. */
      segmentId: string;
      /**
       * End of speech (Unix ms, capture time): the end of the last loud 10 ms frame, but never
       * after tEnd. Latencies are measured from here.
       */
      speechEnd: number;
      /** True when its audio was sent to the second pass (a 'refined' message will follow). */
      secondPass: boolean;
    }
  | {
      /** Updated statistics (about once a second while loaded). */
      type: 'stats';
      /** The statistics. */
      stats: EngineStats;
    }
  | {
      /** Loading or decoding failed. */
      type: 'error';
      /** What kind of failure. */
      code: EngineErrorCode;
      /** Explanation (file names and sizes only; no transcript text). */
      message: string;
    };

// ---------------------------------------------------------------------------------------------
// Second pass (Day 2 Stage 5)
// ---------------------------------------------------------------------------------------------

/**
 * One finished utterance for the second pass, sent from the streaming worker straight to the
 * second-pass worker over a MessagePort (the samples' buffer is transferred, not copied). The
 * audio lives in worker memory only and is dropped once it has been decoded.
 */
export interface SecondPassJob {
  /** The utterance id from its first-pass final line. */
  segmentId: string;
  /** Which channel. */
  channel: ChannelId;
  /** 16 kHz mono samples: shortly before speech started to just after it ended (max 30 s). */
  samples: Float32Array;
  /** End of speech (Unix ms), passed back with the result for the latency measurement. */
  speechEnd: number;
  /** When the streaming worker sent it (Unix ms). */
  sentAt: number;
}

/**
 * How a second-pass job ended:
 * - 'refined': new text (it may equal the first-pass text);
 * - 'no-speech': the VAD found no speech, or the model returned nothing (first-pass text kept);
 * - 'dropped': it waited too long in the queue (first-pass text kept);
 * - 'failed': decoding threw (first-pass text kept).
 */
export type RefineStatus = 'refined' | 'no-speech' | 'dropped' | 'failed';

/** Running statistics of the second-pass worker (cumulative since it loaded). */
export interface SecondPassStats {
  /** Jobs received. */
  jobs: number;
  /** Jobs per outcome. */
  outcomes: Record<RefineStatus, number>;
  /** Audio received in jobs, in ms. */
  audioMs: number;
  /** Audio actually decoded (after the VAD trimmed silence), in ms. */
  speechMs: number;
  /** Time spent in the VAD, in ms. */
  vadMs: number;
  /** Time spent decoding, in ms. */
  decodeMs: number;
  /** Longest wait in the queue before a job started, in ms. */
  queueMsMax: number;
  /** Size of this worker's WebAssembly memory, in bytes (shared by its threads). */
  wasmMemoryBytes: number;
}

/** Page → second-pass worker messages. */
export type ToSecondPass =
  | {
      /** Download (or read from the cache), verify, and start VAD and the recognizer. */
      type: 'load';
      /** Which model. */
      model: SecondPassModelId;
      /** Runtime files, from our own origin. */
      runtime: { loader: DownloadFile; wasm: DownloadFile; api: DownloadFile; vad: DownloadFile };
      /** Silero VAD model, from our own origin. */
      vad: DownloadFile;
      /** Model files, keyed as in the model's `files` (models.ts). */
      files: Record<string, DownloadFile>;
      /** Hotwords buffer from formatHotwords() ('' for none; used only by transducer models). */
      hotwords: string;
      /** Port the streaming worker posts SecondPassJob messages to. */
      jobs: MessagePort;
    }
  | {
      /** Replace the hotwords (re-creates the recognizer between jobs; no-op without hotwords). */
      type: 'set-hotwords';
      /** Hotwords buffer. Never logged. */
      hotwords: string;
    }
  | {
      /** Cancel any download, drop queued jobs and release everything. */
      type: 'stop';
    };

/** Second-pass worker → page messages. */
export type FromSecondPass =
  | {
      /** Download progress across this worker's files. */
      type: 'progress';
      /** The progress. */
      progress: DownloadProgress;
    }
  | {
      /** VAD and recognizer are ready. */
      type: 'ready';
      /** How loading went. */
      load: LoadStats;
    }
  | {
      /** New hotwords are in use. */
      type: 'hotwords-set';
      /** How long it took, in ms. */
      ms: number;
    }
  | {
      /** The result of one job. */
      type: 'refined';
      /** The utterance id. */
      segmentId: string;
      /** Which channel. */
      channel: ChannelId;
      /** New text ('' unless status is 'refined'). Never logged. */
      text: string;
      /** How the job ended. */
      status: RefineStatus;
      /** End of speech (Unix ms), from the job. */
      speechEnd: number;
      /** Job audio, in ms. */
      audioMs: number;
      /** Audio decoded after VAD trimming, in ms. */
      speechMs: number;
      /** VAD time, in ms. */
      vadMs: number;
      /** Decode time, in ms. */
      decodeMs: number;
      /** Time from the streaming worker sending the job to decoding starting, in ms. */
      queuedMs: number;
    }
  | {
      /** Updated statistics (about once a second while loaded). */
      type: 'stats';
      /** The statistics. */
      stats: SecondPassStats;
    }
  | {
      /** Loading or decoding failed. */
      type: 'error';
      /** What kind of failure. */
      code: EngineErrorCode;
      /** Explanation (file names and sizes only; no transcript text). */
      message: string;
    };
