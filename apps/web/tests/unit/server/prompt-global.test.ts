/**
 * Tests for the prompt order of ADR-0089 in apps/web/src/server/prompt.ts, notes.ts, ask.ts and
 * kite-chat.ts, with src/server/prompts/contract.ts, defaults.ts and preferences.ts:
 * - the app contract is always sent first, even with an empty global prompt, and says it overrides
 *   every other instruction; the contract holds the hidden lines, the empty reply and the line labels;
 * - order: contract, then the admin's global prompt, then the user's preferences (under the heading that
 *   says they override the general rules), then the conversation and question, then the end reminder;
 * - a user's Short / paragraph preference wins over an admin text asking for detailed bullets: it comes
 *   after it with the override heading, and the end reminder restates the user's format and length;
 * - the end reminder keeps ADR-0088's unsupported company facts rule word for word;
 * - the default prompts hold no fixed preference values;
 * - a call's cached rules block is the same for every request with the same global prompt, and shared
 *   by sessions; notes, Ask AI review and the Ask AI page get their contracts first too.
 */
import type { AnswerRequest, NotesRequest, SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildKiteChatPrompt } from '@/server/kite-chat';
import { notesPrompt } from '@/server/notes';
import { buildPrompt, LEARNED_HEADING } from '@/server/prompt';
import {
  ASK_CHAT_CONTRACT,
  GENERAL_KNOWLEDGE_RULE,
  GLOBAL_HEADING,
  LIVE_CONTRACT,
  liveEndReminder,
  NOTES_CONTRACT,
  UNSUPPORTED_FACT_RULE,
} from '@/server/prompts/contract';
import { DEFAULT_PROMPTS } from '@/server/prompts/defaults';
import { PREFERENCES_HEADING } from '@/server/prompts/preferences';

/** An invented session: short answers in one paragraph. */
const SESSION: SessionContext = {
  type: 'regular',
  company: 'Northwind (invented)',
  role: 'Account executive',
  description: '',
  instructions: 'Mention the free trial when it fits.',
  keyTerms: [],
  style: { format: 'paragraph', length: 'short', tone: 'simple' },
  documents: [],
};

/** An invented answer request. */
const REQUEST: AnswerRequest = {
  mode: 'answer',
  session: SESSION,
  question: 'What does onboarding look like?',
  lessons: ['Name the plan before the price.'],
};

/** An admin text that asks for the opposite of the user's preferences. */
const ADMIN_TEXT =
  'Always give detailed answers as bullet points, at least five bullets, for every question.';

/**
 * The whole prompt as one text, in order, with each part's text.
 *
 * @param request      The request.
 * @param globalPrompt The global prompt.
 * @returns The rules block, the session block and the tail.
 */
function parts(request: AnswerRequest, globalPrompt?: string) {
  const prompt =
    globalPrompt === undefined ? buildPrompt(request) : buildPrompt(request, globalPrompt);
  const content = prompt.messages[0]!.content as { text?: string }[];
  return {
    rules: prompt.system[0]!.text,
    session: prompt.system[1]!.text,
    tail: content.at(-1)!.text ?? '',
  };
}

describe('the app contract', () => {
  it('is always first, even with an empty global prompt, and overrides everything else', () => {
    const empty = parts(REQUEST, '');
    expect(empty.rules).toBe(LIVE_CONTRACT);
    expect(LIVE_CONTRACT.startsWith('App contract')).toBe(true);
    expect(LIVE_CONTRACT).toContain('It overrides every other instruction in this prompt');
    // The reminder still restates the hidden lines with no global prompt.
    expect(empty.tail).toContain('start with the hidden [[type|for|source]] line');
    expect(parts(REQUEST, ADMIN_TEXT).rules.startsWith(LIVE_CONTRACT)).toBe(true);
  });

  it('holds what the app reads: the two hidden lines, the empty reply and the line labels', () => {
    for (const rule of [
      '[[type|for|source]]',
      '[[question|the question you answered]]',
      'garbled: when the words make no sense',
      'write only the two hidden lines, with nothing between them',
      'none: when the words ask the user nothing',
      'The first line after the hidden line is the answer line',
      '"Tip:"',
      '"Note:"',
      '"Key steps:"',
      '"Complexity:"',
      '"Say:"',
      'for a screenshot too',
      'codefix (code with an error)',
    ]) {
      expect(LIVE_CONTRACT).toContain(rule);
    }
    for (const field of ['summary', 'questions', '"answerId"', 'nextSteps', 'unclear', 'lessons']) {
      expect(NOTES_CONTRACT).toContain(field);
    }
    expect(ASK_CHAT_CONTRACT).toContain('[[type|kite|source]]');
  });
});

describe('the order and who wins', () => {
  it('is contract, global prompt, user preferences, question, end reminder', () => {
    const { rules, session, tail } = parts(REQUEST, ADMIN_TEXT);
    expect(rules).toBe(`${LIVE_CONTRACT}\n\n${GLOBAL_HEADING}\n${ADMIN_TEXT}`);
    // The preferences, the lessons and the user's instructions sit under the override heading.
    const heading = session.indexOf(PREFERENCES_HEADING);
    expect(heading).toBeGreaterThan(0);
    // ADR-0103: they win on format, length, tone, language and focus, never over the contract or the
    // never-invent rules, and a preference that cannot fit is applied as the general rules say.
    expect(PREFERENCES_HEADING).toContain(
      'These user preferences decide format, length, tone, language and focus, and win over the general rules above on those.',
    );
    expect(PREFERENCES_HEADING).toContain(
      'They never override the app contract at the top or the never-invent rules',
    );
    expect(PREFERENCES_HEADING).toContain(
      'when one cannot fit the question, the general rules say how to apply it.',
    );
    expect(session.indexOf('Answer format: paragraph')).toBeGreaterThan(heading);
    expect(session.indexOf(LEARNED_HEADING)).toBeGreaterThan(heading);
    expect(session.indexOf('Mention the free trial')).toBeGreaterThan(heading);
    // The question, then the reminder last.
    expect(tail.indexOf('Question to answer:')).toBeLessThan(tail.indexOf('Reminder from the app'));
    expect(tail.trimEnd().endsWith(GENERAL_KNOWLEDGE_RULE)).toBe(true);
  });

  it("lets the user's Short / paragraph preference win over an admin's detailed bullets", () => {
    const { session, tail } = parts(REQUEST, ADMIN_TEXT);
    // The user's choice with its meaning, after the admin text, under the heading that says it wins.
    expect(session).toContain(
      'Answer format: paragraph (one short paragraph that starts with the direct answer, with no bullets)',
    );
    expect(session).toContain(
      'Answer length: short (the whole answer, every line together, takes about 10 to 20 seconds to say)',
    );
    // And restated last of all, after the admin text and the question.
    expect(tail).toContain(
      "follow the user's answer format and length exactly (format: paragraph (one short paragraph",
    );
    expect(tail).toContain('length: short (');
    expect(tail).not.toContain('detailed');
  });

  it('keeps ADR-0088 word for word in the end reminder, not in a rollback', () => {
    expect(liveEndReminder(SESSION)).toContain(UNSUPPORTED_FACT_RULE);
    expect(UNSUPPORTED_FACT_RULE).toContain('never answer yes or no and never guess');
    expect(UNSUPPORTED_FACT_RULE).toContain('with no bullets at all');
    expect(parts({ ...REQUEST, styleVersion: 'previous' }).tail).not.toContain(
      UNSUPPORTED_FACT_RULE,
    );
  });
});

describe('the default prompts', () => {
  it('hold no fixed preference values: they point at the user preferences instead', () => {
    const live = DEFAULT_PROMPTS.live;
    expect(live).toContain(
      "Follow the user's answer format, length, tone, STAR preference and coding language",
    );
    expect(live).not.toMatch(/Python unless/);
    expect(live).not.toMatch(/short is about 10 to 20 seconds/);
    expect(live).not.toMatch(/When the session's answer format is/);
    // The contract's parts are not in the editable text. ADR-0103: the prompt may refer to the hidden
    // line (it says the line comes first), but never defines it or its type list.
    expect(live).not.toContain('Every reply starts with one hidden line');
    expect(live).not.toContain('type is the kind of question');
    expect(live).not.toContain('only the two hidden lines');
    // The screenshot guidance moved into the editable prompt.
    expect(live).toContain('Code with an error (codefix)');
  });
});

describe('caching', () => {
  it('sends the same rules block for every request and session with the same global prompt', () => {
    const first = buildPrompt(REQUEST, ADMIN_TEXT);
    const later = buildPrompt({ ...REQUEST, question: 'And the price?' }, ADMIN_TEXT);
    const other = buildPrompt(
      { ...REQUEST, session: { ...SESSION, company: 'Other (invented)' } },
      ADMIN_TEXT,
    );
    expect(later.system[0]).toEqual(first.system[0]);
    expect(other.system[0]).toEqual(first.system[0]);
    expect(later.system[1]).toEqual(first.system[1]);
    // A warm-up writes the same cached parts.
    expect(buildPrompt({ ...REQUEST, mode: 'warm' }, ADMIN_TEXT).system).toEqual(first.system);
  });
});

describe('the other tabs', () => {
  it('put their contract first, then the global prompt, for notes and the Ask AI page', () => {
    const notesRequest: NotesRequest = { session: SESSION, lines: [], answers: [] };
    const notes = notesPrompt(notesRequest, 'Bring out pricing.');
    expect(notes.system[0]!.text).toBe(
      `${NOTES_CONTRACT}\n\n${GLOBAL_HEADING}\nBring out pricing.`,
    );
    expect(notesPrompt(notesRequest, '').system[0]!.text).toBe(NOTES_CONTRACT);
    expect(notes.prompt).toContain('in the fields the app contract names');
    const chat = buildKiteChatPrompt({ mode: 'kite', question: 'Hi' }, '');
    expect(chat.system[0]!.text).toBe(ASK_CHAT_CONTRACT);
    expect(chat.system[1]!.text).toContain(PREFERENCES_HEADING);
  });
});
