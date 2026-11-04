/**
 * Tests the accurate second pass (v1.0.1, ADR-0034): transcript.refineFinal() in
 * apps/web/src/core/transcript/transcript.ts replaces only the words one utterance added (a line
 * can hold merged utterances) and refuses a line that is gone or no longer holds them; refineLine()
 * in core/transcript/refine.ts puts the accurate text in the line, and keeps the live text when the
 * engine is not ready, fails or throws. All text is invented.
 */
import { describe, expect, it, vi } from 'vitest';
import { refineLine } from '@/core/transcript/refine';
import { createTranscript } from '@/core/transcript/transcript';

const AUDIO = new Float32Array(16_000);

describe('refineFinal', () => {
  it("replaces the heard words with the accurate engine's text", () => {
    const transcript = createTranscript();
    const line = transcript.addFinal({
      speaker: 'them',
      text: 'WE USE BM TWENTY FIVE FOR RANKING',
      tStart: 1_000,
      tEnd: 3_000,
    });
    expect(
      transcript.refineFinal(
        line.id,
        'WE USE BM TWENTY FIVE FOR RANKING',
        'We use BM25 for ranking.',
      ),
    ).toBe(true);
    expect(transcript.allLines()[0]!.text).toBe('We use BM25 for ranking.');
  });

  it('replaces only the last place the words appear in a merged line', () => {
    const transcript = createTranscript();
    const line = { speaker: 'them' as const, text: 'FIRST PART', tStart: 1_000, tEnd: 2_000 };
    const stored = transcript.addFinal(line);
    // Close enough to merge into the same line.
    const merged = transcript.addFinal({
      speaker: 'them',
      text: 'SECOND PART',
      tStart: 2_200,
      tEnd: 3_000,
    });
    expect(merged.id).toBe(stored.id);
    expect(transcript.refineFinal(merged.id, 'SECOND PART', 'Second part.')).toBe(true);
    expect(transcript.allLines()[0]!.text).toMatch(/^FIRST PART.*Second part\.$/);
  });

  it('refuses a line that is gone or no longer holds the words', () => {
    const transcript = createTranscript();
    const line = transcript.addFinal({ speaker: 'you', text: 'HELLO', tStart: 1_000, tEnd: 2_000 });
    expect(transcript.refineFinal('u-none', 'HELLO', 'Hello.')).toBe(false);
    expect(transcript.refineFinal(line.id, 'GOODBYE', 'Goodbye.')).toBe(false);
    expect(transcript.allLines()[0]!.text).toBe('HELLO');
  });
});

describe('refineLine', () => {
  it('puts the accurate text in the line', async () => {
    const transcript = { refineFinal: vi.fn(() => true) };
    const engine = {
      transcribe: vi.fn(async () => ({ ok: true as const, text: 'Hello.', ms: 900 })),
    };
    expect(await refineLine(engine, transcript, 'u1', 'HELLO', AUDIO)).toBe(true);
    expect(transcript.refineFinal).toHaveBeenCalledWith('u1', 'HELLO', 'Hello.');
  });

  it('keeps the live line when the engine is not ready, fails or throws', async () => {
    const transcript = { refineFinal: vi.fn(() => true) };
    for (const transcribe of [
      async () => ({ ok: false as const, code: 'not-ready' as const }),
      async () => ({ ok: false as const, code: 'engine' as const }),
      async () => {
        throw new Error('ipc');
      },
    ]) {
      expect(await refineLine({ transcribe }, transcript, 'u1', 'HELLO', AUDIO)).toBe(false);
    }
    expect(transcript.refineFinal).not.toHaveBeenCalled();
  });
});

describe('key terms in the accurate pass (v1.1.0, item 22)', () => {
  it('puts the session key terms back in what the engine wrote', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const refineFinal = vi.fn(() => true);
    await refineLine(
      { transcribe: async () => ({ ok: true, text: "The Cabernet's rollout.", ms: 5 }) },
      { refineFinal },
      'u1',
      'THE ROLLOUT',
      new Float32Array(1),
      ['Kubernetes'],
    );
    expect(refineFinal).toHaveBeenCalledWith('u1', 'THE ROLLOUT', 'The Kubernetes rollout.');
    vi.restoreAllMocks();
  });
});
