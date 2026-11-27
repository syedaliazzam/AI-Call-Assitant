/**
 * Tests for apps/web/src/core/answer/callMemory.ts (ADR-0137): when the call memory is updated (enough new
 * final words, or some after a few minutes; never while one is in flight, too soon after the last, or soon
 * after a failure), which lines go with the update (final, after the memory's last line, no gaps or other
 * languages), the request body (times in seconds since the call started), and the client (the memory, or null
 * on any failure). All words are invented.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  emptyMemory,
  MEMORY_MIN_GAP_MS,
  MEMORY_RETRY_MS,
  MEMORY_STALE_MS,
  memoryDue,
  memoryRequest,
  requestCallMemory,
} from '@/core/answer/callMemory';
import type { Utterance } from '@/core/transcript/transcript';

/** The call's clock: second s, as Unix ms. */
const T = 1_800_000_000_000;
const at = (seconds: number) => T + seconds * 1_000;

/**
 * A final line of n words.
 *
 * @param id      Its id.
 * @param words   How many words.
 * @param start   Start, s.
 * @param extra   More fields.
 * @returns The line.
 */
function line(id: string, words: number, start: number, extra: Partial<Utterance> = {}): Utterance {
  return {
    id,
    speaker: 'them',
    text: Array.from({ length: words }, () => 'route').join(' '),
    tStart: at(start),
    tEnd: at(start + 5),
    final: true,
    ...extra,
  };
}

describe('memoryDue (ADR-0137)', () => {
  it('waits for enough new words, then sends the final lines after the memory', () => {
    const few = [line('a', 100, 10), line('b', 100, 20)];
    expect(memoryDue(emptyMemory(), few, at(30))).toBeNull();
    const enough = [...few, line('c', 60, 30), line('grey', 50, 40, { final: false })];
    expect(memoryDue(emptyMemory(), enough, at(40))?.map((l) => l.id)).toEqual(['a', 'b', 'c']);
    // Lines the memory already covers are not sent again.
    const state = { ...emptyMemory(), text: 'm', until: at(25), lastAt: at(0) };
    expect(memoryDue(state, [...enough, line('d', 300, 100)], at(200))?.map((l) => l.id)).toEqual([
      'c',
      'd',
    ]);
  });

  it('updates with a few words once MEMORY_STALE_MS has passed', () => {
    const lines = [line('a', 40, 10)];
    expect(memoryDue(emptyMemory(), lines, at(60))).toBeNull();
    expect(memoryDue(emptyMemory(), lines, at(10) + MEMORY_STALE_MS)).not.toBeNull();
  });

  it('never while one is in flight, too soon after the last, or soon after a failure', () => {
    const lines = [line('a', 300, 10)];
    expect(memoryDue({ ...emptyMemory(), inFlight: true }, lines, at(100))).toBeNull();
    expect(
      memoryDue({ ...emptyMemory(), lastAt: at(100) }, lines, at(100) + MEMORY_MIN_GAP_MS - 1),
    ).toBeNull();
    expect(
      memoryDue({ ...emptyMemory(), failedAt: at(100) }, lines, at(100) + MEMORY_RETRY_MS - 1),
    ).toBeNull();
  });

  it('leaves out gaps and other languages', () => {
    const lines = [line('a', 300, 10, { gap: true }), line('b', 300, 20, { nonEnglish: true })];
    expect(memoryDue(emptyMemory(), lines, at(400))).toBeNull();
  });
});

describe('memoryRequest and requestCallMemory (ADR-0137)', () => {
  it('builds the body with times in seconds since the call started', () => {
    const body = memoryRequest(
      { type: 'sales', company: 'Northwind (invented)', role: 'Lead' },
      'Key points:',
      [line('a', 3, 65)],
      at(0),
    );
    expect(body).toEqual({
      session: { type: 'sales', company: 'Northwind (invented)', role: 'Lead' },
      previous: 'Key points:',
      lines: [{ speaker: 'them', text: 'route route route', at: 65 }],
    });
  });

  it('returns the memory, or null on any failure', async () => {
    const body = memoryRequest({ type: '', company: '', role: '' }, '', [line('a', 3, 1)], at(0));
    const ok = vi.fn(async () => Response.json({ memory: 'Key points:\n- x', usage: {}, ms: 5 }));
    expect(await requestCallMemory(body, ok as unknown as typeof fetch)).toBe('Key points:\n- x');
    const failed = vi.fn(async () => new Response('no', { status: 502 }));
    expect(await requestCallMemory(body, failed as unknown as typeof fetch)).toBeNull();
    const thrown = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await requestCallMemory(body, thrown as unknown as typeof fetch)).toBeNull();
  });
});
