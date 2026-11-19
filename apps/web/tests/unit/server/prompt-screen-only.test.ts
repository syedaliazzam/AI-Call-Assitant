/**
 * Tests src/server/prompt.ts and src/server/prompts/contract.ts for ADR-0107 screen-only screenshots
 * (Ctrl+Shift+Enter and the Screenshot button): the request's tail carries the screen-only instruction and
 * question and nothing of the call (no conversation, latest lines, earlier answer, document parts or spoken
 * question), even when a client sends them; the answer is private by default (the client's target is
 * written as the user's choice); the screenshot tails no longer write the `[[type|for|source]]` placeholder
 * (replies copied "for" from it) and name the screen types, "question" included, never garbled or none.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerRequest, SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { buildPrompt, isScreenOnly } from '@/server/prompt';
import {
  LIVE_CONTRACT,
  SCREEN_ONLY_QUESTION,
  SCREEN_ONLY_TAIL,
  SCREENSHOT_TAIL,
} from '@/server/prompts/contract';

/** An invented session. */
const SESSION: SessionContext = {
  type: 'interview',
  company: 'Northwind Labs (invented)',
  role: 'Backend engineer interview',
  description: 'Technical interview.',
  instructions: '',
  keyTerms: ['Python'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [{ name: 'cv.txt', text: 'CV (invented): Python APIs.' }],
};

/** A tiny JPEG data URL (the prompt only wraps it as an image block). */
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQ';

/** A screen-only request that also (wrongly) carries the call, which the server must ignore. */
const WITH_CALL: AnswerRequest = {
  mode: 'screenshot',
  screenOnly: true,
  session: SESSION,
  image: IMAGE,
  target: 'kite',
  question: 'Can you see it now?',
  tail: [{ speaker: 'them', text: 'CAN YOU SEE IT NOW', at: 120 }],
  conversation: [
    [
      { kind: 'line', speaker: 'them', text: 'LET ME SHARE MY SCREEN', at: 100 },
      {
        kind: 'answer',
        mode: 'screenshot',
        question: "What's on screen and how should I respond?",
        text: 'This is a pricing page (an earlier tab).',
        at: 110,
      },
    ],
  ],
  similar: { question: 'Can you see it now?', text: 'Yes, I can see it.', at: 90 },
  documentChunks: [{ name: 'cv.txt', text: 'Python APIs.' }],
};

/**
 * The text of the request's last user block (the uncached tail).
 *
 * @param request The request.
 * @returns The tail text.
 */
function tailOf(request: AnswerRequest): string {
  const content = buildPrompt(request).messages.at(-1)!.content as Anthropic.ContentBlockParam[];
  return (content.at(-1) as Anthropic.TextBlockParam).text;
}

/**
 * Every text the request's messages carry.
 *
 * @param request The request.
 * @returns The texts joined.
 */
function messagesText(request: AnswerRequest): string {
  return buildPrompt(request)
    .messages.flatMap((message) =>
      typeof message.content === 'string'
        ? [message.content]
        : message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
    )
    .join('\n');
}

describe('screen-only screenshots (ADR-0107)', () => {
  it('knows a screen-only request only with mode screenshot, screenOnly and an image', () => {
    expect(isScreenOnly(WITH_CALL)).toBe(true);
    expect(isScreenOnly({ ...WITH_CALL, screenOnly: false })).toBe(false);
    expect(isScreenOnly({ ...WITH_CALL, image: null })).toBe(false);
    expect(isScreenOnly({ ...WITH_CALL, mode: 'chat' })).toBe(false);
  });

  it('sends the screen-only instruction and question, and nothing of the call', () => {
    const tail = tailOf(WITH_CALL);
    expect(tail.startsWith(SCREEN_ONLY_TAIL)).toBe(true);
    expect(tail).toContain(`Question about the screenshot: ${SCREEN_ONLY_QUESTION}`);
    const all = messagesText(WITH_CALL);
    for (const call of [
      '<conversation>',
      '<latest>',
      'CAN YOU SEE IT NOW',
      'LET ME SHARE MY SCREEN',
      'an earlier tab',
      'A similar question was answered',
      '<document_parts>',
      'Can you see it now?',
    ]) {
      expect(all).not.toContain(call);
    }
  });

  it('writes the private choice and keeps the image first', () => {
    expect(tailOf(WITH_CALL)).toContain(
      'The user chose: this is a private answer, so for is kite.',
    );
    const content = buildPrompt(WITH_CALL).messages.at(-1)!
      .content as Anthropic.ContentBlockParam[];
    expect(content.at(-2)?.type).toBe('image');
  });

  it('asks for the task on the screen, not a description, with the multiple-choice letter', () => {
    expect(SCREEN_ONLY_TAIL).toContain('Find the question or task on the screen and answer it');
    expect(SCREEN_ONLY_TAIL).toContain('Never only describe the screen');
    expect(SCREEN_ONLY_TAIL).toContain('never ask whether the user wants the answer');
    expect(SCREEN_ONLY_TAIL).toContain('the letter and the text of the correct option');
    expect(SCREEN_ONLY_TAIL).toContain('nothing said in the call is the question');
  });

  it('keeps the call for a screenshot with a question (Ctrl+Alt+Enter)', () => {
    const tail = tailOf({ ...WITH_CALL, screenOnly: false });
    expect(tail).toContain(SCREENSHOT_TAIL);
    expect(tail).toContain('<latest>');
    expect(tail).toContain('Question about the screenshot: Can you see it now?');
  });

  it('writes no placeholder in either screenshot tail, and names the screen types', () => {
    for (const text of [SCREENSHOT_TAIL, SCREEN_ONLY_TAIL]) {
      expect(text).not.toContain('[[');
      expect(text).toContain(
        'coding, codefix, question, slide, table, document, webpage or unreadable; never garbled or none',
      );
    }
  });

  it('lists the question screen type in the contract, and never garbled or none for a screenshot', () => {
    expect(LIVE_CONTRACT).toContain('question (a question or task on the screen');
    expect(LIVE_CONTRACT).toContain('a screenshot is never garbled or none');
  });
});
