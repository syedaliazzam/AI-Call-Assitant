/**
 * File: apps/web/src/core/stt/protocol.ts
 * Purpose: The messages exchanged between the page (sttClient.ts) and the speech-to-text Web
 *          Worker (stt.worker.ts), and the statistics they carry. Text fields hold transcript
 *          text and are never logged.
 * Used by: src/core/stt/sttClient.ts, src/core/stt/stt.worker.ts, src/features/dev/SttTest.tsx
 * Depends on: src/core/stt/models.ts (SttModelId)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/stt)
 */
import type { SttModelId } from './models';

/** How long loading took, and from where. */
export interface LoadStats {
  /** Which candidate was loaded. */
  model: SttModelId;
  /** Bytes fetched (from the network or the cache). */
  bytes: number;
  /** True when every file came from the browser's Cache Storage. */
  fromCache: boolean;
  /** Fetching all files (network or cache), in ms. */
  downloadMs: number;
  /** Compiling the WebAssembly and starting the runtime, in ms. */
  runtimeInitMs: number;
  /** Writing model files and creating the recognizer (model initialisation), in ms. */
  modelInitMs: number;
  /** Start of loading → recognizer ready, in ms. */
  totalMs: number;
}

/**
 * What ended an utterance:
 * - 'model': the recognizer's own endpoint rule (about 1 s of decoded silence after speech);
 * - 'pause': the worker's pause rule (no new words for 1.2 s of audio while text is showing),
 *   a safety net for when the model's rule does not fire (Day 1 retest, ADR-0020).
 */
export type EndpointReason = 'model' | 'pause';

/** Running statistics while transcribing. */
export interface LiveStats {
  /** Audio received so far, in ms. */
  audioMs: number;
  /** Time spent decoding it, in ms. */
  decodeMs: number;
  /** Real-time factor: decodeMs ÷ audioMs (single-threaded, so also the share of one CPU core). */
  rtf: number;
  /** Average processing time per ~100 ms chunk, in ms. */
  chunkMsAvg: number;
  /** Slowest chunk so far, in ms. */
  chunkMsMax: number;
  /** Lag from detected speech onset to the first partial text, per utterance, in ms. */
  lagsMs: number[];
  /** Sample rate the audio arrived at before resampling (the AudioContext rate). */
  inputSampleRate: number;
  /** How many utterances each rule ended. */
  endpoints: Record<EndpointReason, number>;
}

/** Page → worker messages. */
export type ToWorker =
  | {
      /** Load the runtime and the chosen model. */
      type: 'init';
      /** Which candidate. */
      model: SttModelId;
      /** Absolute URL of the /models/stt folder (workers need absolute URLs). */
      baseUrl: string;
      /**
       * Hotwords buffer from formatHotwords() ('' for none). Holds names from the session
       * (Day 3); never logged.
       */
      hotwords: string;
    }
  | {
      /** Port the audio worklet posts 16 kHz chunks to (see resampler.worklet.ts). */
      type: 'audio-port';
      /** The MessagePort. */
      port: MessagePort;
      /** Sample rate of the AudioContext feeding the worklet. */
      inputSampleRate: number;
    }
  | {
      /** Stop decoding and release the recognizer. */
      type: 'stop';
    };

/** Worker → page messages. */
export type FromWorker =
  | {
      /** Download progress for one file. */
      type: 'progress';
      /** File name. */
      file: string;
      /** Bytes received. */
      loaded: number;
      /** Expected bytes. */
      total: number;
    }
  | {
      /** The recognizer is ready. */
      type: 'ready';
      /** How loading went. */
      load: LoadStats;
    }
  | {
      /** Current, still-changing text of the utterance being spoken. */
      type: 'partial';
      /** Transcript text (never logged). */
      text: string;
    }
  | {
      /** The utterance ended (a pause; see EndpointReason). */
      type: 'final';
      /** Transcript text (never logged). */
      text: string;
      /** Which rule ended it. */
      reason: EndpointReason;
    }
  | {
      /** Updated statistics (about once a second). */
      type: 'stats';
      /** The statistics. */
      stats: LiveStats;
    }
  | {
      /** Loading or decoding failed. */
      type: 'error';
      /** What went wrong (no transcript text). */
      message: string;
    };
