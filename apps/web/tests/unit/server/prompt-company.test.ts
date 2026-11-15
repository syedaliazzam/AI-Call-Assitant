/**
 * Tests for the company AI instructions in the prompts (ADR-0083): src/server/prompts/company.ts and its
 * use in src/server/prompt.ts (live answers), notes.ts, ask.ts and kite-chat.ts:
 * - no instructions: every prompt is byte for byte what it was before;
 * - the locked rules are always present and first;
 * - the order is locked rules → company instructions → learned preferences, and the session's own
 *   instructions come after, in the session block;
 * - the company text is inside the first cached block, and two requests of one call (the conversation
 *   growing, a new question) send the same cached prefix;
 * - the text is cleaned (line endings, outer spaces) so the same text gives the same bytes.
 */
import type { AnswerRequest, NotesRequest } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { ASK_RULES } from '@/server/ask';
import { buildKiteChatPrompt, KITE_CHAT_RULES } from '@/server/kite-chat';
import { NOTES_RULES, notesPrompt } from '@/server/notes';
import {
  CORE_RULES,
  LESSONS_HEADING,
  SYSTEM_RULES,
  SYSTEM_RULES_PREVIOUS,
  buildPrompt,
  rulesBlock,
} from '@/server/prompt';
import { CORE_RULES_PREVIOUS } from '@/server/prompts/rules-previous';
import {
  COMPANY_HEADINGS,
  companySection,
  normaliseInstructions,
  withCompany,
} from '@/server/prompts/company';

/** Invented company instructions. */
const COMPANY = 'Say customers, never users.\nKeep answers warm.';

/** An invented session. */
const SESSION: NonNullable<AnswerRequest['session']> = {
  type: 'sales',
  company: 'Northwind (invented)',
  role: 'Renewal',
  description: 'A renewal call.',
  instructions: 'Mention the annual plan.',
  keyTerms: ['Northwind'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'CV', text: 'Invented CV text.', kind: 'resume' }],
};

/** An invented answer request. */
const REQUEST: AnswerRequest = {
  mode: 'answer',
  session: SESSION,
  conversation: [[{ kind: 'line', speaker: 'them', text: 'Hello there.', at: 3 }]],
  tail: [{ speaker: 'them', text: 'What does it cost?', at: 9 }],
};

/** An invented notes request. */
const NOTES: NotesRequest = {
  session: SESSION,
  lines: [{ speaker: 'them', text: 'What does it cost?', at: 9 }],
  answers: [],
};

describe('no company instructions: nothing changes', () => {
  it('keeps every rules block and prompt byte for byte', () => {
    expect(rulesBlock([], 'current', '')).toBe(SYSTEM_RULES);
    expect(rulesBlock([], 'previous', '')).toBe(SYSTEM_RULES_PREVIOUS);
    expect(rulesBlock(['Be brief.'], 'current', '')).toBe(rulesBlock(['Be brief.']));
    expect(rulesBlock([], 'current', '  \n ')).toBe(SYSTEM_RULES);
    expect(buildPrompt(REQUEST, '')).toEqual(buildPrompt(REQUEST));
    expect(notesPrompt(NOTES, '').system[0]!.text).toBe(NOTES_RULES);
    const chat: AnswerRequest = { mode: 'kite', question: 'What is 2 + 2?' };
    expect(buildKiteChatPrompt(chat, '').system[0]!.text).toBe(KITE_CHAT_RULES);
    expect(withCompany(ASK_RULES, 'ask', '')).toBe(ASK_RULES);
  });
});

describe('locked rules first, then the company block, then the rest', () => {
  it('live answers: core rules, company instructions, learned preferences; session after', () => {
    const prompt = buildPrompt({ ...REQUEST, lessons: ['Lead with the price.'] }, COMPANY);
    const rules = prompt.system[0]!.text;
    expect(rules.startsWith(CORE_RULES)).toBe(true);
    const heading = rules.indexOf(COMPANY_HEADINGS.live);
    const company = rules.indexOf(COMPANY);
    const lessons = rules.indexOf(LESSONS_HEADING);
    expect(heading).toBeGreaterThan(CORE_RULES.length - 1);
    expect(company).toBeGreaterThan(heading);
    expect(lessons).toBeGreaterThan(company);
    // The session's own instructions are in the next block, after the company instructions.
    expect(prompt.system[1]!.text).toContain(
      'Instructions from the user:\nMention the annual plan.',
    );
    expect(prompt.system[1]!.text).not.toContain(COMPANY);
  });

  it('keeps the empty learned-preferences slot after the company block', () => {
    const rules = rulesBlock([], 'current', COMPANY);
    expect(rules).toBe(
      `${CORE_RULES}\n\n${COMPANY_HEADINGS.live}\n${COMPANY}\n\nLearned preferences (approved by the user in earlier calls):\n(none yet)`,
    );
  });

  it('works the same on the rollback rules (ADR-0032)', () => {
    const rules = rulesBlock([], 'previous', COMPANY);
    expect(rules.startsWith(CORE_RULES_PREVIOUS)).toBe(true);
    expect(rules).toContain(COMPANY);
  });

  it('notes, Ask AI page and Ask AI review: locked rules first, company text after them', () => {
    const notes = notesPrompt(NOTES, COMPANY).system[0]!.text;
    expect(notes.startsWith(NOTES_RULES)).toBe(true);
    expect(notes.endsWith(COMPANY)).toBe(true);
    const chat = buildKiteChatPrompt({ mode: 'kite', question: 'Hi?' }, COMPANY).system[0]!.text;
    expect(chat.startsWith(KITE_CHAT_RULES)).toBe(true);
    expect(chat.endsWith(COMPANY)).toBe(true);
    const ask = withCompany(ASK_RULES, 'ask', COMPANY);
    expect(ask.startsWith(ASK_RULES)).toBe(true);
    expect(ask.endsWith(COMPANY)).toBe(true);
  });

  it('says the company instructions never override the locked rules', () => {
    for (const heading of Object.values(COMPANY_HEADINGS)) {
      expect(heading).toMatch(/never override the rules above/);
    }
    expect(COMPANY_HEADINGS.live).toMatch(/CV and documents/);
  });
});

describe('prompt caching within a call', () => {
  it('puts the company text inside the first cached block', () => {
    const prompt = buildPrompt(REQUEST, COMPANY);
    expect(prompt.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(prompt.system[0]!.text).toContain(COMPANY);
    const notes = notesPrompt(NOTES, COMPANY);
    expect(notes.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends the same cached prefix for every request of a call with the same pinned text', () => {
    const first = buildPrompt({ ...REQUEST, mode: 'warm' }, COMPANY);
    const second = buildPrompt(REQUEST, COMPANY);
    const third = buildPrompt(
      {
        ...REQUEST,
        conversation: [
          ...REQUEST.conversation!,
          [{ kind: 'line', speaker: 'them', text: 'And the term?', at: 30 }],
        ],
        tail: [{ speaker: 'them', text: 'Is there a discount?', at: 41 }],
        question: 'Is there a discount?',
      },
      COMPANY,
    );
    expect(second.system).toEqual(first.system);
    expect(third.system).toEqual(first.system);
    // The conversation grows only at the end: the first chunk is the same bytes.
    const firstChunk = (prompt: typeof first) =>
      (prompt.messages[0]!.content as { type: string; text?: string }[])[0]!.text;
    expect(firstChunk(third)).toBe(firstChunk(second));
  });

  it('cleans the text, so the same instructions always give the same bytes', () => {
    expect(normaliseInstructions('  A\r\nB\rC  \n')).toBe('A\nB\nC');
    expect(rulesBlock([], 'current', 'A\r\nB')).toBe(rulesBlock([], 'current', 'A\nB  '));
    expect(companySection('live', '   ')).toBe('');
  });
});
