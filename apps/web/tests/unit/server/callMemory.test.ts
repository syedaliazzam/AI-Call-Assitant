/**
 * Tests for apps/web/src/server/callMemory.ts and parseCallMemoryRequest() in
 * apps/web/src/server/validate.ts (ADR-0137): the prompt (what the call is, the memory so far, the new lines
 * with times and speakers, angle brackets defused), the fast model's settings, a reply trimmed and kept to
 * MAX_CALL_MEMORY_CHARS at a line break, EmptyMemoryError for an empty reply, and the request's validation.
 * Claude is never called (a fake reply). All words are invented.
 */
import { MAX_CALL_MEMORY_CHARS, type CallMemoryRequest } from '@kite/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  EmptyMemoryError,
  MEMORY_MAX_TOKENS,
  MEMORY_RULES,
  memoryPrompt,
  updateCallMemory,
} from '@/server/callMemory';
import { parseCallMemoryRequest } from '@/server/validate';

/** An invented update request. */
const REQUEST: CallMemoryRequest = {
  session: { type: 'sales', company: 'Northwind (invented)', role: 'Lead' },
  previous: 'Key points:\n- Budget owner: Dana.',
  lines: [
    { speaker: 'them', text: 'The deadline is the end of <March>.', at: 125 },
    { speaker: 'you', text: 'Noted.', at: 130 },
  ],
};

/** The usage a fake reply reports. */
const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

describe('memoryPrompt', () => {
  it('holds what the call is, the memory so far and the new lines, with times', () => {
    const prompt = memoryPrompt(REQUEST);
    expect(prompt).toContain('Company: Northwind (invented)');
    expect(prompt).toContain(
      '<memory_so_far>\nKey points:\n- Budget owner: Dana.\n</memory_so_far>',
    );
    expect(prompt).toContain('[02:05] Them: The deadline is the end of ‹March>.');
    expect(prompt).toContain('[02:10] You: Noted.');
    expect(memoryPrompt({ ...REQUEST, previous: '' })).toContain('(empty: this is the start');
  });

  it('asks for the four sections and nothing invented', () => {
    for (const section of [
      'Key points:',
      'Questions asked:',
      'What the user said:',
      'Open items:',
    ]) {
      expect(MEMORY_RULES).toContain(section);
    }
    expect(MEMORY_RULES).toContain('Never add anything that was not said');
  });
});

describe('updateCallMemory', () => {
  it('asks the fast model and returns the trimmed memory', async () => {
    const reply = vi.fn(async () => ({
      text: '  Key points:\n- x  ',
      usage: USAGE,
      stopReason: 'end_turn',
    }));
    const result = await updateCallMemory(REQUEST, 'fast-model', reply as never);
    expect(result.memory).toBe('Key points:\n- x');
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'fast-model', tier: 'fast', maxTokens: MEMORY_MAX_TOKENS }),
    );
  });

  it('keeps a long memory to its limit at a line break, and refuses an empty one', async () => {
    const long = Array.from({ length: 200 }, (_, i) => `- point ${i} about the route plan`).join(
      '\n',
    );
    const reply = vi.fn(async () => ({ text: long, usage: USAGE, stopReason: 'max_tokens' }));
    const { memory } = await updateCallMemory(REQUEST, 'm', reply as never);
    expect(memory.length).toBeLessThanOrEqual(MAX_CALL_MEMORY_CHARS);
    expect(memory.endsWith('route plan')).toBe(true);
    const empty = vi.fn(async () => ({ text: ' ', usage: USAGE, stopReason: 'end_turn' }));
    await expect(updateCallMemory(REQUEST, 'm', empty as never)).rejects.toBeInstanceOf(
      EmptyMemoryError,
    );
  });
});

describe('parseCallMemoryRequest', () => {
  it('accepts a valid request and refuses no lines, unknown fields or a memory over its limit', () => {
    expect(parseCallMemoryRequest(REQUEST).ok).toBe(true);
    expect(parseCallMemoryRequest({ ...REQUEST, lines: [] }).ok).toBe(false);
    expect(parseCallMemoryRequest({ ...REQUEST, extra: 1 }).ok).toBe(false);
    expect(
      parseCallMemoryRequest({ ...REQUEST, previous: 'x'.repeat(MAX_CALL_MEMORY_CHARS + 1) }).ok,
    ).toBe(false);
  });
});
