/**
 * File: apps/web/src/core/stt/audioProtocol.ts
 * Purpose: The messages between the page (cloudStt.ts) and the light audio worker (audio.worker.ts) of
 *          cloud transcription (ADR-0076). Chunks hold call audio: they are never logged.
 * Used by: src/core/stt/audio.worker.ts, src/core/stt/cloudStt.ts
 * Depends on: src/core/stt/models.ts (DownloadFile), src/core/stt/protocol.ts (ChannelId)
 * Architecture: docs/investigations/2026-11-13-production-readiness.md C1; ADR-0076
 */
import type { DownloadFile } from './models';
import type { ChannelId } from './protocol';

/** Page → audio worker. */
export type ToAudioWorker =
  | {
      /** Start: load the echo canceller (when its files are given) and report its state each second. */
      type: 'init';
      /** The AEC3 loader and .wasm (models.ts aecDownloads), or absent for none. */
      aec?: {
        /** The Emscripten loader script. */
        loader: DownloadFile;
        /** The AEC3 WebAssembly. */
        wasm: DownloadFile;
      };
    }
  | {
      /** A channel's worklet port (its 80 ms chunks arrive here, never through the main thread). */
      type: 'attach';
      /** Which channel. */
      channel: ChannelId;
      /** The port the worklet posts `{ samples, endTime }` to. */
      port: MessagePort;
    }
  | {
      /** A channel stopped: its port closes; waiting microphone chunks are sent. */
      type: 'detach';
      /** Which channel. */
      channel: ChannelId;
    }
  | {
      /** The call ended: every port closes. */
      type: 'stop';
    };

/** Audio worker → page. */
export type FromAudioWorker =
  | {
      /** One cleaned 80 ms chunk of a channel. */
      type: 'chunk';
      /** Which channel. */
      channel: ChannelId;
      /** The chunk as 16-bit little-endian PCM, 16 kHz mono (what Deepgram receives). */
      pcm: ArrayBuffer;
      /** The same chunk as float samples (kept 10 s for the on-device fallback). */
      samples: Float32Array;
      /** Capture time of its last sample on the audio clock, seconds. */
      endTime: number;
      /** The call's capture clock: Unix ms minus audio-clock ms (captureClock.ts). */
      offsetMs: number;
    }
  | {
      /** The echo canceller's state: 'on', 'off' (not loaded yet, or none) or 'failed'. */
      type: 'echo';
      /** The state. */
      state: 'on' | 'off' | 'failed';
    };
