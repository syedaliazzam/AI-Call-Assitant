/**
 * Tests apps/web/src/core/askKite/chat.ts: naming a chat, the turns sent with a message, building a
 * message's request, and turning a past session into an attachment. All text is invented.
 */
import { MAX_KITE_HISTORY } from '@kite/shared';
import { describe, expect, it } from 'vitest';
import { chatTitle, historyTurns, kiteRequest, sessionAttachment } from '@/core/askKite/chat';
import type { ReviewData } from '@/core/review/load';
import type { ChatMessage } from '@/core/storage/types';

/**
 * A chat message.
 *
 * @param role   Who wrote it.
 * @param text   What was written.
 * @param images How many screenshots came with it.
 * @returns The message.
 */
function message(role: 'you' | 'kite', text: string, images?: number): ChatMessage {
  return { id: text, role, text, at: 1, ...(images ? { images } : {}) };
}

describe('chatTitle', () => {
  it('uses the question on one line', () => {
    expect(chatTitle('What is\n  TCP?')).toBe('What is TCP?');
  });
  it('shortens a long question', () => {
    expect(chatTitle('x'.repeat(100)).length).toBe(60);
  });
  it('names a chat that starts with a screenshot', () => {
    expect(chatTitle('')).toBe('Screenshot');
  });
});

describe('historyTurns', () => {
  it('keeps the newest turns, and never starts with Kite', () => {
    const messages = Array.from({ length: MAX_KITE_HISTORY + 1 }, (_, index) =>
      message(index % 2 === 0 ? 'you' : 'kite', `m${index}`),
    );
    const turns = historyTurns(messages);
    expect(turns[0]?.role).toBe('you');
    expect(turns.at(-1)?.text).toBe(`m${MAX_KITE_HISTORY}`);
    expect(turns.length).toBeLessThanOrEqual(MAX_KITE_HISTORY);
  });

  it('says a screenshot is no longer available', () => {
    expect(historyTurns([message('you', 'Look', 1)])[0]?.text).toContain('no longer available');
  });
});

describe('kiteRequest', () => {
  it('builds the request with attachments and images', () => {
    const request = kiteRequest(
      {
        messages: [message('you', 'Hi'), message('kite', 'Hello')],
        attachments: [{ id: 'a', name: 'cv.txt', kind: 'resume', text: 'CV' }],
      },
      ' Next? ',
      ['data:image/jpeg;base64,AAAA'],
    );
    expect(request).toEqual({
      mode: 'kite',
      history: [
        { role: 'you', text: 'Hi' },
        { role: 'kite', text: 'Hello' },
      ],
      attachments: [{ name: 'cv.txt', text: 'CV' }],
      question: 'Next?',
      images: ['data:image/jpeg;base64,AAAA'],
    });
  });

  it('sends no question for a screenshot alone', () => {
    expect(kiteRequest({ messages: [], attachments: [] }, ' ', ['x']).question).toBeUndefined();
  });
});

describe('sessionAttachment', () => {
  it('holds the details, the notes, the documents and the call', () => {
    const review = {
      session: {
        id: 's',
        type: 'interview',
        company: 'Acme (invented)',
        role: 'Engineer',
        description: 'A call',
        preferences: { keyTerms: '' },
      },
      documents: [{ name: 'cv.txt', text: 'Six years of work' }],
      lines: [
        { id: 'l', sessionId: 's', speaker: 'them', text: 'hello there', tStart: 1, tEnd: 2 },
      ],
      answers: [],
      notes: {
        notes: { summary: ['It went well'], questions: [], nextSteps: [] },
      },
      lessonDecisions: [],
    } as unknown as ReviewData;
    const { name, text } = sessionAttachment(review);
    expect(name).toBe('Session: Acme (invented) (Engineer)');
    expect(text).toContain('Summary: It went well');
    expect(text).toContain('Six years of work');
    expect(text.toLowerCase()).toContain('hello there');
  });
});
