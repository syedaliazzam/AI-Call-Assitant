/**
 * File: apps/web/src/core/audio/recordingStream.ts
 * Purpose: Plays recordings (WAV files) in a loop into a MediaStream, without sending them to the
 *          speakers. /dev/stt-test uses it as a repeatable "Them" channel with the official test
 *          recordings, so two channels can be measured before real call capture exists (Stage 2).
 * Used by: src/features/dev/SttTest.tsx
 * Depends on: fetch, Web Audio (AudioContext, MediaStreamAudioDestinationNode); injectable
 * Architecture: docs/architecture/kite-architecture-v3.1.md §7.1 (core/audio)
 *
 * Only official, licence-clear recordings are used (models.ts TEST_RECORDINGS), never the
 * developer's voice.
 */

/** Silence between recordings in the loop, in seconds (gives each utterance an end). */
export const GAP_SECONDS = 2;

/** A running recording stream. */
export interface RecordingStream {
  /** The stream (one audio track). */
  stream: MediaStream;
  /** Stops playback and closes the audio context. */
  stop: () => void;
}

/** Web Audio objects used (injectable for tests). */
export interface RecordingDeps {
  /** fetch(). */
  fetch: typeof fetch;
  /** Creates the AudioContext the recordings play in. */
  createAudioContext: () => AudioContext;
}

/**
 * Joins decoded recordings into one buffer with GAP_SECONDS of silence after each.
 *
 * @param context The audio context (creates the buffer).
 * @param parts   Decoded recordings.
 * @returns One mono buffer.
 * Called from: createRecordingStream(); tests
 */
export function joinWithGaps(
  context: BaseAudioContext,
  parts: readonly AudioBuffer[],
): AudioBuffer {
  const rate = context.sampleRate;
  const gap = Math.round(GAP_SECONDS * rate);
  const length = parts.reduce((sum, part) => sum + part.length + gap, 0);
  const joined = context.createBuffer(1, Math.max(1, length), rate);
  const out = joined.getChannelData(0);
  let offset = 0;
  for (const part of parts) {
    out.set(part.getChannelData(0), offset);
    offset += part.length + gap;
  }
  return joined;
}

/**
 * Fetches and decodes the recordings, then plays them in a loop into a new MediaStream.
 *
 * @param urls URLs of the recordings (played in order, then again).
 * @param deps Browser objects (tests only).
 * @returns The stream and a stop function.
 * @throws Error if a recording cannot be fetched or decoded.
 * Called from: SttTest.tsx ("Them: test recordings")
 */
export async function createRecordingStream(
  urls: readonly string[],
  deps: RecordingDeps = {
    fetch: globalThis.fetch.bind(globalThis),
    createAudioContext: () => new AudioContext(),
  },
): Promise<RecordingStream> {
  const context = deps.createAudioContext();
  try {
    const parts: AudioBuffer[] = [];
    for (const url of urls) {
      const response = await deps.fetch(url);
      if (!response.ok) throw new Error(`Could not load recording (HTTP ${response.status})`);
      // decodeAudioData also resamples to the context's rate.
      parts.push(await context.decodeAudioData(await response.arrayBuffer()));
    }
    const source = context.createBufferSource();
    source.buffer = joinWithGaps(context, parts);
    source.loop = true;
    // Into a stream only: never connected to context.destination (the speakers).
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    source.start();
    return {
      stream: destination.stream,
      stop: () => {
        source.stop();
        for (const track of destination.stream.getTracks()) track.stop();
        void context.close();
      },
    };
  } catch (error) {
    void context.close();
    throw error;
  }
}
