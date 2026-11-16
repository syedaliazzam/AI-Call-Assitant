/**
 * Tests for apps/web/src/server/prompts/builtIn.ts (ADR-0087): every block's built-in prompt matches the
 * hash recorded in BUILT_IN_REVISIONS, so a change to the built-in rules cannot ship without its date
 * (the date admins with a custom prompt are shown); the dates are real days; the hash depends only on
 * the prompt's bytes after cleaning.
 */
import { AI_INSTRUCTION_BLOCKS } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PROMPTS, BUILT_IN_REVISIONS, builtInHash } from '@/server/prompts/builtIn';

describe('built-in prompt revisions', () => {
  it.each(AI_INSTRUCTION_BLOCKS)(
    '%s: the built-in prompt is the recorded revision (if this fails, set the new hash AND the release day in BUILT_IN_REVISIONS)',
    (block) => {
      expect(builtInHash(block)).toBe(BUILT_IN_REVISIONS[block].sha256);
    },
  );

  it('dates each revision with a real day', () => {
    for (const block of AI_INSTRUCTION_BLOCKS) {
      const { date } = BUILT_IN_REVISIONS[block];
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
    }
  });

  it('hashes the cleaned bytes: line endings and outer spaces do not count, a word does', () => {
    const notes = BUILT_IN_PROMPTS.notes;
    expect(builtInHash('notes', { rules: `  ${notes.rules!.replaceAll('\n', '\r\n')}\n` })).toBe(
      builtInHash('notes'),
    );
    expect(builtInHash('notes', { rules: `${notes.rules!} More.` })).not.toBe(builtInHash('notes'));
  });
});
