/**
 * Tests for apps/web/src/core/voice/speak.ts (item 8, ADR-0038), with a fake speechSynthesis: only
 * the readable words are spoken (no code, Markdown marks, links or hidden lines); long replies are
 * cut at a sentence end and split into short pieces; onEnd runs once after the last piece (also on
 * an error), never after stop(); a new reply replaces the one being read; no synthesiser means
 * unsupported and silent.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createSpeaker,
  MAX_PIECE_CHARS,
  MAX_SPOKEN_CHARS,
  readableText,
  speechPieces,
} from '@/core/voice/speak';

/** A fake utterance: its text and the handlers the speaker sets. */
interface FakeUtterance {
  /** The piece of text. */
  text: string;
  /** Set by the speaker on the last piece. */
  onend: (() => void) | null;
  /** Set by the speaker on the last piece. */
  onerror: (() => void) | null;
}

/**
 * A speaker over a fake synthesiser that records what it is given.
 *
 * @returns The speaker, the queued utterances and the cancel spy.
 */
function setup() {
  const queued: FakeUtterance[] = [];
  const cancel = vi.fn(() => queued.splice(0));
  const speaker = createSpeaker({
    synth: {
      speak: (utterance) => queued.push(utterance as unknown as FakeUtterance),
      cancel,
    },
    createUtterance: (text) =>
      ({ text, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
  });
  return { speaker, queued, cancel };
}

describe('readableText', () => {
  it('keeps the words and drops code, marks, links and hidden lines', () => {
    const text = [
      '[[concept|kite|general]]',
      '# A **hash map** stores pairs.',
      '- It uses `hash()` to find a [bucket](https://example.com).',
      '```python',
      'print(1)',
      '```',
    ].join('\n');
    const plain = readableText(text);
    expect(plain).toContain('A hash map stores pairs.');
    expect(plain).toContain('It uses hash() to find a bucket');
    expect(plain).toContain('The code is on screen.');
    expect(plain).not.toMatch(/\[\[|```|\*\*|https|print\(1\)/);
  });

  it('cuts a long reply at a sentence end', () => {
    const long = 'This is one sentence of the reply. '.repeat(100);
    const plain = readableText(long);
    expect(plain.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(plain.endsWith('.')).toBe(true);
  });
});

describe('speechPieces', () => {
  it('splits into short pieces at sentence ends, and long sentences at spaces', () => {
    const pieces = speechPieces(`${'word '.repeat(100)}. Short one.`);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX_PIECE_CHARS);
    expect(pieces.join(' ')).toContain('Short one.');
  });

  it('gives nothing for empty text', () => {
    expect(speechPieces('')).toEqual([]);
  });
});

describe('createSpeaker', () => {
  it('speaks the pieces and calls onEnd once, after the last one', () => {
    const { speaker, queued } = setup();
    const onEnd = vi.fn();
    speaker.speak(`${'A sentence that goes on for a while. '.repeat(10)}`, { onEnd });
    expect(queued.length).toBeGreaterThan(1);
    expect(speaker.speaking()).toBe(true);
    queued[0]!.onend?.();
    expect(onEnd).not.toHaveBeenCalled();
    queued.at(-1)!.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(speaker.speaking()).toBe(false);
  });

  it('treats an error on the last piece as the end', () => {
    const { speaker, queued } = setup();
    const onEnd = vi.fn();
    speaker.speak('Hello there.', { onEnd });
    queued.at(-1)!.onerror?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('does not call onEnd after stop()', () => {
    const { speaker, queued, cancel } = setup();
    const onEnd = vi.fn();
    speaker.speak('Hello there.', { onEnd });
    const last = queued.at(-1)!;
    speaker.stop();
    expect(cancel).toHaveBeenCalled();
    last.onend?.();
    expect(onEnd).not.toHaveBeenCalled();
    expect(speaker.speaking()).toBe(false);
  });

  it('a new reply replaces the one being read', () => {
    const { speaker, queued, cancel } = setup();
    const first = vi.fn();
    speaker.speak('First reply.', { onEnd: first });
    const old = queued.at(-1)!;
    speaker.speak('Second reply.');
    expect(cancel).toHaveBeenCalled();
    old.onend?.();
    expect(first).not.toHaveBeenCalled();
    expect(queued.map((item) => item.text)).toEqual(['Second reply.']);
  });

  it('is unsupported and silent without a synthesiser', () => {
    const speaker = createSpeaker({
      synth: null,
      createUtterance: () => ({}) as SpeechSynthesisUtterance,
    });
    const onEnd = vi.fn();
    expect(speaker.supported()).toBe(false);
    speaker.speak('Hello.', { onEnd });
    expect(onEnd).not.toHaveBeenCalled();
    expect(speaker.speaking()).toBe(false);
  });
});
