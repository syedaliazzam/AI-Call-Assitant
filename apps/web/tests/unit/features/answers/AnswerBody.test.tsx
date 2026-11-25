/**
 * Tests for apps/web/src/features/answers/AnswerBody.tsx (ADR-0121), from its markup: an answer whose reply
 * reached its output limit ends with the "Answer cut off" line, for the call and for a private answer, in the
 * panel and the overlay; a complete answer has no such line; and a coding answer cut inside its code block
 * still shows the code it has as a code block (with Copy), followed by the line.
 * All text is invented.
 */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ANSWER_CUT_OFF_TEXT, AnswerBody } from '@/features/answers/AnswerBody';

/** A coding answer cut off inside its code block. */
const CUT_CODE = [
  'Use a priority queue keyed by priority, then submit order.',
  'Key steps:',
  '- Keep one queue per tenant.',
  '```java',
  'public final class JobScheduler {',
  '    private final PriorityQueue<Job> queue = new PriorityQueue<>();',
].join('\n');

describe('AnswerBody, cut-off line (ADR-0121)', () => {
  it('ends a cut-off answer with the line, in the panel and the overlay', () => {
    for (const size of ['panel', 'overlay'] as const) {
      const html = renderToString(<AnswerBody text={CUT_CODE} finished size={size} cutOff />);
      expect(html).toContain('aria-label="Answer cut off"');
      expect(html).toContain(ANSWER_CUT_OFF_TEXT);
      // The code that came is still a code block, with its Copy button, before the line.
      expect(html).toContain('<pre');
      expect(html).toContain('public final class JobScheduler');
      expect(html).toContain('Copy code');
      expect(html.indexOf('JobScheduler')).toBeLessThan(html.indexOf('Answer cut off'));
    }
  });

  it('says so for a private answer too', () => {
    const html = renderToString(
      <AnswerBody text={'Here is the plan:\n- one'} finished size="chat" target="kite" cutOff />,
    );
    expect(html).toContain(ANSWER_CUT_OFF_TEXT);
  });

  it('shows no line for a complete answer', () => {
    const html = renderToString(
      <AnswerBody text={`${CUT_CODE}\n}\n\`\`\``} finished size="panel" />,
    );
    expect(html).not.toContain('Answer cut off');
  });
});
