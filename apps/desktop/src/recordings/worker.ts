/**
 * File: apps/desktop/src/recordings/worker.ts
 * Purpose: The background process that finalises a recording (desktop 1.5.0, ADR-0068). MediaRecorder
 *          writes Matroska/WebM piece by piece with no length and no seek index; this rewrites a finished
 *          file with both, without re-encoding (Mediabunny's conversion copies the encoded frames), so
 *          the player can seek and every player shows the length; and makes an MP4 copy for Save as….
 *          Runs in an Electron utility process,
 *          so a long file never blocks the app's windows.
 * Used by: src/recordings/host.ts (forked as dist/recording-worker.js)
 * Depends on: mediabunny (MPL-2.0; reads and writes Matroska/WebM), node:fs
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md (Phase 0: measured on a 20-minute file)
 * Never reads or logs what a file holds: only its length and the time taken.
 */
import { statSync } from 'node:fs';
import {
  ALL_FORMATS,
  Conversion,
  FilePathSource,
  FilePathTarget,
  Input,
  MkvOutputFormat,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
} from 'mediabunny';

/** A request from the host. */
export interface FinaliseRequest {
  /** Matches the reply to the request. */
  id: number;
  /** The file as MediaRecorder wrote it. */
  input: string;
  /** Where the finalised copy goes (the host renames it over the input). */
  output: string;
  /** The container to write: the input's own (finalising), or 'mp4' (Save as… MP4, a copy). */
  container: 'mkv' | 'webm' | 'mp4';
}

/** A reply to the host. */
export type FinaliseReply =
  | {
      /** Done. */
      type: 'done';
      /** The request's id. */
      id: number;
      /** The file's length, ms. */
      durationMs: number;
      /** How long it took, ms. */
      ms: number;
      /** The finalised file's size, bytes. */
      bytes: number;
    }
  | {
      /** It could not be finalised (the original stays). */
      type: 'failed';
      /** The request's id. */
      id: number;
      /** The error's message (no content in it). */
      message: string;
    };

/**
 * Finalises one file.
 * @param request The request.
 * @returns The reply.
 * Called from: the parentPort listener below; tests
 */
export async function finaliseFile(request: FinaliseRequest): Promise<FinaliseReply> {
  const started = performance.now();
  const input = new Input({ source: new FilePathSource(request.input), formats: ALL_FORMATS });
  try {
    const output = new Output({
      // WebM is the Matroska subset for VP8/Opus; .mkv keeps H.264. MP4 (Save as…) keeps H.264 and
      // Opus as they are, with the index at the end (fine for a local file; measured 0.9 s for 20 min).
      format:
        request.container === 'webm'
          ? new WebMOutputFormat()
          : request.container === 'mp4'
            ? new Mp4OutputFormat({ fastStart: false })
            : new MkvOutputFormat(),
      target: new FilePathTarget(request.output),
    });
    const conversion = await Conversion.init({ input, output, showWarnings: false });
    if (!conversion.isValid) {
      return { type: 'failed', id: request.id, message: 'no track can be copied' };
    }
    await conversion.execute();
    // The length from the finalised file, which now records it.
    const check = new Input({ source: new FilePathSource(request.output), formats: ALL_FORMATS });
    const seconds = await check.computeDuration();
    check.dispose();
    return {
      type: 'done',
      id: request.id,
      durationMs: Math.round(seconds * 1000),
      ms: Math.round(performance.now() - started),
      bytes: statSync(request.output).size,
    };
  } catch (error) {
    return {
      type: 'failed',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    input.dispose();
  }
}

/** The utility process's port to the host (absent when this file is imported by tests). */
const parentPort = (
  process as unknown as {
    /** Electron's utility-process port. */
    parentPort?: {
      /** Listens for requests. */
      on: (event: 'message', listener: (event: { data: FinaliseRequest }) => void) => void;
      /** Sends a reply. */
      postMessage: (message: FinaliseReply) => void;
    };
  }
).parentPort;
// One file at a time, in the order asked: finalising is disk-bound, and two at once only compete.
let queue: Promise<unknown> = Promise.resolve();
parentPort?.on('message', (event) => {
  queue = queue.then(async () => parentPort.postMessage(await finaliseFile(event.data)));
});
