/**
 * Tests for apps/web/src/core/stt/channel.ts (ChannelDecoder), with a scripted fake recognizer:
 * partial text is posted when it changes; the model's endpoint ends an utterance with reset();
 * the pause rule ends it after 1.2 s of audio with no new words (and flushes the decoder
 * first); flush() and reset() behave as documented; lag is measured from the detected onset;
 * tStart/tEnd are Unix ms; statistics add up; each channel keeps its own state; with the
 * energy gate on (the default), silent chunks are not decoded and the held-back pre-roll is fed
 * when speech starts. Most tests turn the gate off to test the rules on their own. Lag is measured
 * from the LATEST onset before text appears (background noise without text does not count),
 * and each utterance records the gate's added delay.
 */
import { describe, expect, it } from 'vitest';
import {
  ChannelDecoder,
  PAUSE_END_MS,
  type ChannelEvent,
  type RecognizerLike,
  type StreamLike,
} from '@/core/stt/channel';

/** 100 ms of 16 kHz audio. */
const CHUNK = 1_600;

/** Quiet and loud chunks (for the onset detector). */
const quiet = () => new Float32Array(CHUNK).fill(0.001);
const loud = () => Float32Array.from({ length: CHUNK }, (_, i) => 0.3 * Math.sin(i / 3));

/**
 * A fake recognizer whose text follows a script: script[n] is the text after the n-th chunk
 * (the last entry repeats). `endpointAt` lists chunk numbers where isEndpoint() is true.
 */
function fakeRecognizer(script: string[], endpointAt: number[] = [], flushText?: string) {
  const calls = { resets: 0, created: 0, finished: 0, freed: 0 };
  let chunk = -1;
  let finished = false;
  let offset = 0; // text index offset after a reset (a new utterance)
  const recognizer: RecognizerLike = {
    createStream(): StreamLike {
      calls.created += 1;
      finished = false;
      return {
        acceptWaveform: () => {
          chunk += 1;
        },
        inputFinished: () => {
          calls.finished += 1;
          finished = true;
        },
        free: () => {
          calls.freed += 1;
          offset = chunk + 1;
        },
      };
    },
    isReady: () => false,
    decode: () => {},
    isEndpoint: () => endpointAt.includes(chunk),
    reset: () => {
      calls.resets += 1;
      offset = chunk + 1;
    },
    getResult: () => {
      if (finished && flushText !== undefined) return { text: flushText };
      const index = chunk - offset;
      return { text: index < 0 ? '' : (script[Math.min(index, script.length - 1)] ?? '') };
    },
  };
  return { recognizer, calls };
}

/** A clock that advances 1 ms per call (so decode times are small and positive). */
function fakeClock(start = 10_000) {
  let now = start;
  return { now: () => (now += 1), timeOrigin: 1_700_000_000_000 };
}

describe('ChannelDecoder', () => {
  it('posts partial text when it changes, and a final line at the model endpoint', () => {
    const { recognizer, calls } = fakeRecognizer(['', 'HELLO', 'HELLO THERE'], [3]);
    const events: ChannelEvent[] = [];
    const decoder = new ChannelDecoder('them', recognizer, (e) => events.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    for (let i = 0; i < 4; i += 1) decoder.accept(loud(), i * 0.1 + 0.1);

    const partials = events.filter((e) => e.type === 'partial').map((e) => e.text);
    expect(partials).toEqual(['HELLO', 'HELLO THERE', '']);
    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ channel: 'them', text: 'HELLO THERE', reason: 'model' });
    expect(calls.resets).toBe(1);
    expect(decoder.snapshot().endpoints.model).toBe(1);
  });

  it('ends an utterance after 1.2 s of audio with no new words, flushing the decoder first', () => {
    const { recognizer, calls } = fakeRecognizer(['GOOD MORNING'], [], 'GOOD MORNING EVERYONE');
    const events: ChannelEvent[] = [];
    const decoder = new ChannelDecoder('you', recognizer, (e) => events.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    const chunksNeeded = PAUSE_END_MS / 100;
    for (let i = 0; i <= chunksNeeded; i += 1) decoder.accept(quiet(), i * 0.1 + 0.1);

    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ text: 'GOOD MORNING EVERYONE', reason: 'pause' });
    expect(calls.finished).toBe(1);
    // The finished stream was replaced by a new one.
    expect(calls.created).toBe(2);
  });

  it('does not use the pause rule while the words keep changing', () => {
    const script = Array.from({ length: 30 }, (_, i) => `WORD${'S'.repeat(i)}`);
    const { recognizer } = fakeRecognizer(script);
    const events: ChannelEvent[] = [];
    const decoder = new ChannelDecoder('you', recognizer, (e) => events.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    for (let i = 0; i < 30; i += 1) decoder.accept(loud(), i * 0.1 + 0.1);
    expect(events.some((e) => e.type === 'final')).toBe(false);
  });

  it('flush() posts the current text with reason "flush"; reset() drops it', () => {
    const first = fakeRecognizer(['PARTIAL TEXT'], [], 'PARTIAL TEXT');
    const events: ChannelEvent[] = [];
    const decoder = new ChannelDecoder('you', first.recognizer, (e) => events.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    decoder.accept(loud(), 0.1);
    decoder.flush();
    expect(events.filter((e) => e.type === 'final')).toEqual([
      expect.objectContaining({ text: 'PARTIAL TEXT', reason: 'flush' }),
    ]);

    const second = fakeRecognizer(['DROPPED']);
    const dropped: ChannelEvent[] = [];
    const other = new ChannelDecoder('them', second.recognizer, (e) => dropped.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    other.accept(loud(), 0.1);
    other.reset();
    expect(dropped.some((e) => e.type === 'final')).toBe(false);
    expect(dropped.at(-1)).toMatchObject({ type: 'partial', text: '' });
  });

  it('measures lag from the detected onset and gives Unix-ms times', () => {
    const { recognizer } = fakeRecognizer(['', '', '', '', '', '', 'HI'], [7]);
    const events: ChannelEvent[] = [];
    const clock = fakeClock();
    const decoder = new ChannelDecoder('them', recognizer, (e) => events.push(e), {
      clock,
      gate: null,
    });
    for (let i = 0; i < 6; i += 1) decoder.accept(quiet(), i * 0.1 + 0.1); // 0.6 s quiet
    decoder.accept(loud(), 0.7); // speech starts: onset
    decoder.accept(loud(), 0.8); // text appears
    const stats = decoder.snapshot();
    expect(stats.lagsMs).toHaveLength(1);
    expect(stats.lagsMs[0]).toBeGreaterThan(0);
    const final = events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.tStart).toBeGreaterThan(1_700_000_000_000);
    expect(final?.type === 'final' && final.tEnd >= final.tStart).toBe(true);
  });

  it('adds up audio and decode time per channel', () => {
    const { recognizer } = fakeRecognizer(['']);
    const decoder = new ChannelDecoder('you', recognizer, () => {}, {
      clock: fakeClock(),
      gate: null,
    });
    for (let i = 0; i < 10; i += 1) decoder.accept(quiet(), i * 0.1 + 0.1);
    const stats = decoder.snapshot();
    expect(stats.chunks).toBe(10);
    expect(stats.audioMs).toBe(1_000);
    expect(stats.rtf).toBeCloseTo(stats.decodeMs / 1_000);
    expect(stats.chunkMsMax).toBeGreaterThanOrEqual(stats.chunkMsAvg);
  });

  it('moves to a new recognizer (hotwords changed) and drops the current utterance', () => {
    const first = fakeRecognizer(['OLD']);
    const next = fakeRecognizer(['NEW']);
    const events: ChannelEvent[] = [];
    const decoder = new ChannelDecoder('you', first.recognizer, (e) => events.push(e), {
      clock: fakeClock(),
      gate: null,
    });
    decoder.accept(loud(), 0.1);
    decoder.useRecognizer(next.recognizer);
    expect(first.calls.freed).toBe(1);
    expect(next.calls.created).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'partial', text: '' });
  });

  it('with the gate on, skips silent chunks and feeds the pre-roll when speech starts', () => {
    const fed: number[] = [];
    let n = 0;
    const recognizer: RecognizerLike = {
      createStream: () => ({
        acceptWaveform: (_rate, samples) => fed.push(samples[0] ?? 0),
        inputFinished: () => {},
        free: () => {},
      }),
      isReady: () => false,
      decode: () => {},
      isEndpoint: () => false,
      reset: () => {},
      getResult: () => ({ text: n++ > 1_000 ? 'X' : '' }),
    };
    const decoder = new ChannelDecoder('you', recognizer, () => {}, { clock: fakeClock() });
    for (let i = 0; i < 20; i += 1) decoder.accept(new Float32Array(CHUNK), i * 0.1 + 0.1);
    expect(fed).toHaveLength(0);
    expect(decoder.snapshot().skippedMs).toBe(2_000);
    decoder.accept(loud(), 2.1);
    // 300 ms of held-back silence, then the loud chunk.
    expect(fed).toHaveLength(4);
    expect(decoder.snapshot().audioMs).toBe(2_100);
  });

  it('measures lag from the latest onset, ignoring an earlier sound that produced no text', () => {
    // Text appears only after the second burst (chunk 14).
    const script = [...new Array(14).fill(''), 'HI'];
    const { recognizer } = fakeRecognizer(script);
    // A clock that follows the audio: "now" = capture time of the latest chunk + 5 ms.
    let audioMs = 0;
    const clock = { now: () => audioMs + 5, timeOrigin: 1_700_000_000_000 };
    const decoder = new ChannelDecoder('you', recognizer, () => {}, { clock, gate: null });
    const feed = (samples: Float32Array) => {
      audioMs += 100;
      decoder.accept(samples, audioMs / 1000);
    };
    for (let i = 0; i < 6; i += 1) feed(quiet());
    feed(loud()); // background sound: onset, but no text
    for (let i = 0; i < 6; i += 1) feed(quiet());
    feed(loud()); // the real start of speech
    feed(loud()); // text appears
    const stats = decoder.snapshot();
    expect(stats.lagsMs).toHaveLength(1);
    // From the second onset (~200 ms), not the first (~900 ms).
    expect(stats.lagsMs[0]).toBeLessThan(300);
  });

  it('records the gate delay per utterance (0 when the gate opens in the onset chunk)', () => {
    // Text appears on the 4th decoded chunk: 3 pre-roll chunks + the loud chunk.
    const { recognizer } = fakeRecognizer(['', '', '', 'HI']);
    let audioMs = 0;
    const clock = { now: () => audioMs + 5, timeOrigin: 1_700_000_000_000 };
    const decoder = new ChannelDecoder('you', recognizer, () => {}, { clock });
    const feed = (samples: Float32Array) => {
      audioMs += 100;
      decoder.accept(samples, audioMs / 1000);
    };
    for (let i = 0; i < 20; i += 1) feed(new Float32Array(CHUNK));
    feed(loud());
    expect(decoder.snapshot().gateDelaysMs).toEqual([0]);
    expect(decoder.snapshot().lagsMs).toHaveLength(1);
  });
});
