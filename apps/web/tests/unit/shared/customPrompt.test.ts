/**
 * Tests for packages/shared/src/customPrompt.ts (ADR-0086), the check that refuses a custom full system
 * prompt missing the output format the app reads:
 * - live 'core': the [[type|for|source]] first line, the [[question|…]] last line, the garbled rule and
 *   the none rule, each named exactly when missing (and only then);
 * - live 'screenshot' and Ask AI 'chat' keep their hidden first line; the notes rules name every field;
 * - empty parts (the live reminder may be empty) and the length limit;
 * - cleaning (line endings, outer spaces, other blocks' parts dropped) and promptKey() equality;
 * - describePromptProblems() names each part.
 */
import { describe, expect, it } from 'vitest';
import {
  checkCustomPrompt,
  describePromptProblems,
  MAX_PROMPT_PART_CHARS,
  normalisePrompt,
  promptKey,
  type CustomPrompt,
} from '@kite/shared';

/** An invented live prompt that keeps every rule the app needs. */
const LIVE: CustomPrompt = {
  core: [
    'You are an assistant.',
    'Every reply starts with one hidden line: [[type|for|source]]',
    'Every reply ends with [[question|the question you answered]].',
    '- garbled: when the words make no sense, write only the two hidden lines.',
    '- none: when the words ask nothing, write only the two hidden lines.',
  ].join('\n'),
  reminder: 'Keep it short.',
  screenshot: 'Your reply starts as always with the line [[type|for|source]].',
};

/**
 * The messages of a check, for one part.
 *
 * @param prompt The prompt.
 * @returns The messages.
 */
function messages(prompt: CustomPrompt): string[] {
  return checkCustomPrompt('live', prompt).map((problem) => problem.message);
}

describe('checkCustomPrompt, live answers', () => {
  it('accepts a prompt with every required rule', () => {
    expect(checkCustomPrompt('live', LIVE)).toEqual([]);
  });

  it('names a missing hidden first line', () => {
    const core = LIVE.core!.replace('[[type|for|source]]', '[[kind]]');
    expect(messages({ ...LIVE, core })).toEqual([
      'The hidden first line is missing: keep the rule that every reply starts with the line [[type|for|source]].',
    ]);
  });

  it('names a missing hidden last line', () => {
    const core = LIVE.core!.replace('[[question|the question you answered]]', 'a question line');
    expect(messages({ ...LIVE, core })).toEqual([
      'The hidden last line is missing: keep the rule that every reply ends with the line [[question|the question you answered]].',
    ]);
  });

  it('names a missing garbled rule, also when "garbled" survives without its consequence', () => {
    const without = LIVE.core!.replace(/- garbled.*\n/, '');
    expect(messages({ ...LIVE, core: without })).toEqual([
      'The garbled rule is missing: keep a line saying that for garbled words the reply is "only the two hidden lines".',
    ]);
    const weakened = LIVE.core!.replace(
      '- garbled: when the words make no sense, write only the two hidden lines.',
      '- garbled: guess what they meant.',
    );
    expect(messages({ ...LIVE, core: weakened })).toHaveLength(1);
  });

  it('names a missing none rule', () => {
    const core = LIVE.core!.replace(/\n- none.*$/, '');
    expect(messages({ ...LIVE, core })).toEqual([
      'The none rule is missing: keep a line starting "none:" saying that when the words ask nothing the reply is "only the two hidden lines".',
    ]);
  });

  it('names every missing rule at once, and the screenshot first line', () => {
    const problems = checkCustomPrompt('live', {
      core: 'Be helpful.',
      reminder: '',
      screenshot: 'Read the screen.',
    });
    expect(problems.map((problem) => problem.part)).toEqual([
      'core',
      'core',
      'core',
      'core',
      'screenshot',
    ]);
  });

  it('allows an empty reminder but no other empty part, and keeps the length limit', () => {
    expect(checkCustomPrompt('live', { ...LIVE, reminder: '  ' })).toEqual([]);
    expect(checkCustomPrompt('live', { ...LIVE, screenshot: '' })).toEqual([
      { part: 'screenshot', message: 'Empty: this part is needed.' },
    ]);
    expect(checkCustomPrompt('live', { core: LIVE.core!, reminder: '' })).toEqual([
      { part: 'screenshot', message: 'Empty: this part is needed.' },
    ]);
    const long = `${LIVE.core!}\n${'x'.repeat(MAX_PROMPT_PART_CHARS)}`;
    expect(checkCustomPrompt('live', { ...LIVE, core: long })).toEqual([
      { part: 'core', message: 'Too long: use at most 40,000 characters.' },
    ]);
  });
});

describe('checkCustomPrompt, notes and Ask AI', () => {
  it('names each notes field the rules no longer explain', () => {
    const rules =
      'summary: bullets. questions: asked, with answerId. nextSteps: agreed. lessons: few.';
    expect(checkCustomPrompt('notes', { rules })).toEqual([
      {
        part: 'rules',
        message:
          'The "unclear" field is not explained: keep a rule that says what goes in unclear.',
      },
    ]);
    expect(checkCustomPrompt('notes', { rules: `${rules} unclear: garbled parts.` })).toEqual([]);
  });

  it('keeps the Ask AI page hidden first line and needs the review rules', () => {
    expect(
      checkCustomPrompt('ask', { chat: 'Start with [[type|kite|source]].', review: 'Be brief.' }),
    ).toEqual([]);
    expect(checkCustomPrompt('ask', { chat: 'Be brief.', review: '' }).map((p) => p.part)).toEqual([
      'chat',
      'review',
    ]);
  });
});

describe('cleaning and keys', () => {
  it('cleans line endings and outer spaces, and drops parts of other blocks', () => {
    expect(normalisePrompt('notes', { rules: '  a\r\nb \r', core: 'other block' })).toEqual({
      rules: 'a\nb',
    });
  });

  it('gives equal keys exactly for prompts that send the same bytes', () => {
    expect(promptKey('live', LIVE)).toBe(
      promptKey('live', { ...LIVE, core: `\n${LIVE.core!.replaceAll('\n', '\r\n')}  ` }),
    );
    expect(promptKey('live', LIVE)).not.toBe(promptKey('live', { ...LIVE, reminder: 'Other.' }));
  });

  it('describes the problems with each part named', () => {
    expect(
      describePromptProblems([
        { part: 'chat', message: 'Empty: this part is needed.' },
        { part: 'review', message: 'Empty: this part is needed.' },
      ]),
    ).toBe(
      "Rules for the Ask AI page: Empty: this part is needed. Rules for Ask AI in a session's review: Empty: this part is needed.",
    );
  });
});
