/**
 * File: apps/web/src/features/review/AskSection.tsx
 * Purpose: "Ask AI" in the session window: a short chat about this call. Kite answers from the
 *          transcript, its answers, the notes and the documents. The chat lasts while the page is
 *          open; nothing from it is stored.
 * Used by: src/features/review/SessionReview.tsx
 * Depends on: src/core/review/ask.ts, src/core/review/load.ts (types), src/ui (Button)
 * Architecture: docs/architecture/kite-architecture-v3.1.md §5 (Session review); ADR-0029
 *
 * Questions and replies are the user's content and are never logged.
 */
'use client';

import { useState, type FormEvent } from 'react';
import { MAX_ASK_QUESTION_CHARS, type AskTurn } from '@kite/shared';
import { askAboutCall } from '@/core/review/ask';
import type { ReviewData } from '@/core/review/load';
import { Button } from '@/ui/Button';

/**
 * The Ask AI section.
 *
 * @param props.review The session's review data.
 * @returns The section.
 * Rendered by: SessionReview.tsx
 */
export function AskSection({
  review,
}: {
  /** The session's review data. */
  review: ReviewData;
}) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const hasCall = review.lines.length > 0 || review.answers.length > 0;

  /**
   * Sends the question.
   *
   * @param event The form's submit.
   */
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = question.trim();
    if (!text || asking) return;
    setQuestion('');
    setFailure(null);
    setAsking(true);
    const history = turns;
    setTurns([...history, { role: 'you', text }]);
    const outcome = await askAboutCall(review, text, history);
    setAsking(false);
    if (outcome.ok) setTurns((current) => [...current, { role: 'kite', text: outcome.text }]);
    else {
      // The question goes back in the box, so it can be sent again.
      setTurns(history);
      setQuestion(text);
      setFailure(outcome.message);
    }
  }

  return (
    <section
      aria-label="Ask AI"
      className="border border-ui-border rounded-card bg-ui-surface shadow-card p-5"
    >
      <h2 className="text-[18px] font-semibold text-ui-heading">Ask AI</h2>
      <p className="mt-1 text-[13px] text-ui-muted">
        Ask anything about this call: what was agreed, what they asked, what to follow up on.
      </p>
      {turns.length > 0 && (
        <ol aria-label="Chat" aria-live="polite" className="mt-4 flex flex-col gap-2">
          {turns.map((turn, index) => (
            <li
              key={index}
              className={
                turn.role === 'you'
                  ? 'ml-8 self-end rounded-control bg-ui-pale px-3 py-2 text-[15px] text-ui-text sm:ml-16'
                  : 'mr-8 self-start whitespace-pre-line border border-ui-border px-3 py-2 text-[15px] text-ui-text sm:mr-16'
              }
            >
              {turn.text}
            </li>
          ))}
        </ol>
      )}
      {asking && (
        <p role="status" className="mt-3 text-[13px] text-ui-muted">
          Paramount AI is reading the call…
        </p>
      )}
      {failure && (
        <p role="alert" className="mt-3 text-[13px] text-ui-danger">
          {failure}
        </p>
      )}
      {hasCall ? (
        <form onSubmit={(event) => void send(event)} className="mt-4 flex items-end gap-2">
          <input
            aria-label="Ask about this call"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            maxLength={MAX_ASK_QUESTION_CHARS}
            placeholder="What did they ask about pricing?"
            className="h-10 min-w-0 flex-1 border border-ui-border bg-ui-input px-3 text-base text-ui-text placeholder:text-ui-muted focus:border-ui-link focus:outline-none focus:[box-shadow:var(--k-focus)] pointer-coarse:min-h-11 md:text-[15px]"
          />
          <Button type="submit" disabled={asking || question.trim() === ''}>
            Ask
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-[13px] text-ui-muted">
          There is nothing saved from a call in this session to ask about yet.
        </p>
      )}
    </section>
  );
}
