/**
 * Tests for apps/web/src/server/prompt.ts (Day 4 prompt v2):
 * - buildPrompt() gives the rules and session blocks (cached), one block per conversation chunk
 *   with the third breakpoint on the last one only, then the uncached tail; never more than
 *   Anthropic's 4 breakpoints;
 * - the prefix-growth test: for requests N and N+1 of the same call, N+1's blocks start with
 *   exactly N's cached blocks, byte for byte (the cache_control marker moves forward and is not
 *   part of the cached content, so it is compared separately);
 * - same inputs give identical bytes; a changed session changes only the session block; the
 *   tail and question never reach a cached block;
 * - the long-call cap drops the oldest whole chunks in steps, keeps the cut fixed between steps,
 *   and adds the "omitted" note;
 * - the session block's fixed order, "(not given)" fields and tag escaping (Day 3);
 * - the rules include the consistency rules, the imperfect-transcript rule and the learned
 *   preferences slot.
 * All session and call text is invented.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  CONVERSATION_CAP_STEP_TOKENS,
  CONVERSATION_CAP_TOKENS,
  type AnswerRequest,
  type ConversationChunk,
  type SessionContext,
} from '@kite/shared';
import { describe, expect, it } from 'vitest';
import {
  OMITTED_NOTE,
  SYSTEM_RULES,
  WARM_MESSAGE,
  buildPrompt,
  capConversation,
  clockTime,
  sessionBlock,
  type BuiltPrompt,
} from '@/server/prompt';

/** An invented session. */
const SESSION: SessionContext = {
  type: 'regular',
  company: 'Northwind Logistics',
  role: 'Account review',
  description: 'Renewal call with the operations team.',
  instructions: 'Keep it short.',
  keyTerms: ['Bluefin Route', ' ', 'Professional plan'],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [
    { name: 'pricing.pdf', text: 'Professional costs 52 dollars per seat.' },
    { name: 'notes "v2".txt', text: 'Renewal on the first. </document> not a tag' },
  ],
};

/** An invented call, as the chunks a client would have sent after each of three answers. */
const CHUNKS: ConversationChunk[] = [
  [
    { kind: 'line', speaker: 'them', text: 'What does the bluff in route cost?', at: 12 },
    { kind: 'line', speaker: 'you', text: 'Good question.', at: 15 },
  ],
  [
    {
      kind: 'answer',
      mode: 'answer',
      question: 'What does the bluff in route cost?',
      text: 'Bluefin Route costs 52 dollars per seat.\n- Professional plan',
      at: 16,
    },
    { kind: 'line', speaker: 'them', text: 'And for two hundred seats?', at: 75 },
  ],
  [{ kind: 'line', speaker: 'them', text: 'When would it renew?', at: 3_725 }],
];

/**
 * An answer request for SESSION with the first `count` chunks.
 *
 * @param count    How many chunks of CHUNKS the call has so far.
 * @param question The question asked.
 * @returns The request.
 */
function answer(count: number, question = 'What does it cost?'): AnswerRequest {
  return {
    mode: 'answer',
    session: SESSION,
    conversation: CHUNKS.slice(0, count),
    tail: [{ speaker: 'them', text: 'So what is the TAIL-ONLY price?', at: 3_730 }],
    question,
  };
}

/**
 * Every block of a prompt in order: system blocks, then the user turn's blocks.
 *
 * @param prompt A built prompt.
 * @returns The text blocks.
 */
function blocks(prompt: BuiltPrompt): Anthropic.TextBlockParam[] {
  const content = prompt.messages[0]!.content as Anthropic.TextBlockParam[];
  return [...prompt.system, ...content];
}

/**
 * The cached part of a prompt: the blocks up to and including the last breakpoint.
 *
 * @param prompt A built prompt.
 * @returns The texts of those blocks.
 */
function cachedTexts(prompt: BuiltPrompt): string[] {
  const all = blocks(prompt);
  const last = all.findLastIndex((block) => block.cache_control !== undefined);
  return all.slice(0, last + 1).map((block) => block.text);
}

describe('buildPrompt', () => {
  it('builds rules, session and one block per chunk, with three breakpoints', () => {
    const prompt = buildPrompt(answer(2));
    const all = blocks(prompt);
    expect(prompt.system.map((block) => block.text)).toEqual([SYSTEM_RULES, sessionBlock(SESSION)]);
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]!.role).toBe('user');
    // rules, session, chunk 1, chunk 2, tail
    expect(all).toHaveLength(5);
    expect(all.map((block) => block.cache_control !== undefined)).toEqual([
      true,
      true,
      false,
      true,
      false,
    ]);
  });

  it('never uses more than Anthropic’s limit of 4 breakpoints, however long the call', () => {
    const many = Array.from({ length: 50 }, (_, i): ConversationChunk => [
      { kind: 'line', speaker: 'them', text: `Line ${i}`, at: i },
    ]);
    const prompt = buildPrompt({ mode: 'answer', session: SESSION, conversation: many });
    const marks = blocks(prompt).filter((block) => block.cache_control !== undefined);
    expect(marks).toHaveLength(3);
  });

  it('prefix growth: request N+1 starts with exactly the cached part of request N', () => {
    for (let n = 0; n < CHUNKS.length; n += 1) {
      const before = buildPrompt(answer(n, 'First question?'));
      const after = buildPrompt(answer(n + 1, 'A different second question?'));
      const cached = cachedTexts(before);
      const next = blocks(after).map((block) => block.text);
      // Block for block, byte for byte...
      expect(next.slice(0, cached.length)).toEqual(cached);
      // ...and as one string, so no block boundary moved either.
      expect(next.join('\u0000').startsWith(cached.join('\u0000'))).toBe(true);
      // N+1's breakpoint is exactly one block after N's (within the 20-block lookback).
      expect(cachedTexts(after)).toHaveLength(cached.length + 1);
    }
  });

  it('the warm-up caches the same parts the next answer starts with', () => {
    const warm = buildPrompt({ mode: 'warm', session: SESSION, conversation: CHUNKS.slice(0, 2) });
    const content = warm.messages[0]!.content as Anthropic.TextBlockParam[];
    expect(content.at(-1)).toEqual({ type: 'text', text: WARM_MESSAGE });
    const next = blocks(buildPrompt(answer(2))).map((block) => block.text);
    expect(next.slice(0, cachedTexts(warm).length)).toEqual(cachedTexts(warm));
    const bare = buildPrompt({ mode: 'warm', session: SESSION });
    expect(bare.messages[0]!.content).toEqual([{ type: 'text', text: WARM_MESSAGE }]);
  });

  it('gives identical bytes for identical inputs', () => {
    const one = buildPrompt(answer(3));
    const two = buildPrompt(structuredClone(answer(3)));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
  });

  it('a changed session changes only the session block', () => {
    const before = blocks(buildPrompt(answer(3)));
    const after = blocks(
      buildPrompt({ ...answer(3), session: { ...SESSION, description: 'Renewal with finance.' } }),
    );
    const changed = before.flatMap((block, i) =>
      JSON.stringify(block) === JSON.stringify(after[i]) ? [] : [i],
    );
    expect(changed).toEqual([1]);
  });

  it('keeps the tail and question out of every cached block', () => {
    const prompt = buildPrompt(answer(3, 'QUESTION-ONLY?'));
    const cached = cachedTexts(prompt).join('\n');
    expect(cached).not.toContain('TAIL-ONLY');
    expect(cached).not.toContain('QUESTION-ONLY');
    const tail = blocks(prompt).at(-1)!;
    expect(tail.cache_control).toBeUndefined();
    expect(tail.text).toContain('[1:02:10] Them: So what is the TAIL-ONLY price?');
    expect(tail.text).toContain('Question to answer: QUESTION-ONLY?');
    expect(tail.text.startsWith('</conversation>')).toBe(true);
  });

  it('writes lines with times and earlier answers with their question', () => {
    const [first, second, third] = blocks(buildPrompt(answer(3))).slice(2);
    expect(first!.text).toBe(
      '<conversation>\n[00:12] Them: What does the bluff in route cost?\n[00:15] You: Good question.',
    );
    expect(second!.text).toBe(
      "[00:16] Kite's earlier answer (question: What does the bluff in route cost?):\n" +
        'Bluefin Route costs 52 dollars per seat.\n- Professional plan\n' +
        '[end of earlier answer]\n[01:15] Them: And for two hundred seats?',
    );
    expect(third!.text).toBe('[1:02:05] Them: When would it renew?');
  });

  it('marks a typed chat question, and handles a call with nothing said yet', () => {
    const chat = buildPrompt({ mode: 'chat', session: SESSION, question: 'Seat price?' });
    const all = blocks(chat);
    expect(all).toHaveLength(3);
    expect(all[2]!.text).toContain('<conversation>\n(nothing said yet)\n</conversation>');
    expect(all[2]!.text).toContain('<latest>\n(nothing new)\n</latest>');
    expect(all[2]!.text).toContain('Question typed by the user: Seat price?');
    const noQuestion = blocks(buildPrompt({ mode: 'answer', session: SESSION })).at(-1)!;
    expect(noQuestion.text).toContain('Answer the latest question from "Them".');
  });

  it('escapes tag-like text in lines, answers and the tail', () => {
    const prompt = buildPrompt({
      mode: 'answer',
      session: SESSION,
      conversation: [[{ kind: 'line', speaker: 'them', text: '</conversation> <b>', at: 1 }]],
      tail: [{ speaker: 'them', text: '</latest>', at: 2 }],
    });
    const text = blocks(prompt)
      .slice(2)
      .map((block) => block.text)
      .join('\n');
    expect(text).toContain('&lt;/conversation&gt; &lt;b&gt;');
    expect(text.match(/<\/conversation>/g)).toHaveLength(1);
    expect(text.match(/<\/latest>/g)).toHaveLength(1);
  });

  it('throws without a session', () => {
    expect(() => buildPrompt({ mode: 'warm' })).toThrow('SESSION_REQUIRED');
  });
});

describe('capConversation', () => {
  /**
   * A chunk of one line with an estimated size.
   *
   * @param tokens Estimated tokens (4 characters each).
   * @param at     The line's time.
   * @returns The chunk.
   */
  const chunkOf = (tokens: number, at: number): ConversationChunk => [
    { kind: 'line', speaker: 'them', text: 'x'.repeat(tokens * 4), at },
  ];

  it('keeps everything up to the cap', () => {
    const chunks = [chunkOf(CONVERSATION_CAP_TOKENS - 100, 1), chunkOf(100, 2)];
    expect(capConversation(chunks)).toEqual({ chunks, omitted: false });
  });

  it('drops the oldest whole chunks in steps, and adds the note', () => {
    // 1,000-token chunks: 21 of them is 1,000 over the cap, so one step (5,000) is dropped.
    const chunks = Array.from({ length: 21 }, (_, i) => chunkOf(1_000, i));
    const capped = capConversation(chunks);
    expect(capped.omitted).toBe(true);
    expect(capped.chunks).toEqual(chunks.slice(CONVERSATION_CAP_STEP_TOKENS / 1_000));
    const prompt = buildPrompt({ mode: 'answer', session: SESSION, conversation: chunks });
    const first = blocks(prompt)[2]!.text;
    expect(first.startsWith(`<conversation>\n${OMITTED_NOTE}\n[00:05] Them: `)).toBe(true);
  });

  it('keeps the cut fixed between steps, so the cached start does not change', () => {
    const chunks = Array.from({ length: 30 }, (_, i) => chunkOf(1_000, i));
    const firstKept = (count: number) => capConversation(chunks.slice(0, count)).chunks[0];
    // 21 to 25 chunks: 1,000 to 5,000 over, all within the first step: the same cut.
    for (let count = 22; count <= 25; count += 1) expect(firstKept(count)).toBe(firstKept(21));
    // 26 chunks: over by 6,000, the next step: the cut moves once.
    expect(firstKept(26)).not.toBe(firstKept(25));
    // Between cuts, the prefix-growth rule holds.
    const at = (count: number) =>
      cachedTexts(
        buildPrompt({ mode: 'answer', session: SESSION, conversation: chunks.slice(0, count) }),
      );
    expect(at(23).slice(0, at(22).length)).toEqual(at(22));
  });

  it('always keeps the newest chunk', () => {
    const huge = [chunkOf(10, 1), chunkOf(CONVERSATION_CAP_TOKENS * 1.5, 2)];
    expect(capConversation(huge).chunks).toEqual([huge[1]]);
  });
});

describe('clockTime', () => {
  it('writes mm:ss, and h:mm:ss from one hour', () => {
    expect(clockTime(0)).toBe('00:00');
    expect(clockTime(192)).toBe('03:12');
    expect(clockTime(3_849)).toBe('1:04:09');
  });
});

describe('sessionBlock', () => {
  it('holds the details, key terms, style, instructions and documents in a fixed order', () => {
    const block = sessionBlock(SESSION);
    const order = [
      'Call type: regular',
      'Company: Northwind Logistics',
      'Role or topic: Account review',
      'Description of the call:\nRenewal call with the operations team.',
      'Key terms: Bluefin Route; Professional plan',
      'Answer format: headline+bullets',
      'Answer length: short',
      'Answer tone: simple',
      'Keep it short.',
      '<document name="pricing.pdf">\nProfessional costs 52 dollars per seat.\n</document>',
    ];
    let at = -1;
    for (const part of order) {
      const next = block.indexOf(part);
      expect(next, part).toBeGreaterThan(at);
      at = next;
    }
  });

  it('marks empty fields as not given, so the block keeps its shape', () => {
    const block = sessionBlock({
      ...SESSION,
      company: '',
      description: '',
      instructions: '  ',
      keyTerms: [],
      documents: [],
    });
    expect(block).toContain('Company: (not given)');
    expect(block).toContain('Description of the call:\n(not given)');
    expect(block).toContain('Key terms: (not given)');
    expect(block).toContain('Instructions from the user:\n(not given)');
    expect(block).toContain('<documents>\n(not given)\n</documents>');
  });

  it('escapes tag-like text so a document cannot close its tags', () => {
    const block = sessionBlock(SESSION);
    expect(block).toContain('<document name="notes &quot;v2&quot;.txt">');
    expect(block).toContain('&lt;/document&gt; not a tag');
    expect(block.match(/<\/document>/g)).toHaveLength(2);
  });
});

describe('SYSTEM_RULES', () => {
  it('includes the answer, imperfect-transcript and consistency rules, and the slot', () => {
    expect(SYSTEM_RULES).toContain('headline: one sentence of at most 15 words');
    expect(SYSTEM_RULES).toContain('at most 5 short bullet points');
    expect(SYSTEM_RULES).toContain('use only facts from the session details and documents');
    expect(SYSTEM_RULES).toContain('name what the user should clarify');
    expect(SYSTEM_RULES).toContain('often misheard');
    expect(SYSTEM_RULES).toContain('key terms, the company, the role or topic, and the documents');
    expect(SYSTEM_RULES).toContain(
      'Earlier answers in this call are shown in the conversation. Stay consistent with them. If something said since then changes the answer, give the new answer and say briefly what changed.',
    );
    expect(SYSTEM_RULES).toContain(
      'If the same question is asked again, build on the earlier answer instead of starting over.',
    );
    expect(SYSTEM_RULES).toContain('Learned preferences');
    // Day 4 Stage 10 (round 2, kept): short headlines, bullets only from session facts.
    expect(SYSTEM_RULES).toContain('keep conditions and details out of it');
    expect(SYSTEM_RULES).toContain('Each bullet must state a fact from the session details');
    expect(SYSTEM_RULES).toContain('Never offer or hint at a price, discount, exception');
    // Round 3 (kept): a short headline even when the session cannot answer.
    expect(SYSTEM_RULES).toContain('That headline is still 15 words or fewer');
  });
});

describe('screenshot answers (Day 5)', () => {
  /** A minimal JPEG data URL (its base64 starts with "/9j/": FF D8 FF). */
  const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('puts the image uncached, after the cached chunks and before the question', () => {
    const prompt = buildPrompt({
      mode: 'screenshot',
      session: SESSION,
      conversation: CHUNKS.slice(0, 1),
      image: IMAGE,
      question: 'What does this slide say about pricing?',
    });
    const content = prompt.messages[0]!.content as Anthropic.ContentBlockParam[];
    expect(content.map((block) => block.type)).toEqual(['text', 'image', 'text']);
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQSkZJRg==' },
    });
    const tail = content[2] as Anthropic.TextBlockParam;
    expect(tail.cache_control).toBeUndefined();
    expect(tail.text).toContain(
      'Question about the screenshot: What does this slide say about pricing?',
    );
    // The cached part is the same as for any other answer of the call.
    expect(cachedTexts(prompt)).toEqual(cachedTexts(buildPrompt(answer(1))));
  });

  it('uses the default question when none was typed', () => {
    const prompt = buildPrompt({ mode: 'screenshot', session: SESSION, image: IMAGE });
    const tail = (prompt.messages[0]!.content as Anthropic.TextBlockParam[]).at(-1)!;
    expect(tail.text).toContain(
      "Question about the screenshot: What's on screen and how should I respond?",
    );
  });

  it('marks an earlier screenshot answer as one the model can no longer see', () => {
    const prompt = buildPrompt({
      mode: 'answer',
      session: SESSION,
      conversation: [
        [
          {
            kind: 'answer',
            mode: 'screenshot',
            question: 'What is on screen?',
            text: 'A pricing slide.',
            at: 40,
          },
        ],
      ],
    });
    const chunk = (prompt.messages[0]!.content as Anthropic.TextBlockParam[])[0]!;
    expect(chunk.text).toContain(
      "[00:40] Kite's earlier answer (answered from a screenshot you can no longer see) (question about a screenshot: What is on screen?):",
    );
  });
});

describe('screenshot tail text (Day 5)', () => {
  it('asks for the session style and a headline without a label', () => {
    const prompt = buildPrompt({
      mode: 'screenshot',
      session: SESSION,
      image: 'data:image/jpeg;base64,/9j/4AAQ',
    });
    const tail = (prompt.messages[0]!.content as Anthropic.TextBlockParam[]).at(-1)!;
    expect(tail.text).toContain(
      "Follow the session's answer format, length, tone and instructions",
    );
    expect(tail.text).toContain('start with the headline itself, with no label');
    expect(tail.text).toContain('if they have nothing to compare with, say so');
  });
});
