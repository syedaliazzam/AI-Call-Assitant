/**
 * File: apps/web/tests/integration/harness/harness.ts
 * Purpose: Browser side of the speech-to-text integration test. Runs the app's real pipeline
 *          on the microphone channel: getUserMedia (Chromium's fake device playing a fixture WAV)
 *          → resampler worklet → stt.worker.ts → sherpa-onnx recognizer → transcript core. It
 *          exposes start/stop/snapshot on `window.kiteSttHarness` for the Playwright test.
 * Used by: tests/integration/stt.spec.ts (bundled with esbuild and served on a test page)
 * Depends on: src/core/stt/sttEngine.ts, src/core/transcript/transcript.ts, src/platform/media.ts
 * Architecture: docs/architecture/kite-architecture-v3.1.md §6.1 steps 1–2, §11; ADR-0020
 *
 * Why a harness and not /dev/stt-test: that page needs a signed-in admin (database, secrets),
 * which CI does not have. The harness uses the same modules as the app; only the React page and
 * sign-in are left out. The worker is bundled separately by the test (esbuild cannot follow
 * Next.js's `new Worker(new URL(...))`), so createWorker is the only replaced dependency.
 */
import { defaultSttEngineDeps, createSttEngine, type SttEngine } from '@/core/stt/sttEngine';
import type { EngineStats } from '@/core/stt/protocol';
import { createTranscript, type Transcript } from '@/core/transcript/transcript';
import { openMicrophone } from '@/platform/media';

/** What snapshot() returns: the transcript's final lines and the engine's numbers. */
export interface HarnessSnapshot {
  /** Text of each final line, in order (fixture speech only, never a person's call). */
  finals: string[];
  /** Current partial text of the "you" channel ('' when none). */
  partial: string;
  /** End of speech → final line latency of each final line, in ms. */
  latenciesMs: number[];
  /** Latest engine statistics, or null before the first. */
  stats: EngineStats | null;
  /** Engine errors (codes and file names only). */
  errors: string[];
}

/** The API the Playwright test calls through page.evaluate(). */
export interface KiteSttHarness {
  /** Loads the model from this origin (source 'local'), then opens the microphone. */
  start(): Promise<{ loadMs: number }>;
  /** Detaches the channel (its current text becomes a final line) and stops the engine. */
  stop(): Promise<void>;
  /** Current results. */
  snapshot(): HarnessSnapshot;
}

declare global {
  interface Window {
    /** Set by this harness when the page loads. */
    kiteSttHarness: KiteSttHarness;
  }
}

/** URL of the worker bundle the test serves next to the page. */
const WORKER_URL = '/harness/stt.worker.js';

let engine: SttEngine | null = null;
let mic: MediaStream | null = null;
let stats: EngineStats | null = null;
const transcript: Transcript = createTranscript();
const latenciesMs: number[] = [];
const errors: string[] = [];

window.kiteSttHarness = {
  async start() {
    const started = performance.now();
    engine = createSttEngine(
      {
        source: 'local',
        onPartial: ({ channel, text, tStart }) => transcript.addPartial(channel, text, tStart),
        onFinal: ({ channel, text, tStart, tEnd, latencyMs }) => {
          transcript.addFinal({ speaker: channel, text, tStart, tEnd });
          latenciesMs.push(latencyMs);
        },
        onStats: (next) => {
          stats = next;
        },
        onError: ({ code, message }) => errors.push(`${code}: ${message}`),
      },
      // Classic worker, like the app's (the runtime scripts need importScripts).
      { ...defaultSttEngineDeps(), createWorker: () => new Worker(WORKER_URL) },
    );
    await engine.ready;
    const loadMs = Math.round(performance.now() - started);
    // The microphone opens only after loading, so the fake device starts the WAV from its
    // beginning when the recognizer is ready (no speech is lost while the model loads).
    mic = await openMicrophone();
    await engine.attach('you', mic);
    return { loadMs };
  },

  async stop() {
    engine?.detach('you');
    // Give the worker time to post the flushed final line before the engine ends it.
    await new Promise((resolve) => setTimeout(resolve, 500));
    engine?.stop();
    for (const track of mic?.getTracks() ?? []) track.stop();
  },

  snapshot() {
    const all = transcript.allLines();
    const partial = transcript.lines().find((line) => !line.final && line.speaker === 'you');
    return {
      finals: all.filter((line) => line.final).map((line) => line.text),
      partial: partial?.text ?? '',
      latenciesMs: [...latenciesMs],
      stats,
      errors: [...errors],
    };
  },
};
