/**
 * Tests for the other person's name as their speaker label (ADR-0093) in apps/web/src/server/prompt.ts,
 * apps/web/src/server/notes.ts (callRecord) and apps/web/src/server/validate.ts:
 * - without a name, the answer prompt is byte for byte what it was ("Them:" lines, no extra session line);
 * - with a name, every one of their lines in the conversation and the tail carries it, and the session
 *   block says who "Them" is; the user's lines stay "You";
 * - the notes and Ask AI call record labels their lines the same way;
 * - the server cleans the name again, so a quote, colon or tag never reaches a label.
 * All names and text are invented.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AnswerRequest, SessionContext } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { callRecord } from '@/server/notes';
import { buildPrompt, sessionBlock, type BuiltPrompt } from '@/server/prompt';
import { parseAnswerRequest } from '@/server/validate';

/** An invented session. */
const SESSION: SessionContext = {
  type: 'interview',
  company: 'Lantern Freight',
  role: 'Data Analyst',
  description: '',
  instructions: '',
  keyTerms: [],
  style: { format: 'headline+bullets', length: 'short', tone: 'simple' },
  documents: [],
};

/**
 * An answer request with one earlier chunk and a tail.
 *
 * @param session The session details.
 * @returns The request.
 */
function request(session: SessionContext): AnswerRequest {
  return {
    mode: 'answer',
    session,
    conversation: [
      [
        { kind: 'line', speaker: 'them', text: 'Tell me about yourself.', at: 4 },
        { kind: 'line', speaker: 'you', text: 'Sure.', at: 6 },
      ],
    ],
    tail: [{ speaker: 'them', text: 'Why this role?', at: 30 }],
  };
}

/**
 * Every text of a built prompt, in order.
 *
 * @param prompt The prompt.
 * @returns The texts.
 */
function texts(prompt: BuiltPrompt): string[] {
  const content = prompt.messages[0]!.content as Anthropic.TextBlockParam[];
  return [...prompt.system, ...content].map((block) => block.text);
}

describe('the answer prompt', () => {
  it('without a name: "Them" lines and no extra session line (the same bytes as before)', () => {
    const all = texts(buildPrompt(request(SESSION))).join('\n');
    expect(all).toContain('[00:04] Them: Tell me about yourself.');
    expect(all).toContain('[00:30] Them: Why this role?');
    expect(sessionBlock(SESSION)).not.toContain('The other person');
    // An absent name and an explicit undefined give identical prompts.
    expect(texts(buildPrompt(request({ ...SESSION, themName: undefined })))).toEqual(
      texts(buildPrompt(request(SESSION))),
    );
  });

  it('with a name: their lines carry it, the user keeps "You", and the session says who they are', () => {
    const named = { ...SESSION, themName: 'Sarah Chen' };
    const all = texts(buildPrompt(request(named))).join('\n');
    expect(all).toContain('[00:04] Sarah Chen: Tell me about yourself.');
    expect(all).toContain('[00:30] Sarah Chen: Why this role?');
    expect(all).toContain('[00:06] You: Sure.');
    expect(all).not.toContain('] Them:');
    expect(sessionBlock(named)).toContain(
      'The other person ("Them" in these rules) is Sarah Chen: their lines are labelled "Sarah Chen".',
    );
  });
});

describe('the notes and Ask AI call record', () => {
  const call = {
    lines: [
      { speaker: 'them' as const, text: 'Any questions for me?', at: 61 },
      { speaker: 'you' as const, text: 'Yes, about the team.', at: 64 },
    ],
    answers: [],
  };

  it('labels their lines with the name, or "Them" without one', () => {
    expect(callRecord({ ...call, session: { themName: 'Priya' } })).toContain(
      '[01:01] Priya: Any questions for me?',
    );
    expect(callRecord(call)).toContain('[01:01] Them: Any questions for me?');
    expect(callRecord({ ...call, session: {} })).toContain('[01:04] You: Yes, about the team.');
  });
});

describe('validation', () => {
  it('cleans the name again, and drops one that cleans to nothing', () => {
    const body = (themName: string) => ({ ...request(SESSION), session: { ...SESSION, themName } });
    const dirty = parseAnswerRequest(body('Sam: "[[x]]"\nYou'));
    expect(dirty.ok && dirty.data.session?.themName).toBe('Sam x You');
    const empty = parseAnswerRequest(body('Them'));
    expect(empty.ok && empty.data.session?.themName).toBeUndefined();
  });
});
