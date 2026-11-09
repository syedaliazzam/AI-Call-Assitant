/**
 * File: apps/web/src/core/turn/model.ts
 * Purpose: The pinned file of the end-of-turn model (v1.4, ADR-0065): Pipecat's Smart Turn v3.2 (CPU,
 *          int8, 8.7 MB, BSD-2-Clause), which hears from the last 8 s of the other person's audio whether
 *          they have finished speaking or only paused. Served from our own origin like the punctuation
 *          model (the build fetches and checks it), and run by the same ONNX Runtime WebAssembly build, so
 *          nothing about a call leaves the device.
 * Used by: src/core/turn/turn.worker.ts, scripts/fetch-models.ts
 * Depends on: src/core/stt/models.ts (PinnedFile), src/core/punctuation/model.ts (the runtime's place)
 * Architecture: docs/decisions/ADR-0065-end-of-question-and-none-replies.md
 */
import type { PinnedFile } from '../stt/models';

/** Public URL folder of the turn model on our own origin. */
export const TURN_PUBLIC_PATH = '/turn';

/** The model: one file, from a fixed Hugging Face commit. */
export const TURN_MODEL_FILE: PinnedFile = {
  name: 'smart-turn-v3.2-cpu.onnx',
  url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/f766f81d3cfdf7737ac64aad813d91bbfd56bf93/smart-turn-v3.2-cpu.onnx',
  bytes: 8_679_182,
  sha256: '2bb026316b14a660486a75b1733cd3fbab8c2fd0314dc9af7be49f8cca967e4f',
};

/** The model's input tensor (Whisper log-mel features, [1, 80, 800]). */
export const TURN_INPUT_NAME = 'input_features';

/** At or above this probability the speaker has finished (Smart Turn's own threshold). */
export const TURN_COMPLETE_AT = 0.5;
